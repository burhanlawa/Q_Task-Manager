import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentTenant, type TenantContext } from '../tenant/current-tenant.decorator';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { PusherService } from './pusher.service';

class PusherAuthDto {
  @IsString()
  @IsNotEmpty()
  socket_id!: string;

  @IsString()
  @IsNotEmpty()
  channel_name!: string;
}

// POST /pusher/auth
//   Called by the browser's pusher-js client BEFORE it subscribes to a
//   private-* channel. Pusher's protocol is: client opens the websocket,
//   gets a socket_id, then POSTs { socket_id, channel_name } here; we sign
//   a payload that the client forwards to Pusher to complete the subscribe.
//
// Authorization gate:
//   Each user may only subscribe to `private-user-<theirOwnId>`. Anything
//   else → 403. This is the wall that keeps a tenant-A user from listening
//   in on tenant-B traffic — Pusher itself doesn't enforce tenancy, we do.
@Controller('pusher')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class PusherController {
  constructor(private readonly pusher: PusherService) {}

  @Post('auth')
  @HttpCode(200)
  auth(@CurrentTenant() tenant: TenantContext, @Body() dto: PusherAuthDto) {
    const expected = `private-user-${tenant.userId}`;
    if (dto.channel_name !== expected) {
      throw new ForbiddenException(`You can only subscribe to your own user channel (${expected})`);
    }
    return this.pusher.authorizeChannel(dto.socket_id, dto.channel_name);
  }
}
