import { Global, Module } from '@nestjs/common';
import { CACHE_PROVIDER } from './cache.provider';
import { RedisCacheProvider } from './redis-cache.provider';

@Global()
@Module({
  providers: [{ provide: CACHE_PROVIDER, useClass: RedisCacheProvider }],
  exports: [CACHE_PROVIDER],
})
export class CacheModule {}
