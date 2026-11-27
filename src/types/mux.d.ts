declare module 'mux.js' {
  export interface TransmuxerOptions {
    remux?: boolean;
    keepOriginalTimestamps?: boolean;
    baseMediaDecodeTime?: number;
  }

  export interface TransmuxedSegment {
    type?: 'combined' | 'video' | 'audio';
    initSegment?: Uint8Array;
    data?: Uint8Array;
  }

  export class Transmuxer {
    constructor(options?: TransmuxerOptions);
    on(event: 'data', handler: (segment: TransmuxedSegment) => void): void;
    on(event: 'done', handler: () => void): void;
    on(event: string, handler: (...args: any[]) => void): void;
    push(data: Uint8Array): void;
    flush(): void;
    reset(): void;
  }

  const muxjs: {
    mp4: {
      Transmuxer: typeof Transmuxer;
    };
  };

  export default muxjs;
}
