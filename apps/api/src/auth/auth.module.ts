import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { clerkClientProvider } from './clerk-client.provider';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  providers: [clerkClientProvider, ClerkAuthGuard, PermissionsGuard, PermissionsService],
  exports: [clerkClientProvider, ClerkAuthGuard, PermissionsGuard, PermissionsService],
})
export class AuthModule {}
