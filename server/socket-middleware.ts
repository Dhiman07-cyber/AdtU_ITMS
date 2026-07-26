import type WebSocket from 'ws';
import type { Session } from './session-manager';

export type SocketMiddleware = (ws: WebSocket, session: Session, payload: any, next: () => void) => void;

const middlewares: SocketMiddleware[] = [];

export function use(mw: SocketMiddleware): void {
  middlewares.push(mw);
}

export function runMiddlewareChain(ws: WebSocket, session: Session, payload: any): boolean {
  let index = -1;

  const next = () => {
    index++;
    if (index < middlewares.length) {
      middlewares[index](ws, session, payload, next);
    }
  };

  next();

  return index >= middlewares.length;
}
