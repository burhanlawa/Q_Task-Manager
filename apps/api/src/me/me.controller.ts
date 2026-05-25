import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard, type RequestAuth } from '../auth/clerk-auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';

@Controller('me')
@UseGuards(ClerkAuthGuard)
export class MeController {
  @Get()
  whoami(@CurrentAuth() auth: RequestAuth): { clerkUserId: string; sessionId: string | null } {
    return { clerkUserId: auth.userId, sessionId: auth.sessionId };
  }
}
