import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { clerkClientProvider } from './clerk-client.provider';

@Global()
@Module({
  providers: [clerkClientProvider, ClerkAuthGuard],
  exports: [clerkClientProvider, ClerkAuthGuard],
})
export class AuthModule {}
