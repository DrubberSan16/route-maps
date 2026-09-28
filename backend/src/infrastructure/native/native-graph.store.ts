import { Logger } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import { NativeGraph } from './native-graph';

/**
 * Loads a native data file once and reloads it when the pipeline replaces it (new mtime or
 * size). Concurrent callers share the same load; a failed reload keeps serving the previous copy.
 */
export class ReloadingFile<T> {
  private value: T | null = null;
  private version = '';
  private loading: Promise<T> | null = null;
  private readonly logger: Logger;

  constructor(
    readonly file: string,
    private readonly loader: (file: string) => Promise<T>,
    name: string,
  ) {
    this.logger = new Logger(name);
  }

  async get(): Promise<T> {
    const info = await stat(this.file);
    const version = `${info.mtimeMs}:${info.size}`;
    if (this.value && version === this.version) return this.value;
    this.loading ??= (async () => {
      const started = Date.now();
      try {
        const value = await this.loader(this.file);
        this.value = value;
        this.version = version;
        this.logger.log(`Loaded ${this.file} in ${Date.now() - started} ms`);
        return value;
      } catch (error) {
        if (this.value) {
          this.logger.error(
            { err: error },
            `Could not reload ${this.file}; keeping the previous copy`,
          );
          return this.value;
        }
        throw error;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Loaded value without touching the disk (null before the first load). */
  current(): T | null {
    return this.value;
  }

  /** Version of the file on disk (changes when the pipeline replaces it), '' when it is missing. */
  async fingerprint(): Promise<string> {
    try {
      const info = await stat(this.file);
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return '';
    }
  }

  async available(): Promise<boolean> {
    try {
      const info = await stat(this.file);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }
}

export class NativeGraphStore extends ReloadingFile<NativeGraph> {
  constructor(file: string) {
    super(file, (path) => NativeGraph.load(path), NativeGraphStore.name);
  }
}

export const NATIVE_GRAPH_STORE = Symbol('NATIVE_GRAPH_STORE');
