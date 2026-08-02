import * as net from 'net';
import { logger } from './structured-logger';

export interface RedisClientOptions {
    url?: string;
    connectTimeoutMs?: number;
    reconnectIntervalMs?: number;
}

export class ResilientRedisClient {
    private clientSocket: net.Socket | null = null;
    private subSocket: net.Socket | null = null;
    private isConnected = false;
    private isSubConnected = false;
    private options: RedisClientOptions;
    private pubSubHandlers = new Map<string, Set<(message: string) => void>>();
    private reconnectTimer: NodeJS.Timeout | null = null;
    private generation = 0;
    private subGeneration = 0;
    private lastSubRecoveryAt = 0;
    private host = '127.0.0.1';
    private port = 6379;
    private password?: string;

    constructor(options?: RedisClientOptions) {
        this.options = options || {};
        this.parseUrl(process.env.REDIS_URL || this.options.url);
    }

    private parseUrl(urlStr?: string) {
        if (!urlStr) return;
        try {
            const parsed = new URL(urlStr);
            this.host = parsed.hostname || '127.0.0.1';
            this.port = parseInt(parsed.port || '6379', 10);
            if (parsed.password) {
                this.password = parsed.password;
            }
        } catch {
            logger.warn('redis_url_parse_failed', { url: urlStr });
        }
    }

    public async connect(): Promise<boolean> {
        if (!process.env.REDIS_URL && !this.options.url) {
            logger.info('redis_not_configured_using_memory_fallback');
            return false;
        }

        // Bump the generation before creating a new socket so callbacks from
        // any previous socket (error/close) are ignored — they must not clear
        // state or schedule reconnects for a socket we have already replaced.
        this.generation++;
        const gen = this.generation;
        if (this.clientSocket && !this.clientSocket.destroyed) this.clientSocket.destroy();

        return new Promise((resolve) => {
            try {
                this.clientSocket = net.createConnection({ host: this.host, port: this.port }, () => {
                    if (gen !== this.generation) return;
                    this.isConnected = true;
                    this.clientSocket?.setKeepAlive(true, 30000);
                    logger.info('redis_client_connected', { host: this.host, port: this.port });
                    if (this.password && this.clientSocket) {
                        this.sendCommand(this.clientSocket, ['AUTH', this.password]);
                    }
                    resolve(true);
                });

                this.clientSocket.on('error', (err) => {
                    if (gen !== this.generation) return;
                    logger.warn('redis_client_error', { error: err.message });
                    this.isConnected = false;
                    this.scheduleReconnect();
                    resolve(false);
                });

                this.clientSocket.on('close', () => {
                    if (gen !== this.generation) return;
                    this.isConnected = false;
                    this.scheduleReconnect();
                });

                this.initSubSocket();
            } catch (err) {
                if (gen !== this.generation) return;
                logger.warn('redis_connection_exception', { error: (err as Error).message });
                this.scheduleReconnect();
                resolve(false);
            }
        });
    }

    private initSubSocket() {
        // Replacing an old sub socket invalidates its callbacks via subGeneration.
        this.subGeneration++;
        const gen = this.subGeneration;
        if (this.subSocket && !this.subSocket.destroyed) this.subSocket.destroy();

        try {
            this.subSocket = net.createConnection({ host: this.host, port: this.port }, () => {
                if (gen !== this.subGeneration) return;
                this.isSubConnected = true;
                this.subSocket?.setKeepAlive(true, 30000);
                if (this.password && this.subSocket) {
                    this.sendCommand(this.subSocket, ['AUTH', this.password]);
                }
                for (const channel of this.pubSubHandlers.keys()) {
                    if (this.subSocket) {
                        this.sendCommand(this.subSocket, ['SUBSCRIBE', channel]);
                    }
                }
            });

            let subBuffer = Buffer.alloc(0);
            this.subSocket.on('data', (chunk: Buffer) => {
                if (gen !== this.subGeneration) return;
                subBuffer = Buffer.from(Buffer.concat([subBuffer, chunk]));
                subBuffer = Buffer.from(this.parseRespMessages(subBuffer));
            });

            this.subSocket.on('error', (err) => {
                if (gen !== this.subGeneration) return;
                logger.warn('redis_sub_socket_error', { error: err.message });
                this.isSubConnected = false;
            });

            this.subSocket.on('close', () => {
                if (gen !== this.subGeneration) return;
                this.isSubConnected = false;
                // If the client socket is healthy, recover the sub socket and
                // resubscribe all channels. Rate-limited to avoid a hot loop
                // when Redis keeps dropping the subscription connection.
                const now = Date.now();
                if (this.isConnected && now - this.lastSubRecoveryAt > 2000) {
                    this.lastSubRecoveryAt = now;
                    logger.warn('redis_sub_socket_closed_recovering');
                    this.initSubSocket();
                }
            });
        } catch {
            this.isSubConnected = false;
        }
    }

