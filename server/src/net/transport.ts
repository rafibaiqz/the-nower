/**
 * Transport abstraction for the lobby and match code. The game server runs on two transports:
 *  - Socket.IO on a Node.js process (local dev, Docker, any Node host) — see socketio.ts
 *  - raw WebSockets inside a Cloudflare Durable Object — see wsHub.ts and ../worker.ts
 * Both expose the same connection/room semantics, so LobbyManager and Match are shared.
 */

/** Called when the client asked for an acknowledgement (request/response). */
export type AckFn = (res: { ok: boolean; error?: string; data?: unknown }) => void;

export interface Conn {
  readonly id: string;
  emit(event: string, data?: unknown): void;
  join(room: string): void;
  leave(room: string): void;
  disconnect(): void;
  /** Handlers receive the payload and, if the client requested one, an ack callback. */
  on(event: string, handler: (payload: unknown, ack?: unknown) => void): void;
}

export interface Hub {
  /** Emit to every connection in a room. Volatile messages may be dropped under backpressure. */
  toRoom(room: string, event: string, data: unknown, volatile?: boolean): void;
  /** Emit to one connection by id (no-op if it is gone). */
  toConn(id: string, event: string, data: unknown): void;
  get(id: string): Conn | undefined;
}
