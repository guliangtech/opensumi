import { IDisposable } from './disposable';
import { EventQueue } from './event';

import type { Readable } from 'stream';

export interface IReadableStream<T> {
  on(event: 'data', listener: (chunk: T) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export function isReadableStream(stream: any): stream is Readable {
  return stream && typeof stream.read === 'function';
}

export interface IListenReadableOptions {
  onData(data: Uint8Array): void;
  onEnd(): void;
  onError?(error: Error): void;
}

export function listenReadable(stream: IReadableStream<Uint8Array>, options: IListenReadableOptions): void {
  stream.on('data', (chunk: Uint8Array) => {
    options.onData(chunk);
  });
  stream.on('error', (error: Error) => {
    options.onError?.(error);
  });
  stream.on('end', () => {
    options.onEnd();
  });
}

export class SumiReadableStream<T> implements IReadableStream<T> {
  protected dataQueue = new EventQueue<T>();
  protected endQueue = new EventQueue<void>();
  protected errorQueue = new EventQueue<Error>();

  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'data', listener: (chunk: T) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
  on(event: unknown, listener: unknown): this {
    switch (event) {
      case 'error':
        this.onError(listener as (err: Error) => void);
        break;
      case 'data':
        this.onData(listener as (chunk: T) => void);
        break;
      case 'end':
        this.onEnd(listener as () => void);
        break;
      default:
        break;
    }
    return this;
  }

  onData(cb: (data: T) => void): IDisposable {
    return this.dataQueue.on(cb);
  }

  onEnd(cb: () => void): IDisposable {
    return this.endQueue.on(cb);
  }

  onError(cb: (err: Error) => void): IDisposable {
    return this.errorQueue.on(cb);
  }

  emitData(buffer: T) {
    this.dataQueue.push(buffer);
  }

  emitError(err: Error) {
    this.errorQueue.push(err);
  }

  end() {
    this.dataQueue.dispose();
    this.endQueue.push(undefined);
    this.endQueue.dispose();
  }
}
