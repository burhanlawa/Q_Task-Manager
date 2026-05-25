import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestAuth } from './clerk-auth.guard';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAuth => {
    const req = ctx.switchToHttp().getRequest<Request & { auth?: RequestAuth }>();
    if (!req.auth) {
      throw new Error('CurrentAuth used without ClerkAuthGuard on the route');
    }
    return req.auth;
  },
);
