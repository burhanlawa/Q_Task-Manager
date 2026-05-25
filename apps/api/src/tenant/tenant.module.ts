import { Global, Module } from '@nestjs/common';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  providers: [TenantContextInterceptor],
  exports: [TenantContextInterceptor],
})
export class TenantModule {}
