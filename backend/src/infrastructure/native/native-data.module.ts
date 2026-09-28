import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { NATIVE_GRAPH_STORE, NativeGraphStore } from './native-graph.store';
import { NATIVE_SEARCH_STORE, NativeSearchStore } from './native-search.store';

/**
 * The region data built by the pipeline (road graph and search index), loaded once and shared by
 * routing, geocoding and traffic.
 */
@Global()
@Module({
  providers: [
    {
      provide: NATIVE_GRAPH_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new NativeGraphStore(config.get('routing').nativeGraphFile),
    },
    {
      provide: NATIVE_SEARCH_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new NativeSearchStore(config.get('geocoding').nativeSearchFile),
    },
  ],
  exports: [NATIVE_GRAPH_STORE, NATIVE_SEARCH_STORE],
})
export class NativeDataModule {}
