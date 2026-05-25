import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ClerkClient } from '@clerk/backend';
import type { Request } from 'express';
import { CLERK_CLIENT } from './clerk-client.provider';

export type RequestAuth = {
  userId: string;
  sessionId: string | null;
  orgId: string | null;
};

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(@Inject(CLERK_CLIENT) private readonly clerk: ClerkClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: RequestAuth }>();

    // Clerk's authenticateRequest expects a Fetch Request, not Express's.
    // Build a minimal Fetch Request with the same URL + Authorization header.
    const authHeader = req.headers.authorization ?? '';
    const url = `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl ?? req.url}`;
    const fetchRequest = new Request(url, {
      method: req.method,
      headers: authHeader ? { authorization: authHeader } : {},
    });

    const requestState = await this.clerk.authenticateRequest(fetchRequest, {
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    });

    if (!requestState.isAuthenticated) {
      throw new UnauthorizedException(requestState.reason ?? 'Unauthenticated');
    }

    const claims = requestState.toAuth();
    // We only accept session tokens for user-facing routes. M2M and api_key tokens
    // would need their own guard with different downstream handling.
    if (claims.tokenType !== 'session_token') {
      throw new UnauthorizedException(`Unsupported token type: ${claims.tokenType}`);
    }

    req.auth = {
      userId: claims.userId,
      sessionId: claims.sessionId ?? null,
      orgId: claims.orgId ?? null,
    };
    return true;
  }
}
