import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RedisCacheService } from '../cache/redis-cache.service';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import type { RequestAuth } from './clerk-auth.guard';

// Sprint 20.7 — Read-only / billing-status enforcement.
//
// Every write request (POST/PATCH/PUT/DELETE) goes through this guard.
// If the requester's tenant is in a state that should block writes —
// past-due day 7+ (read_only_at set) OR status in {paused, expired,
// cancelled} — we 402 Payment Required with a stable body the web side
// can render as an upgrade nudge.
//
// Three escape hatches:
//   1. GET / HEAD / OPTIONS — never gated. Reading is always allowed
//      so the user can see what they owe and recover.
//   2. @SkipBillingGate() decorator — for the few write endpoints that
//      MUST keep working for the user to recover: billing checkout,
//      reference submission, mark-paid. Also for webhooks (which have
//      no tenant context anyway).
//   3. Request without req.auth (no Clerk session) — webhooks fall
//      into this category. They handle their own auth via signatures.
//
// Tenant lookup goes through the admin client + a 60s cache (Sprint 14
// RedisCacheService). The guard fires on every write; without caching
// every PATCH would re-hit the DB just for this check.

export const SKIP_BILLING_GATE = Symbol('SKIP_BILLING_GATE');
export const SkipBillingGate = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_BILLING_GATE, true);

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Status values that block writes. 'paused' (day 14+) and 'expired'
// (day 30+) come from the dunning ladder; 'cancelled' from explicit
// cancel. We do NOT include 'past_due' here — at day 1-6 the user is
// still in the grace window and should be able to use the app while
// retrying the card.
const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['paused', 'expired', 'cancelled']);

type CompanyBillingSnapshot = {
  status: string;
  readOnlyAt: string | null;
};

const CACHE_TTL_SECONDS = 60;
const cacheKey = (companyId: string) => `billing-status:${companyId}`;

@Injectable()
export class BillingStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admin: PrismaAdminService,
    private readonly cache: RedisCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: RequestAuth }>();

    // Reads always pass through.
    if (!WRITE_METHODS.has(req.method)) return true;

    // Decorator escape hatch — checked on method first, then class so a
    // single @SkipBillingGate on a controller exempts all its routes.
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_BILLING_GATE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    // No Clerk session = webhook or other unauthenticated request.
    // Those have their own gates (signature verification) and never
    // touch tenant-scoped state by this entry point.
    if (!req.auth?.userId) return true;

    // Resolve company billing state. Cache for 60s so frequent writes
    // from the same tenant don't all hit the DB. Cache key is the
    // companyId, which we look up by clerkUserId first.
    const userRow = await this.admin.user.findUnique({
      where: { clerkUserId: req.auth.userId },
      select: { companyId: true },
    });
    if (!userRow) return true; // first-signup race; auth interceptor will 401

    const snapshot = await this.cache.getOrSet<CompanyBillingSnapshot>(
      cacheKey(userRow.companyId),
      CACHE_TTL_SECONDS,
      async () => {
        const company = await this.admin.company.findUnique({
          where: { id: userRow.companyId },
          select: { status: true, readOnlyAt: true },
        });
        return {
          status: company?.status ?? 'active',
          readOnlyAt: company?.readOnlyAt ? company.readOnlyAt.toISOString() : null,
        };
      },
    );

    const blocked = snapshot.readOnlyAt !== null || BLOCKING_STATUSES.has(snapshot.status);

    if (blocked) {
      // 402 Payment Required — the spec's named status for billing
      // gates. The body shape mirrors the other plan-limit error
      // (Sprint 19.3) so the web's upgrade-toast handler can reuse it.
      throw new HttpException(
        {
          message:
            'Your workspace is read-only. Pay your bill from /billing to restore write access.',
          code: 'billing_read_only',
          status: snapshot.status,
          readOnlyAt: snapshot.readOnlyAt,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}
