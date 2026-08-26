declare module 'archiver' {
  import type { Readable } from 'node:stream';

  /**
   * archiver v8 is ESM and exports format classes rather than a default
   * factory. Only the streaming-to-buffer surface the CSV export needs is
   * declared here.
   */
  export class ZipArchive extends Readable {
    constructor(options?: { zlib?: { level?: number } });
    append(source: Buffer | string, options: { name: string }): this;
    finalize(): Promise<void>;
  }
}
