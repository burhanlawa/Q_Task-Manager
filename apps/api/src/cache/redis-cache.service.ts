import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// Thin JSON cache over Redis. Lazy init: if REDIS_URL is unset the API
// still boots, and every operation degrades to a miss + a no-op write.
// That lets dev workflows (integration tests, no-Redis setups) keep
// working without conditional checks at every call site.
//
// Same Redis instance as BullMQ — separate logical key prefix per use
// case keeps the namespaces from colliding (e.g. cache:tasks-completion-by-day:...).

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly log = new Logger(RedisCacheService.name);
  private client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.warn('REDIS_URL not set; cache will be a no-op (every get → miss).');
      return;
    }
    this.client = new Redis(url, {
      maxRetriesPerRequest: 1,
      // Don't crash the app if Redis flakes; we want graceful degradation.
      enableOfflineQueue: false,
      // Quiet down — we log misses ourselves at debug level.
      lazyConnect: false,
    });
    this.client.on('error', (err) => {
      // Connection errors get logged but don't propagate. Cache reads
      // return null; writes throw nothing.
      this.log.warn(`Redis cache error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit().catch(() => {});
  }

  /**
   * Returns the cached value parsed from JSON, or null on miss / error / no client.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.warn(`Redis GET failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Stores the value as JSON with a TTL in seconds. Best-effort — failures
   * are logged but never thrown so a cache write can't fail a request.
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.log.warn(`Redis SET failed for ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Read-through cache helper: returns the cached value or calls the loader
   * function, caching its result for ttlSeconds. The classic pattern.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await loader();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
