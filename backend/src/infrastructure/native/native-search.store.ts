import { ReloadingFile } from './native-graph.store';
import { NativeSearchIndex } from './native-search';

export class NativeSearchStore extends ReloadingFile<NativeSearchIndex> {
  constructor(file: string) {
    super(file, (path) => NativeSearchIndex.load(path), NativeSearchStore.name);
  }
}

export const NATIVE_SEARCH_STORE = Symbol('NATIVE_SEARCH_STORE');
