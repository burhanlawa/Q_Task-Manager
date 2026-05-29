import { Global, Module } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service';

// Global so any feature module can inject the cache without re-importing.
// Same shape as ActivityLogModule / PusherModule / EmailModule.
@Global()
@Module({
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class CacheModule {}
