import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { clerkClientProvider } from './clerk-client.provider';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [clerkClientProvider, ClerkAuthGuard, PermissionsGuard],
  exports: [clerkClientProvider, ClerkAuthGuard, PermissionsGuard],
})
export class AuthModule {}
