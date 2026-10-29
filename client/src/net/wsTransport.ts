/**
 * Raw-WebSocket client transport for the Cloudflare deployment (Durable Object game server).
 * Implements the small subset of the Socket.IO client API the game uses — named events,
 * acknowledgements, volatile sends, automatic reconnection — over the JSON protocol described in
 * server/src/net/wsHub.ts, so the rest of the client is transport-agnostic.
 */
type Fn = (...args: any[]) => void;

const PING_MS = 20_000;
const SILENCE_MS = 45_000;
/** Close code the server uses to kick a connection (server/src/net/wsHub.ts SERVER_KICK). */
const SERVER_KICK = 4001;

export interface ClientSocket {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, fn: Fn): void;
  off(event: string, fn?: Fn): void;
  emit(event: string, payload?: unknown, ack?: Fn): void;
  readonly volatile: { emit(event: string, payload?: unknown): void };
}

export class WsTransport implements ClientSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Fn>>();
  private acks = new Map<number, Fn>();
  private nextAck = 1;
  private manual = false;
  private attempt = 0;
  private wasOpen = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessage = 0;

  constructor(private readonly url: string) {}

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  readonly volatile = {
    emit: (event: string, payload?: unknown) => {
      // like Socket.IO volatile: drop instead of queueing when the link is congested
      if (this.connected && this.ws!.bufferedAmount < 64_000) this.send({ t: 'e', e: event, d: payload });
    },
  };

  connect() {
    this.manual = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.wasOpen = true;
      this.lastMessage = Date.now();
      this.startPing();
      this.dispatch('connect');
    };
    ws.onmessage = (ev) => {
      this.lastMessage = Date.now();
      if (typeof ev.data !== 'string') return;
      let msg: { t?: string; e?: string; d?: unknown; a?: number };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'e' && typeof msg.e === 'string') this.dispatch(msg.e, msg.d);
      else if (msg.t === 'a' && typeof msg.a === 'number') {
        const cb = this.acks.get(msg.a);
        this.acks.delete(msg.a);
        cb?.(msg.d);
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.ws = null;
      this.acks.clear();
      // like Socket.IO, a server-side kick is final: no automatic reconnection
      if (ev.code === SERVER_KICK) this.manual = true;
      const reason = ev.code === SERVER_KICK ? 'io server disconnect' : this.manual ? 'io client disconnect' : 'transport close';
      if (this.wasOpen) this.dispatch('disconnect', reason);
      else this.dispatch('connect_error', new Error('WebSocket connection failed'));
      this.wasOpen = false;
      if (!this.manual) this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manual = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'client disconnect');
  }

  on(event: string, fn: Fn) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
  }

  off(event: string, fn?: Fn) {
    if (!fn) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, payload?: unknown, ack?: Fn) {
    if (!this.connected) return;
    const frame: { t: 'e'; e: string; d: unknown; a?: number } = { t: 'e', e: event, d: payload };
    if (ack) {
      frame.a = this.nextAck++;
      this.acks.set(frame.a, ack);
    }
    this.send(frame);
  }

  private send(frame: unknown) {
    try {
      this.ws?.send(JSON.stringify(frame));
    } catch {
      /* closing */
    }
  }

  private dispatch(event: string, ...args: unknown[]) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(...args);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessage > SILENCE_MS) {
        this.ws?.close(4000, 'silent');
        return;
      }
      this.send({ t: 'p' });
    }, PING_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect() {
    const delay = Math.min(4000, 800 * 2 ** this.attempt++) * (0.8 + Math.random() * 0.4);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
