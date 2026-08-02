import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
  ForbiddenException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyAccessToken, AccessTokenPayload } from './tokens';

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

declare module 'express' {
  interface Request { user?: AccessTokenPayload }
}

/**
 * Applied globally in AppModule, so every route is protected by default.
 * A route is only reachable without a token if it is explicitly marked
 * @Public() — a new endpoint is secure unless someone opts out, rather
 * than open unless someone remembers to lock it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required.');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET is missing or too short (need 32+ chars).');
    }

    const payload = verifyAccessToken(header.slice(7), secret);
    if (!payload) throw new UnauthorizedException('Session expired or invalid.');
    request.user = payload;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (required?.length) {
      const missing = required.filter((p) => !payload.permissions.includes(p));
      if (missing.length) {
        throw new ForbiddenException(`Requires permission: ${missing.join(', ')}`);
      }
    }
    return true;
  }
}
