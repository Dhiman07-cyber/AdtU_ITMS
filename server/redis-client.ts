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

        return new Promise((resolve) => {
            try {
                this.clientSocket = net.createConnection({ host: this.host, port: this.port }, () => {
                    this.isConnected = true;
                    logger.info('redis_client_connected', { host: this.host, port: this.port });
                    if (this.password && this.clientSocket) {
                        this.sendCommand(this.clientSocket, ['AUTH', this.password]);
                    }
                    resolve(true);
                });

                this.clientSocket.on('error', (err) => {
                    logger.warn('redis_client_error', { error: err.message });
                    this.isConnected = false;
                    this.scheduleReconnect();
                    resolve(false);
                });

                this.clientSocket.on('close', () => {
                    this.isConnected = false;
                    this.scheduleReconnect();
                });

                this.initSubSocket();
            } catch (err) {
                logger.warn('redis_connection_exception', { error: (err as Error).message });
                this.scheduleReconnect();
                resolve(false);
            }
        });
    }

    private initSubSocket() {
        try {
            this.subSocket = net.createConnection({ host: this.host, port: this.port }, () => {
                this.isSubConnected = true;
                if (this.password && this.subSocket) {
                    this.sendCommand(this.subSocket, ['AUTH', this.password]);
                }
                for (const channel of this.pubSubHandlers.keys()) {
                    if (this.subSocket) {
                        this.sendCommand(this.subSocket, ['SUBSCRIBE', channel]);
                    }
                }
            });

            let buffer = '';
            this.subSocket.on('data', (data) => {
                buffer += data.toString('utf-8');
                buffer = this.parseRespMessages(buffer);
            });

            this.subSocket.on('error', () => {
                this.isSubConnected = false;
            });

            this.subSocket.on('close', () => {
                this.isSubConnected = false;
            });
        } catch {
            this.isSubConnected = false;
        }
    }

    private parseRespMessages(buffer: string): string {
        const lines = buffer.split('\r\n');
        let idx = 0;
        while (idx < lines.length - 1) {
            if (lines[idx].startsWith('*3')) {
                if (lines[idx + 2] === 'message') {
                    const channel = lines[idx + 4];
                    const msg = lines[idx + 6];
                    if (channel && msg) {
                        const handlers = this.pubSubHandlers.get(channel);
                        if (handlers) {
                            for (const handler of handlers) {
                                try { handler(msg); } catch (e) { /* ignore handler errors */ }
                            }
                        }
                    }
                }
            }
            idx++;
        }
        return lines[lines.length - 1];
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000);
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