    private parseRespMessages(buffer: Buffer): Buffer {
        let offset = 0;

        const parseElement = (pos: number): { value: string | number | null; nextPos: number } | null => {
            if (pos >= buffer.length) return null;
            const prefix = buffer[pos];
            const crlf = buffer.indexOf('\r\n', pos);
            if (crlf === -1) return null;

            if (prefix === 0x24) { // '$' bulk string
                const len = parseInt(buffer.toString('utf8', pos + 1, crlf), 10);
                if (len === -1) {
                    return { value: null, nextPos: crlf + 2 };
                }
                const end = crlf + 2 + len;
                if (end + 2 > buffer.length) return null;
                const str = buffer.toString('utf8', crlf + 2, end);
                return { value: str, nextPos: end + 2 };
            } else if (prefix === 0x3a) { // ':' integer
                const val = parseInt(buffer.toString('utf8', pos + 1, crlf), 10);
                return { value: val, nextPos: crlf + 2 };
            } else if (prefix === 0x2b || prefix === 0x2d) { // '+' simple string, '-' error
                const str = buffer.toString('utf8', pos + 1, crlf);
                return { value: str, nextPos: crlf + 2 };
            }
            return null;
        };

        while (offset < buffer.length) {
            if (buffer[offset] !== 0x2a) { // '*'
                const nextStar = buffer.indexOf('*', offset + 1);
                if (nextStar === -1) return Buffer.alloc(0);
                offset = nextStar;
            }

            const crlf1 = buffer.indexOf('\r\n', offset);
            if (crlf1 === -1) break;

            const numElements = parseInt(buffer.toString('utf8', offset + 1, crlf1), 10);
            let curr = crlf1 + 2;

            if (numElements < 0) {
                offset = curr;
                continue;
            }

            const elem1 = parseElement(curr);
            if (!elem1) break;

            if (elem1.value === 'message' && numElements === 3) {
                const elem2 = parseElement(elem1.nextPos);
                if (!elem2) break;

                const elem3 = parseElement(elem2.nextPos);
                if (!elem3) break;

                offset = elem3.nextPos;
                const channel = String(elem2.value);
                const message = String(elem3.value);

                const handlers = this.pubSubHandlers.get(channel);
                if (handlers) {
                    for (const handler of handlers) {
                        try { handler(message); } catch { }
                    }
                }
            } else {
                let nextPos = elem1.nextPos;
                let incomplete = false;
                for (let i = 1; i < numElements; i++) {
                    const elem = parseElement(nextPos);
                    if (!elem) {
                        incomplete = true;
                        break;
                    }
                    nextPos = elem.nextPos;
                }
                if (incomplete) break;
                offset = nextPos;
            }
        }
        return buffer.subarray(offset);
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return;
        const jitterMs = Math.floor(Math.random() * 2000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000 + jitterMs);
    }

    private sendCommand(socket: net.Socket, args: string[]) {
        if (!socket || socket.destroyed) return;
        let command = `*${args.length}\r\n`;
        for (const arg of args) {
            command += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
        }
        socket.write(command);
    }

    public async publish(channel: string, message: string): Promise<void> {
        if (this.isConnected && this.clientSocket) {
            this.sendCommand(this.clientSocket, ['PUBLISH', channel, message]);
        }
    }

    public async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
        let handlers = this.pubSubHandlers.get(channel);
        if (!handlers) {
            handlers = new Set();
            this.pubSubHandlers.set(channel, handlers);
            if (this.isSubConnected && this.subSocket) {
                this.sendCommand(this.subSocket, ['SUBSCRIBE', channel]);
            }
        }
        handlers.add(handler);
    }

    public async unsubscribe(channel: string): Promise<void> {
        this.pubSubHandlers.delete(channel);
        if (this.isSubConnected && this.subSocket) {
            this.sendCommand(this.subSocket, ['UNSUBSCRIBE', channel]);
        }
    }

    public isReady(): boolean {
        return this.isConnected;
    }
}

export const redisClient = new ResilientRedisClient();
