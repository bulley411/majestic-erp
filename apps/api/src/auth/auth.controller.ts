import { Body, Controller, Get, Post, Req, Res, HttpCode } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { loginSchema } from '@mapa/shared';
import { z } from 'zod';

const REFRESH_COOKIE = 'mapa_refresh';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private context(req: Request) {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        ?? req.socket?.remoteAddress,
    };
  }

  /**
   * The refresh token goes in an httpOnly cookie so JavaScript cannot read
   * it — that is what limits the damage of an XSS bug. The access token is
   * returned in the body and held in memory only, never localStorage.
   */
  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = loginSchema.parse(body);
    const result = await this.auth.login(email, password, this.context(req));
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...safe } = result;
    return safe;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) return { accessToken: null };
    const result = await this.auth.refresh(token, this.context(req));
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...safe } = result;
    return safe;
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.auth.me(userId);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser('sub') userId: string, @Body() body: unknown) {
    const { currentPassword, newPassword } = changePasswordSchema.parse(body);
    return this.auth.changePassword(userId, currentPassword, newPassword);
  }
}
