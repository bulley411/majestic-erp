import {
  Injectable, BadRequestException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { hashPassword, checkPasswordStrength } from './password';
import { randomBytes } from 'node:crypto';

/**
 * User administration.
 *
 * Two rules run through everything here:
 *
 *  1. Nobody can grant a permission they do not themselves hold. Otherwise
 *     an HR officer with user.manage could create an account with payroll
 *     approval and sign in as it — the approval chain would be decoration.
 *
 *  2. An administrator cannot lock themselves out. Removing your own last
 *     admin role, or deactivating your own account, leaves a system nobody
 *     can administer, and recovering from that means editing the database
 *     by hand.
 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Readable but random. Four syllables beat a string nobody types right. */
  private tempPassword(): string {
    const words = ['Harbour', 'Lantern', 'Copper', 'Meadow', 'Falcon', 'Thistle',
                   'Compass', 'Amber', 'Willow', 'Quartz', 'Beacon', 'Cedar'];
    const pick = () => words[randomBytes(1)[0] % words.length];
    return `${pick()}${pick()}${(randomBytes(2).readUInt16BE(0) % 9000) + 1000}`;
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: { email: 'asc' },
      include: {
        roles: { include: { role: true } },
        employee: { select: { id: true, staffId: true, firstName: true, lastName: true } },
      },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      isActive: u.isActive,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.roles.map((r) => ({ id: r.role.id, code: r.role.code, name: r.role.name })),
      employee: u.employee,
    }));
  }

  /** Roles and unlinked employees, for the create form. */
  async formOptions() {
    const [roles, employees] = await Promise.all([
      this.prisma.role.findMany({
        orderBy: { name: 'asc' },
        include: { permissions: { include: { permission: true } } },
      }),
      this.prisma.employee.findMany({
        where: { userId: null, status: { not: 'EXITED' } },
        select: { id: true, staffId: true, firstName: true, lastName: true },
        orderBy: { staffId: 'asc' },
      }),
    ]);

    return {
      roles: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        permissions: r.permissions.map((p) => p.permission.code),
      })),
      employees,
    };
  }

  /** Permission codes held by a user, flattened across their roles. */
  private async permissionsOf(userId: string): Promise<Set<string>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    return new Set(
      user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)),
    );
  }

  /** Refuses to assign roles carrying permissions the actor lacks. */
  private async assertNoEscalation(actorId: string, roleIds: string[]) {
    const actorPerms = await this.permissionsOf(actorId);

    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      include: { permissions: { include: { permission: true } } },
    });

    for (const role of roles) {
      const missing = role.permissions
        .map((p) => p.permission.code)
        .filter((code) => !actorPerms.has(code));
      if (missing.length) {
        throw new ForbiddenException(
          `You cannot grant "${role.name}" — it includes permissions you do not hold: ${missing.join(', ')}.`,
        );
      }
    }
  }

  async create(
    data: { email: string; roleIds: string[]; employeeId?: string },
    actorId: string,
  ) {
    const email = data.email.toLowerCase().trim();

    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException(`${email} already has an account.`);
    }
    if (!data.roleIds.length) {
      throw new BadRequestException('Assign at least one role.');
    }

    await this.assertNoEscalation(actorId, data.roleIds);

    if (data.employeeId) {
      const employee = await this.prisma.employee.findUniqueOrThrow({
        where: { id: data.employeeId },
      });
      if (employee.userId) {
        throw new ConflictException(
          `${employee.firstName} ${employee.lastName} is already linked to another account.`,
        );
      }
    }

    const password = this.tempPassword();

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        roles: { create: data.roleIds.map((roleId) => ({ roleId })) },
      },
    });

    if (data.employeeId) {
      await this.prisma.employee.update({
        where: { id: data.employeeId },
        data: { userId: user.id },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'user.created', entityType: 'User', entityId: user.id,
        after: { email, roleCount: data.roleIds.length } as never,
      },
    });

    // Returned once. Never stored in clear, never recoverable.
    return { id: user.id, email, temporaryPassword: password };
  }

  async setRoles(userId: string, roleIds: string[], actorId: string) {
    if (!roleIds.length) {
      throw new BadRequestException('A user must have at least one role.');
    }

    await this.assertNoEscalation(actorId, roleIds);

    // Removing your own administrative access leaves nobody able to
    // administer the system.
    if (userId === actorId) {
      const current = await this.permissionsOf(actorId);
      if (current.has('user.manage')) {
        const roles = await this.prisma.role.findMany({
          where: { id: { in: roleIds } },
          include: { permissions: { include: { permission: true } } },
        });
        const keeps = roles.some((r) =>
          r.permissions.some((p) => p.permission.code === 'user.manage'),
        );
        if (!keeps) {
          throw new BadRequestException(
            'You would lose the ability to manage users. Ask another administrator to make this change.',
          );
        }
      }
    }

    const before = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId })),
      }),
    ]);

    // Permissions are baked into the access token, so existing sessions
    // would keep the old rights until expiry. Revoking forces a re-login.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'user.roles_changed', entityType: 'User', entityId: userId,
        before: { roles: before.map((r) => r.role.code) } as never,
        after: { roleCount: roleIds.length } as never,
      },
    });

    return { ok: true };
  }

  async setActive(userId: string, isActive: boolean, actorId: string) {
    if (userId === actorId && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    // Deactivating the last active administrator locks everyone out.
    if (!isActive) {
      const admins = await this.prisma.user.findMany({
        where: {
          isActive: true,
          id: { not: userId },
          roles: {
            some: {
              role: { permissions: { some: { permission: { code: 'user.manage' } } } },
            },
          },
        },
        select: { id: true },
      });
      const target = await this.permissionsOf(userId);
      if (target.has('user.manage') && admins.length === 0) {
        throw new BadRequestException(
          'This is the only account that can manage users. Create another administrator first.',
        );
      }
    }

    await this.prisma.user.update({ where: { id: userId }, data: { isActive } });

    if (!isActive) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: isActive ? 'user.activated' : 'user.deactivated',
        entityType: 'User',
        entityId: userId,
      },
    });

    return { ok: true };
  }

  async resetPassword(userId: string, actorId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const password = this.tempPassword();

    const weak = checkPasswordStrength(password);
    if (weak) throw new BadRequestException('Generated password failed the policy check.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'user.password_reset', entityType: 'User', entityId: userId,
        after: { email: user.email } as never,
      },
    });

    return { temporaryPassword: password };
  }

  /** Links or unlinks the employee record this account belongs to. */
  async setEmployee(userId: string, employeeId: string | null, actorId: string) {
    await this.prisma.employee.updateMany({
      where: { userId },
      data: { userId: null },
    });

    if (employeeId) {
      const employee = await this.prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      if (employee.userId && employee.userId !== userId) {
        throw new ConflictException('That employee is already linked to another account.');
      }
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { userId },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'user.employee_linked', entityType: 'User', entityId: userId,
        after: { employeeId } as never,
      },
    });

    return { ok: true };
  }
}