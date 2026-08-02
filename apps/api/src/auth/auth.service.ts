import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { hashPassword, verifyPassword, checkPasswordStrength } from './password';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  ACCESS_TOKEN_TTL_SECONDS,
} from './tokens';
import { randomUUID } from 'node:crypto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  private get secret(): string {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 32) {
      // Fail loudly at use rather than silently signing with a weak key.
      throw new Error('JWT_SECRET is missing or too short (need 32+ chars).');
    }
    return s;
  }

  private async issueTokens(userId: string, familyId: string, ctx: SessionContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        employee: { select: { id: true } },
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });

    const roles = user.roles.map((r) => r.role.code);
    const permissions = [
      ...new Set(
        user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)),
      ),
    ];

    const accessToken = signAccessToken(
      {
        sub: user.id,
        email: user.email,
        roles,
        permissions,
        employeeId: user.employee?.id ?? null,
      },
      this.secret,
    );

    const { token, hash } = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        familyId,
        expiresAt: refreshTokenExpiry(),
        userAgent: ctx.userAgent?.slice(0, 255),
        ipAddress: ctx.ipAddress,
      },
    });

    return {
      accessToken,
      refreshToken: token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        roles,
        permissions,
        employeeId: user.employee?.id ?? null,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /** Recent failures for this email, used for lockout. */
  private async recentFailures(email: string): Promise<number> {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000);
    return this.prisma.loginAttempt.count({
      where: { email: email.toLowerCase(), succeeded: false, createdAt: { gte: since } },
    });
  }

  async login(email: string, password: string, ctx: SessionContext) {
    const normalised = email.toLowerCase().trim();

    if ((await this.recentFailures(normalised)) >= MAX_FAILED_ATTEMPTS) {
      throw new ForbiddenException(
        `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    // Hash even when the user does not exist, so response time does not
    // reveal which emails have accounts.
    const stored =
      user?.passwordHash ??
      '$scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==';
    const valid = await verifyPassword(password, stored);

    if (!user || !valid || !user.isActive) {
      await this.prisma.loginAttempt.create({
        data: { email: normalised, succeeded: false, ipAddress: ctx.ipAddress },
      });
      // One message for every failure mode: wrong email, wrong password,
      // disabled account. Distinguishing them tells an attacker which
      // half they got right.
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.prisma.loginAttempt.deleteMany({
      where: { email: normalised, succeeded: false },
    });
    await this.prisma.loginAttempt.create({
      data: { email: normalised, succeeded: true, ipAddress: ctx.ipAddress },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens(user.id, randomUUID(), ctx);
  }

  /**
   * Rotate a refresh token.
   *
   * Each refresh issues a new token and revokes the old one. If a token
   * that was already used comes back, it means someone is replaying a
   * stolen token — so the entire family is revoked, logging out both the
   * attacker and the legitimate user, who then has to log in again.
   */
  async refresh(refreshToken: string, ctx: SessionContext) {
    const hash = hashRefreshToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!existing) throw new UnauthorizedException('Invalid session.');

    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session reuse detected. Please sign in again.');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    const issued = await this.issueTokens(existing.userId, existing.familyId, ctx);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return issued;
  }

  async logout(refreshToken: string) {
    const hash = hashRefreshToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
    });
    if (existing) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from the current one.');
    }
    const weak = checkPasswordStrength(newPassword);
    if (weak) throw new BadRequestException(weak);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      },
    });

    // Changing a password ends every other session.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        employee: {
          include: { department: true, jobTitle: true },
        },
        roles: { include: { role: true } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
      roles: user.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
      employee: user.employee
        ? {
            id: user.employee.id,
            staffId: user.employee.staffId,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            department: user.employee.department?.name ?? null,
            jobTitle: user.employee.jobTitle?.name ?? null,
          }
        : null,
    };
  }
}
