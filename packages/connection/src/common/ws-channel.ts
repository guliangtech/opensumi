import { Type } from '@furyjs/fury';

import { EventEmitter } from '@opensumi/events';
import { DisposableCollection } from '@opensumi/ide-core-common';

import { IConnectionShape } from './connection/types';
import { oneOf7 } from './fury-extends/one-of';
import { ISumiConnectionOptions, SumiConnection } from './rpc/connection';
import { ILogger } from './types';

/**
 * `ping` and `pong` are used to detect whether the connection is alive.
 */
export interface PingMessage {
  kind: 'ping';
  id: string;
  clientId: string;
}

/**
 * when server receive a `ping` message, it should reply a `pong` message, vice versa.
 */
export interface PongMessage {
  kind: 'pong';
  id: string;
  clientId: string;
}

/**
 * `open` message is used to open a new channel.
 * `path` is used to identify which handler should be used to handle the channel.
 * `clientId` is used to identify the client.
 */
export interface OpenMessage {
  kind: 'open';
  id: string;
  path: string;
  clientId: string;
}

/**
 * when server receive a `open` message, it should reply a `server-ready` message.
 * this is indicate that the channel is ready to use.
 */
export interface ServerReadyMessage {
  kind: 'server-ready';
  id: string;
}

/**
 * `data` message indicate that the channel has received some data.
 * the `content` field is the data, it should be a string.
 */
export interface DataMessage {
  kind: 'data';
  id: string;
  content: string;
}

export interface BinaryMessage {
  kind: 'binary';
  id: string;
  binary: Uint8Array;
}

export interface CloseMessage {
  kind: 'close';
  id: string;
  code: number;
  reason: string;
}

export type ChannelMessage =
  | PingMessage
  | PongMessage
  | OpenMessage
  | ServerReadyMessage
  | DataMessage
  | BinaryMessage
  | CloseMessage;

export interface IWSChannelCreateOptions {
  /**
   * every channel's unique id, it only used in client to server architecture.
   * server will store this id and use it to identify which channel should be used.
   */
  id: string;
  logger?: ILogger;
}

export class WSChannel {
  protected emitter = new EventEmitter<{
    message: [data: string];
    open: [id: string];
    reopen: [];
    close: [code?: number, reason?: string];
    binary: [data: Uint8Array];
  }>();

  public id: string;

  public channelPath: string;

  logger: ILogger = console;

  static forClient(connection: IConnectionShape<Uint8Array>, options: IWSChannelCreateOptions) {
    const disposable = new DisposableCollection();
    const channel = new WSChannel(connection, options);

    disposable.push(
      connection.onMessage((data) => {
        channel.dispatchChannelMessage(parse(data));
      }),
    );
    disposable.push(channel);

    disposable.push(
      connection.onceClose(() => {
        disposable.dispose();
      }),
    );

    return channel;
  }

  constructor(public connection: IConnectionShape<Uint8Array>, options: IWSChannelCreateOptions) {
    const { id, logger } = options;
    this.id = id;

    if (logger) {
      this.logger = logger;
    }
  }

  onMessage(cb: (data: string) => any) {
    return this.emitter.on('message', cb);
  }
  onBinary(cb: (data: Uint8Array) => any) {
    return this.emitter.on('binary', cb);
  }
  onOpen(cb: (id: string) => void) {
    return this.emitter.on('open', cb);
  }
  onReopen(cb: () => void) {
    return this.emitter.on('reopen', cb);
  }

  serverReady() {
    this.connection.send(
      stringify({
        kind: 'server-ready',
        id: this.id,
      }),
    );
  }

  dispatchChannelMessage(msg: ChannelMessage) {
    switch (msg.kind) {
      case 'server-ready':
        this.emitter.emit('open', msg.id);
        break;
      case 'data':
        this.emitter.emit('message', msg.content);
        break;
      case 'binary':
        this.emitter.emit('binary', msg.binary);
        break;
    }
  }

  open(path: string, clientId: string) {
    this.channelPath = path;
    this.connection.send(
      stringify({
        kind: 'open',
        id: this.id,
        path,
        clientId,
      }),
    );
  }

  send(content: string) {
    this.connection.send(
      stringify({
        kind: 'data',
        id: this.id,
        content,
      }),
    );
  }

  sendBinary(data: Uint8Array) {
    this.connection.send(
      stringify({
        kind: 'binary',
        id: this.id,
        binary: data,
      }),
    );
  }
  onError() {}
  close(code?: number, reason?: string) {
    this.emitter.emit('close', code, reason);
  }
  fireReopen() {
    this.emitter.emit('reopen');
  }
  onClose(cb: (code: number, reason: string) => void) {
    return this.emitter.on('close', cb);
  }
  onceClose(cb: (code: number, reason: string) => void) {
    return this.emitter.once('close', cb);
  }

  createConnection() {
    return {
      onceClose: (cb: (code: number, reason: string) => void) => this.onceClose(cb),
      onMessage: (cb: (data: Uint8Array) => any) => this.onBinary(cb),
      send: (data: Uint8Array) => {
        this.sendBinary(data);
      },
      dispose() {},
    };
  }

  createSumiConnection(options: ISumiConnectionOptions = {}) {
    const conn = new SumiConnection(this.createConnection(), options);
    return conn;
  }

  dispose() {
    this.emitter.dispose();
  }
}

export const PingProtocol = Type.object('ping', {
  clientId: Type.string(),
  id: Type.string(),
});

export const PongProtocol = Type.object('pong', {
  clientId: Type.string(),
  id: Type.string(),
});

export const OpenProtocol = Type.object('open', {
  clientId: Type.string(),
  id: Type.string(),
  path: Type.string(),
});

export const ServerReadyProtocol = Type.object('server-ready', {
  id: Type.string(),
});

export const DataProtocol = Type.object('data', {
  id: Type.string(),
  content: Type.string(),
});

export const BinaryProtocol = Type.object('binary', {
  id: Type.string(),
  binary: Type.binary(),
});

export const CloseProtocol = Type.object('close', {
  id: Type.string(),
  code: Type.uint32(),
  reason: Type.string(),
});

const serializer = oneOf7([
  PingProtocol,
  PongProtocol,
  OpenProtocol,
  ServerReadyProtocol,
  DataProtocol,
  BinaryProtocol,
  CloseProtocol,
]);

export function stringify(obj: ChannelMessage): Uint8Array {
  return serializer.serialize(obj);
}

export function parse(input: Uint8Array): ChannelMessage {
  return serializer.deserialize(input) as any;
}

const _pingMessage: PingMessage = {
  kind: 'ping',
  id: '',
  clientId: '',
};

const _pongMessage: PongMessage = {
  kind: 'pong',
  id: '',
  clientId: '',
};

export const pingMessage = stringify(_pingMessage);
export const pongMessage = stringify(_pongMessage);
