import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload } from './tokens';

export const CurrentUser = createParamDecorator(
  (data: keyof AccessTokenPayload | undefined, ctx: ExecutionContext) => {
    const user: AccessTokenPayload = ctx.switchToHttp().getRequest().user;
    return data ? user?.[data] : user;
  },
);
