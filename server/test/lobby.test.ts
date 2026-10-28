/** Real Socket.IO multiplayer tests against a live server instance. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Ack, GameEvent, JoinAck, LobbyInfo, MatchInit, Snapshot } from '@nower/shared';
import { createGameServer, type GameServer } from '../src/server';

let server: GameServer;
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  server = await createGameServer(0, '127.0.0.1');
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

function client(): Promise<Socket> {
  const s = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  return new Promise((r) => s.on('connect', () => r(s)));
}
function emit<T = unknown>(s: Socket, ev: string, payload: unknown = {}): Promise<Ack<T>> {
  return new Promise((r) => s.emit(ev, payload, r));
}
function waitFor<T = unknown>(s: Socket, ev: string, pred?: (d: T) => boolean, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (d: T) => {
      if (!pred || pred(d)) {
        clearTimeout(timer);
        s.off(ev, h);
        resolve(d);
      }
    };
    s.on(ev, h);
  });
}
function waitEvent(s: Socket, pred: (e: GameEvent) => boolean, ms = 8000): Promise<GameEvent> {
  return waitFor<GameEvent[]>(s, 'g:ev', (evs) => evs.some(pred), ms).then((evs) => evs.find(pred)!);
}

describe('lobbies', () => {
  it('creates a lobby with a readable code and lets a second player join', async () => {
    const a = await client();
    const b = await client();
    const created = await emit<JoinAck>(a, 'lobby:create', { name: 'Raff' });
    expect(created.ok).toBe(true);
    const code = created.data!.lobby.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(created.data!.lobby.players[0].host).toBe(true);
    const seenByA = waitFor<LobbyInfo>(a, 'lobby:update', (l) => l.players.length === 2);
    const joined = await emit<JoinAck>(b, 'lobby:join', { name: 'Noer', code: code.toLowerCase() });
    expect(joined.ok).toBe(true);
    const infoA = await seenByA;
    expect(infoA.players.map((p) => p.name).sort()).toEqual(['Noer', 'Raff']);
    expect(joined.data!.lobby.players.length).toBe(2);
  });

  it('rejects invalid, unknown and full lobbies with clear errors', async () => {
    const a = await client();
    const b = await client();
    const c = await client();
    const bad = await emit(b, 'lobby:join', { name: 'X', code: '12' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/5 letters/);
    const unknown = await emit(b, 'lobby:join', { name: 'X', code: 'ZZZZZ' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/No lobby/);
    const created = await emit<JoinAck>(a, 'lobby:create', { name: 'Host' });
    const code = created.data!.lobby.code;
    expect((await emit(a, 'lobby:settings', { maxPlayers: 2 })).ok).toBe(true);
    expect((await emit(b, 'lobby:join', { name: 'Two', code })).ok).toBe(true);
    const full = await emit(c, 'lobby:join', { name: 'Three', code });
    expect(full.ok).toBe(false);
    expect(full.error).toMatch(/full/);
    const noName = await emit(c, 'lobby:create', { name: '   ' });
    expect(noName.ok).toBe(false);
  });

  it('transfers host when the host leaves, and closes empty lobbies', async () => {
    const a = await client();
    const b = await client();
    const code = (await emit<JoinAck>(a, 'lobby:create', { name: 'First' })).data!.lobby.code;
    const bId = (await emit<JoinAck>(b, 'lobby:join', { name: 'Second', code })).data!.playerId;
    const upd = waitFor<LobbyInfo>(b, 'lobby:update', (l) => l.players.length === 1);
    await emit(a, 'lobby:leave');
    const info = await upd;
    expect(info.players[0].id).toBe(bId);
    expect(info.players[0].host).toBe(true);
    await emit(b, 'lobby:leave');
    expect(server.lobbies.lobbies.has(code)).toBe(false);
  });
});

describe('multiplayer match', () => {
  it('starts only when ready, syncs both clients, validates actions and survives reconnects', async () => {
    const a = await client();
    let b = await client();
    const created = await emit<JoinAck>(a, 'lobby:create', { name: 'Raff' });
    const code = created.data!.lobby.code;
    const joinB = await emit<JoinAck>(b, 'lobby:join', { name: 'Noer', code });
    const bToken = joinB.data!.token;
    const bId = joinB.data!.playerId;
    const aId = created.data!.playerId;

    // not everyone ready
    const early = await emit(a, 'lobby:start');
    expect(early.ok).toBe(false);
    expect(early.error).toMatch(/Noer/);
    // non-host cannot start or change settings
    expect((await emit(b, 'lobby:start')).ok).toBe(false);
    expect((await emit(b, 'lobby:settings', { difficulty: 'hard' })).ok).toBe(false);

    await emit(b, 'lobby:ready', { ready: true });
    const startA = waitFor<MatchInit>(a, 'game:start');
    const startB = waitFor<MatchInit>(b, 'game:start');
    expect((await emit(a, 'lobby:start')).ok).toBe(true);
    const [ia, ib] = await Promise.all([startA, startB]);
    expect(ia.seed).toBe(ib.seed);
    expect(ia.items.map((i) => i.pos.join(','))).toEqual(ib.items.map((i) => i.pos.join(',')));
    expect(ia.you).toBe(aId);
    expect(ib.you).toBe(bId);

    // late joiners are refused
    const c = await client();
    const late = await emit(c, 'lobby:join', { name: 'Late', code });
    expect(late.ok).toBe(false);
    expect(late.error).toMatch(/already started/);

    // wait for the countdown, then move A and watch B's snapshots
    await waitEvent(b, (e) => e.k === 'phase' && e.phase === 'PLAYING', 8000);
    const startPos = ib.snapshot.p.find((p) => p[0] === aId)!;
    const target = { x: startPos[1] + 0.25, y: startPos[2], z: startPos[3] };
    a.emit('g:move', { seq: 0, ...target, yaw: 0, pitch: 0, flags: 0 });
    const snap = await waitFor<Snapshot>(b, 'g:snap', (s) => {
      const p = s.p.find((pp) => pp[0] === aId);
      return !!p && Math.abs(p[1] - target.x) < 0.01;
    });
    expect(snap.e.length).toBe(8);

    // a teleport-hack move is rejected with a correction
    const corr = waitEvent(a, (e) => e.k === 'teleport' && e.player === aId);
    a.emit('g:move', { seq: 0, x: target.x + 30, y: target.y, z: target.z, yaw: 0, pitch: 0, flags: 0 });
    const tp = (await corr) as Extract<GameEvent, { k: 'teleport' }>;
    expect(Math.abs(tp.pos[0] - target.x)).toBeLessThan(0.01);

    // concurrent pickup of the same unique item: exactly one wins
    const lobby = server.lobbies.lobbies.get(code)!;
    const match = lobby.match!;
    const item = [...match.items.values()].find((i) => i.type === 'wrench')!;
    if (item.container >= 0) match.containers[item.container] = true;
    const sp = match.level.spawns.find((s) => s.pos[0] === item.pos[0] && s.pos[2] === item.pos[2])!;
    const ax = sp.access[0] + 0.5;
    const az = sp.access[1] + 0.5;
    const ay = match.level.floors[sp.f].base;
    match.testPlace(aId, ax, ay, az);
    match.testPlace(bId, ax, ay, az);
    const [ra, rb] = await Promise.all([emit(a, 'g:act', { ref: 'item:wrench' }), emit(b, 'g:act', { ref: 'item:wrench' })]);
    expect([ra.ok, rb.ok].filter(Boolean).length).toBe(1);
    const holder = match.items.get('wrench')!.holder;
    expect([aId, bId]).toContain(holder);

    // door state is synchronised to the other client
    const door = match.level.doors.findIndex((d) => d.spec.id === 'westbed_sewing');
    const dc = match.level.doors[door].center;
    match.testPlace(aId, dc[0], dc[1], dc[2] - 1, Math.PI);
    const doorEv = waitEvent(b, (e) => e.k === 'door' && e.i === door);
    expect((await emit(a, 'g:act', { ref: `door:${door}` })).ok).toBe(true);
    const de = (await doorEv) as Extract<GameEvent, { k: 'door' }>;
    expect(de.open).toBe(true);

    // B drops out while holding the item: it is put back in the world
    match.testGive(bId, 'wrench');
    const discon = waitEvent(a, (e) => e.k === 'player' && e.s.id === bId && !e.s.connected);
    b.disconnect();
    await discon;
    expect(match.items.get('wrench')!.place).toBe('world');

    // B reconnects with the token: same identity, full state, no duplicates
    b = await client();
    const resumed = await emit<JoinAck>(b, 'lobby:resume', { token: bToken });
    expect(resumed.ok).toBe(true);
    expect(resumed.data!.playerId).toBe(bId);
    expect(resumed.data!.match).toBeTruthy();
    const ids = resumed.data!.match!.players.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);
    expect(resumed.data!.match!.players.find((p) => p.id === bId)!.connected).toBe(true);
    expect(resumed.data!.lobby.players.length).toBe(2);

    // an invalid token is refused
    const bogus = await emit(c, 'lobby:resume', { token: 'f'.repeat(48) });
    expect(bogus.ok).toBe(false);
  });

  it('serves a health check', async () => {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { status: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
  });
});
