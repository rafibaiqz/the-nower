/**
 * The raw-WebSocket transport used by the Cloudflare Durable Object, driven through in-memory
 * fake sockets: same LobbyManager + handlers as the Socket.IO server, different wire.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Ack, JoinAck, LobbyInfo, MatchInit } from '@nower/shared';
import { LobbyManager } from '../src/lobby/LobbyManager';
import { wireConnection } from '../src/net/handlers';
import { SERVER_KICK, WsHub, type WsLike } from '../src/net/wsHub';

type Frame = { t: string; e?: string; d?: unknown; a?: number };

class FakeWs implements WsLike {
  sent: Frame[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private listeners: Record<string, ((ev: any) => void)[]> = {};
  send(data: string) {
    if (this.closed) throw new Error('closed');
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = { code, reason };
    this.fire('close', {});
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type: string, ev: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  /** Client -> server frame. */
  push(frame: unknown) {
    this.fire('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  private nextAck = 1;
  call<T = unknown>(e: string, d: unknown = {}): Ack<T> {
    const a = this.nextAck++;
    this.push({ t: 'e', e, d, a });
    const ack = this.sent.find((f) => f.t === 'a' && f.a === a);
    if (!ack) throw new Error(`no ack for ${e}`);
    return ack.d as Ack<T>;
  }
  events<T = unknown>(e: string): T[] {
    return this.sent.filter((f) => f.t === 'e' && f.e === e).map((f) => f.d as T);
  }
}

let lobbies: LobbyManager | null = null;
afterEach(() => lobbies?.dispose());

function setup() {
  const hub = new WsHub();
  lobbies = new LobbyManager(hub);
  const connect = () => {
    const ws = new FakeWs();
    wireConnection(hub.add(ws), lobbies!);
    return ws;
  };
  return { hub, connect };
}

describe('WebSocket transport (Cloudflare Durable Object)', () => {
  it('answers pings and ignores malformed, oversized and unknown frames', () => {
    const { hub, connect } = setup();
    const ws = connect();
    ws.push({ t: 'p' });
    expect(ws.sent).toEqual([{ t: 'p' }]);
    ws.push('not json');
    ws.push('x'.repeat(20_000));
    ws.push({ t: 'e', e: 'no:such:event', d: 1, a: 1 });
    ws.push({ t: 'e', e: 'lobby:create', d: { name: 'A' }, a: 'not-a-number' });
    expect(ws.closed).toBeNull();
    expect(hub.size).toBe(1);
  });

  it('runs create / join / settings / start with acks and room broadcasts', () => {
    const { connect } = setup();
    const a = connect();
    const b = connect();
    const created = a.call<JoinAck>('lobby:create', { name: 'Raff' });
    expect(created.ok).toBe(true);
    const code = created.data!.lobby.code;
    const joined = b.call<JoinAck>('lobby:join', { code, name: 'Noer' });
    expect(joined.ok).toBe(true);
    expect(a.events<LobbyInfo>('lobby:update').at(-1)!.players).toHaveLength(2);

    expect(b.call('lobby:settings', { difficulty: 'hard' }).ok).toBe(false); // host only
    expect(a.call('lobby:settings', { difficulty: 'hard' }).ok).toBe(true);
    expect(b.events<LobbyInfo>('lobby:update').at(-1)!.settings.difficulty).toBe('hard');

    b.call('lobby:ready', { ready: true });
    const started = a.call('lobby:start');
    expect(started.ok).toBe(true);
    const initA = a.events<MatchInit>('game:start')[0]!;
    const initB = b.events<MatchInit>('game:start')[0]!;
    expect(initA.difficulty).toBe('hard');
    expect(initB.seed).toBe(initA.seed);
    expect(initA.you).not.toBe(initB.you);
  });

  it('lets a player resume its seat on a new socket and cleans rooms on close', () => {
    const { hub, connect } = setup();
    const a = connect();
    const b = connect();
    const created = a.call<JoinAck>('lobby:create', { name: 'Raff' });
    b.call<JoinAck>('lobby:join', { code: created.data!.lobby.code, name: 'Noer' });
    a.close();
    expect(hub.size).toBe(1);
    const a2 = connect();
    const resumed = a2.call<JoinAck>('lobby:resume', { token: created.data!.token });
    expect(resumed.ok).toBe(true);
    expect(resumed.data!.playerId).toBe(created.data!.playerId);
    // the room now reaches the new socket, not the closed one
    const before = a.sent.length;
    b.call('lobby:ready', { ready: true });
    expect(a2.events('lobby:update').length).toBeGreaterThan(0);
    expect(a.sent.length).toBe(before);
  });

  it('drops silent connections and kicks with a distinct close code', () => {
    const { hub, connect } = setup();
    const quiet = connect();
    const busy = connect();
    busy.push({ t: 'p' });
    hub.sweep(Date.now() + 61_000);
    expect(quiet.closed).not.toBeNull();
    expect(hub.size).toBe(0); // busy's ping was "now", also older than 61 s in the future
    const ws = connect();
    for (let i = 0; i < 2000 && !ws.closed; i++) ws.push({ t: 'e', e: 'lobby:create', d: { name: 'spam' } });
    expect(ws.closed?.code).toBe(SERVER_KICK);
  });
});
