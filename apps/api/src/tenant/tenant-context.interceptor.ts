import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import type { Prisma } from '@prisma/client';
import type { RequestAuth } from '../auth/clerk-auth.guard';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import { PrismaService } from '../prisma/prisma.service';

export type TenantTx = Prisma.TransactionClient;

export type TenantRequest = Request & {
  auth?: RequestAuth;
  tenant?: { companyId: string; userId: string };
  tenantDb?: TenantTx;
};

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    if (!req.auth) {
      throw new UnauthorizedException('Auth context missing — guard must run first');
    }
    const clerkUserId = req.auth.userId;

    // Use the admin (owner-role) client for this single lookup. We have no
    // current_company_id yet — that's literally what we're about to discover —
    // so RLS on `users` would reject this query. Every downstream query in
    // this request runs through the RLS-subject `prisma` client below.
    return from(
      this.admin.user.findUnique({
        where: { clerkUserId },
        select: { id: true, companyId: true },
      }),
    ).pipe(
      switchMap((user) => {
        if (!user) {
          throw new UnauthorizedException('No tenant for this Clerk user');
        }
        req.tenant = { companyId: user.companyId, userId: user.id };

        // Wrap the entire downstream handler in a Prisma transaction so
        // SET LOCAL app.current_company_id is bound to this connection
        // for the request's lifetime. We resolve the tx promise by routing
        // the controller's observable result through it.
        return new Observable((subscriber) => {
          this.prisma
            .$transaction(async (tx: Prisma.TransactionClient) => {
              // set_config(name, value, is_local) — is_local=true behaves like SET LOCAL.
              // Using a parameter binding (not string concat) avoids any SQL injection
              // risk even though the UUID comes from our own DB.
              await tx.$executeRaw`SELECT set_config('app.current_company_id', ${user.companyId}, true)`;
              // Also bind the user id so per-recipient RLS (e.g., notifications)
              // can scope reads to just my row without app-code filtering.
              await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;
              req.tenantDb = tx;
              const value = await new Promise((resolve, reject) => {
                next
                  .handle()
                  .subscribe({ next: resolve, error: reject, complete: () => resolve(undefined) });
              });
              return value;
            })
            .then((result) => {
              subscriber.next(result);
              subscriber.complete();
            })
            .catch((err) => subscriber.error(err));
        });
      }),
    );
  }
}
