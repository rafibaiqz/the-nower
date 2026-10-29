/**
 * Raw WebSocket implementation of the transport, used inside the Cloudflare Durable Object.
 *
 * Wire protocol (JSON text frames):
 *   client -> server  {"t":"e","e":<event>,"d":<payload>,"a":<ackId?>}   event (ack requested if "a" is set)
 *                     {"t":"p"}                                          keep-alive ping
 *   server -> client  {"t":"e","e":<event>,"d":<payload>}                event
 *                     {"t":"a","a":<ackId>,"d":<result>}                 acknowledgement
 *                     {"t":"p"}                                          pong
 * Only uses the standard WebSocket interface (send/close/addEventListener), so it also runs
 * against in-memory fakes in the unit tests.
 */
import { randomHex } from './random';
import type { Conn, Hub } from './transport';

/** WebSocket close code for a server-initiated disconnect (client mirrors 'io server disconnect'). */
export const SERVER_KICK = 4001;

export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', fn: (ev: unknown) => void): void;
}

const MAX_FRAME = 16_000;
const STALE_MS = 60_000;

class WsConn implements Conn {
  readonly id = randomHex(10);
  readonly rooms = new Set<string>();
  lastSeen = Date.now();
  private handlers = new Map<string, ((payload: unknown, ack?: unknown) => void)[]>();
  private closed = false;

  constructor(
    private ws: WsLike,
    private hub: WsHub,
  ) {
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    ws.addEventListener('close', () => this.onClose('transport close'));
    ws.addEventListener('error', () => this.onClose('transport error'));
  }

  private send(frame: unknown) {
    if (this.closed) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      this.onClose('send failed');
    }
  }

  private onMessage(raw: unknown) {
    this.lastSeen = Date.now();
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return;
    let msg: { t?: unknown; e?: unknown; d?: unknown; a?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'p') return this.send({ t: 'p' });
    if (msg.t !== 'e' || typeof msg.e !== 'string') return;
    const ackId = typeof msg.a === 'number' && Number.isInteger(msg.a) ? msg.a : null;
    const ack = ackId === null ? undefined : (res: unknown) => this.send({ t: 'a', a: ackId, d: res });
    for (const h of this.handlers.get(msg.e) ?? []) h(msg.d, ack);
  }

  onClose(reason: string, code = 1000) {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason);
    } catch {
      /* already closed */
    }
    this.hub.remove(this);
    for (const h of this.handlers.get('disconnect') ?? []) h(reason);
  }

  emit(event: string, data?: unknown) {
    this.send({ t: 'e', e: event, d: data });
  }
  join(room: string) {
    this.rooms.add(room);
    this.hub.joinRoom(this, room);
  }
  leave(room: string) {
    this.rooms.delete(room);
    this.hub.leaveRoom(this, room);
  }
  /** Server-side kick; the client does not auto-reconnect after SERVER_KICK. */
  disconnect() {
    this.onClose('server disconnect', SERVER_KICK);
  }
  on(event: string, handler: (payload: unknown, ack?: unknown) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
}

export class WsHub implements Hub {
  private conns = new Map<string, WsConn>();
  private rooms = new Map<string, Set<WsConn>>();

  /** Registers an accepted WebSocket and returns its connection. */
  add(ws: WsLike): Conn {
    const c = new WsConn(ws, this);
    this.conns.set(c.id, c);
    return c;
  }

  get size() {
    return this.conns.size;
  }

  get(id: string): Conn | undefined {
    return this.conns.get(id);
  }

  toRoom(room: string, event: string, data: unknown) {
    const set = this.rooms.get(room);
    if (set) for (const c of set) c.emit(event, data);
  }

  toConn(id: string, event: string, data: unknown) {
    this.conns.get(id)?.emit(event, data);
  }

  joinRoom(c: WsConn, room: string) {
    let set = this.rooms.get(room);
    if (!set) this.rooms.set(room, (set = new Set()));
    set.add(c);
  }

  leaveRoom(c: WsConn, room: string) {
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(c);
    if (!set.size) this.rooms.delete(room);
  }

  remove(c: WsConn) {
    this.conns.delete(c.id);
    for (const r of c.rooms) this.leaveRoom(c, r);
  }

  /** Drops connections that went silent (clients ping every 20 s). */
  sweep(now = Date.now()) {
    for (const c of [...this.conns.values()]) if (now - c.lastSeen > STALE_MS) c.onClose('ping timeout');
  }
}
