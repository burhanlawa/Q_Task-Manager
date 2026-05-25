import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TenantRequest, TenantTx } from './tenant-context.interceptor';

export type TenantContext = { companyId: string; userId: string };

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (!req.tenant) {
      throw new Error('CurrentTenant used without TenantContextInterceptor on the route');
    }
    return req.tenant;
  },
);

export const TenantDb = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantTx => {
  const req = ctx.switchToHttp().getRequest<TenantRequest>();
  if (!req.tenantDb) {
    throw new Error('TenantDb used without TenantContextInterceptor on the route');
  }
  return req.tenantDb;
});
