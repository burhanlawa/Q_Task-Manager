import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaAdminService } from '../prisma/prisma-admin.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly db: PrismaAdminService) {}

  // GET /health
  //   Liveness check — does the process accept HTTP? Cheap, no DB call.
  //   Used by Railway/Vercel to decide whether to keep the container up.
  // GET /health?deep=1
  //   Readiness check — also pings the DB with a trivial round-trip. Used
  //   by Better Stack to drive the api + database uptime signals on the
  //   public status page (Sprint 21.8). 503 if the DB round-trip fails so
  //   the monitor flips red within one tick; otherwise 200 with elapsed ms.
  @Get()
  async check(@Query('deep') deep?: string): Promise<{
    status: 'ok';
    db?: 'ok';
    dbMs?: number;
  }> {
    if (deep !== '1' && deep !== 'true') {
      return { status: 'ok' };
    }
    const start = Date.now();
    try {
      await this.db.$queryRawUnsafe('SELECT 1');
    } catch {
      // No detail in the response — we don't want to leak failure shape
      // to a public status monitor. The Sentry handler captures the
      // real error for the operator.
      throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    }
    return { status: 'ok', db: 'ok', dbMs: Date.now() - start };
  }
}
