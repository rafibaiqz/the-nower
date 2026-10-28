/**
 * Server-managed lobbies. Lobby existence, membership, host role, readiness and settings live
 * only here; clients are told about them. Each player gets a secret reconnection token so a
 * dropped connection (refresh, network blip) can resume the same identity without duplicates.
 */
import { randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  DIFFICULTY,
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  PLAYER_COLORS,
  type Difficulty,
  type JoinAck,
  type LobbyInfo,
  type LobbySettings,
  type MatchResult,
} from '@nower/shared';
import { config } from '../config';
import { log } from '../log';
import { Match } from '../match/Match';

export interface Member {
  id: string;
  name: string;
  token: string;
  socketId: string | null;
  ready: boolean;
  color: number;
  disconnectedAt: number | null;
}

export interface Lobby {
  code: string;
  hostId: string;
  members: Map<string, Member>;
  settings: LobbySettings;
  state: 'LOBBY' | 'IN_GAME';
  match: Match | null;
  createdAt: number;
  lastActivity: number;
  endedAt: number;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const LOBBY_DISCONNECT_GRACE_MS = 30_000;

export class LobbyManager {
  readonly lobbies = new Map<string, Lobby>();
  private tokens = new Map<string, { code: string; playerId: string }>();
  private socketIndex = new Map<string, { code: string; playerId: string }>();
  private sweeper: ReturnType<typeof setInterval>;

  constructor(private io: Server) {
    this.sweeper = setInterval(() => this.sweep(), 5000);
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const l of this.lobbies.values()) l.match?.dispose();
  }

  room(code: string) {
    return `lobby:${code}`;
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const bytes = randomBytes(LOBBY_CODE_LENGTH);
      let code = '';
      for (let i = 0; i < LOBBY_CODE_LENGTH; i++) code += LOBBY_CODE_ALPHABET[bytes[i] % LOBBY_CODE_ALPHABET.length];
      if (!this.lobbies.has(code)) return code;
    }
    throw new Error('could not allocate lobby code');
  }

  private newId() {
    return randomBytes(8).toString('hex');
  }

  memberOf(socket: Socket): { lobby: Lobby; member: Member } | null {
    const idx = this.socketIndex.get(socket.id);
    if (!idx) return null;
    const lobby = this.lobbies.get(idx.code);
    const member = lobby?.members.get(idx.playerId);
    if (!lobby || !member || member.socketId !== socket.id) return null;
    return { lobby, member };
  }

  info(lobby: Lobby): LobbyInfo {
    const players = [...lobby.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      ready: m.ready,
      connected: m.socketId !== null,
      host: m.id === lobby.hostId,
      color: m.color,
    }));
    const blocker = this.startBlocker(lobby);
    return {
      code: lobby.code,
      state: lobby.state,
      players,
      settings: { ...lobby.settings },
      serverMaxPlayers: config.maxPlayers,
      canStart: blocker === null,
      startBlocker: blocker,
    };
  }

  private startBlocker(lobby: Lobby): string | null {
    if (lobby.state !== 'LOBBY') return 'A match is already running.';
    const connected = [...lobby.members.values()].filter((m) => m.socketId !== null);
    if (connected.length === 0) return 'No players connected.';
    const notReady = connected.filter((m) => m.id !== lobby.hostId && !m.ready);
    if (notReady.length) return `Waiting for ${notReady.map((m) => m.name).join(', ')} to be ready.`;
    if (connected.length > lobby.settings.maxPlayers) return 'Too many players for this lobby.';
    return null;
  }

  broadcastLobby(lobby: Lobby) {
    this.io.to(this.room(lobby.code)).emit('lobby:update', this.info(lobby));
  }

  private attach(socket: Socket, lobby: Lobby, member: Member) {
    // one socket = one seat; a token used from a new socket takes the seat over
    if (member.socketId && member.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(member.socketId);
      this.socketIndex.delete(member.socketId);
      if (old) {
        old.emit('session:replaced', { reason: 'This seat was taken over by another tab or device.' });
        old.leave(this.room(lobby.code));
      }
    }
    member.socketId = socket.id;
    member.disconnectedAt = null;
    this.socketIndex.set(socket.id, { code: lobby.code, playerId: member.id });
    socket.join(this.room(lobby.code));
    lobby.lastActivity = Date.now();
  }

  /** Detach a socket from any lobby it currently occupies (used before create/join). */
  private detachExisting(socket: Socket) {
    const cur = this.memberOf(socket);
    if (cur) this.leave(socket);
  }

  create(socket: Socket, name: string): Result<JoinAck> {
    if (this.lobbies.size >= config.maxLobbies) return { ok: false, error: 'The server is full. Try again later.' };
    this.detachExisting(socket);
    const code = this.newCode();
    const id = this.newId();
    const token = randomBytes(24).toString('hex');
    const member: Member = { id, name, token, socketId: null, ready: false, color: PLAYER_COLORS[0], disconnectedAt: null };
    const lobby: Lobby = {
      code,
      hostId: id,
      members: new Map([[id, member]]),
      settings: { difficulty: 'normal', maxPlayers: config.maxPlayers },
      state: 'LOBBY',
      match: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      endedAt: 0,
    };
    this.lobbies.set(code, lobby);
    this.tokens.set(token, { code, playerId: id });
    this.attach(socket, lobby, member);
    log.info('lobby created', { code, host: name });
    this.broadcastLobby(lobby);
    return { ok: true, data: { lobby: this.info(lobby), playerId: id, token } };
  }

  join(socket: Socket, code: string, name: string): Result<JoinAck> {
    const lobby = this.lobbies.get(code);
    if (!lobby) return { ok: false, error: `No lobby with code ${code}. Check the code and try again.` };
    if (lobby.state !== 'LOBBY') return { ok: false, error: 'That game has already started.' };
    const seated = [...lobby.members.values()];
    if (seated.length >= lobby.settings.maxPlayers) return { ok: false, error: `That lobby is full (${lobby.settings.maxPlayers}/${lobby.settings.maxPlayers}).` };
    this.detachExisting(socket);
    const id = this.newId();
    const token = randomBytes(24).toString('hex');
    const used = new Set(seated.map((m) => m.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[seated.length % PLAYER_COLORS.length];
    let finalName = name;
    let n = 2;
    while (seated.some((m) => m.name.toLowerCase() === finalName.toLowerCase())) finalName = `${name.slice(0, 13)} ${n++}`;
    const member: Member = { id, name: finalName, token, socketId: null, ready: false, color, disconnectedAt: null };
    lobby.members.set(id, member);
    this.tokens.set(token, { code, playerId: id });
    this.attach(socket, lobby, member);
    log.info('player joined', { code, name: finalName });
    this.broadcastLobby(lobby);
    return { ok: true, data: { lobby: this.info(lobby), playerId: id, token } };
  }

  resume(socket: Socket, token: string): Result<JoinAck> {
    const t = this.tokens.get(token);
    const lobby = t ? this.lobbies.get(t.code) : undefined;
    const member = t && lobby ? lobby.members.get(t.playerId) : undefined;
    if (!t || !lobby || !member) return { ok: false, error: 'That session has expired.' };
    const cur = this.memberOf(socket);
    if (cur && cur.member.id !== member.id) this.leave(socket);
    this.attach(socket, lobby, member);
    let match;
    if (lobby.match && lobby.match.hasPlayer(member.id)) {
      lobby.match.handleReconnect(member.id);
      match = lobby.match.initFor(member.id);
    }
    log.info('player resumed', { code: lobby.code, name: member.name, inGame: !!match });
    this.broadcastLobby(lobby);
    return { ok: true, data: { lobby: this.info(lobby), playerId: member.id, token, match } };
  }

  leave(socket: Socket) {
    const cur = this.memberOf(socket);
    if (!cur) return;
    const { lobby, member } = cur;
    socket.leave(this.room(lobby.code));
    this.socketIndex.delete(socket.id);
    this.removeMember(lobby, member, 'left');
  }

  private removeMember(lobby: Lobby, member: Member, why: string) {
    lobby.members.delete(member.id);
    this.tokens.delete(member.token);
    if (member.socketId) this.socketIndex.delete(member.socketId);
    lobby.match?.removePlayer(member.id);
    log.info('player removed', { code: lobby.code, name: member.name, why });
    if (lobby.members.size === 0) {
      this.closeLobby(lobby, 'Everyone left.');
      return;
    }
    if (lobby.hostId === member.id) this.transferHost(lobby);
    this.broadcastLobby(lobby);
  }

  private transferHost(lobby: Lobby) {
    const next = [...lobby.members.values()].sort((a, b) => Number(b.socketId !== null) - Number(a.socketId !== null))[0];
    if (!next) return;
    lobby.hostId = next.id;
    next.ready = false;
    this.io.to(this.room(lobby.code)).emit('lobby:notice', { text: `${next.name} is now the host.` });
  }

  closeLobby(lobby: Lobby, reason: string) {
    lobby.match?.dispose();
    lobby.match = null;
    this.io.to(this.room(lobby.code)).emit('lobby:closed', { reason });
    for (const m of lobby.members.values()) {
      this.tokens.delete(m.token);
      if (m.socketId) {
        this.socketIndex.delete(m.socketId);
        this.io.sockets.sockets.get(m.socketId)?.leave(this.room(lobby.code));
      }
    }
    this.lobbies.delete(lobby.code);
    log.info('lobby closed', { code: lobby.code, reason });
  }

  setReady(socket: Socket, ready: boolean): Result<null> {
    const cur = this.memberOf(socket);
    if (!cur) return { ok: false, error: 'Not in a lobby.' };
    if (cur.lobby.state !== 'LOBBY') return { ok: false, error: 'The match already started.' };
    cur.member.ready = ready;
    this.broadcastLobby(cur.lobby);
    return { ok: true, data: null };
  }

  setSettings(socket: Socket, patch: { difficulty?: Difficulty; maxPlayers?: number }): Result<null> {
    const cur = this.memberOf(socket);
    if (!cur) return { ok: false, error: 'Not in a lobby.' };
    const { lobby, member } = cur;
    if (lobby.hostId !== member.id) return { ok: false, error: 'Only the host can change settings.' };
    if (lobby.state !== 'LOBBY') return { ok: false, error: 'The match already started.' };
    if (patch.difficulty && DIFFICULTY[patch.difficulty]) lobby.settings.difficulty = patch.difficulty;
    if (patch.maxPlayers !== undefined) {
      const mp = Math.round(patch.maxPlayers);
      if (mp < Math.max(1, lobby.members.size) || mp > config.maxPlayers) return { ok: false, error: `Max players must be between ${Math.max(1, lobby.members.size)} and ${config.maxPlayers}.` };
      lobby.settings.maxPlayers = mp;
    }
    // settings changes reset readiness so nobody starts on settings they did not see
    for (const m of lobby.members.values()) if (m.id !== lobby.hostId) m.ready = false;
    this.broadcastLobby(lobby);
    return { ok: true, data: null };
  }

  start(socket: Socket): Result<null> {
    const cur = this.memberOf(socket);
    if (!cur) return { ok: false, error: 'Not in a lobby.' };
    const { lobby, member } = cur;
    if (lobby.hostId !== member.id) return { ok: false, error: 'Only the host can start the game.' };
    const blocker = this.startBlocker(lobby);
    if (blocker) return { ok: false, error: blocker };
    // seats that are not connected right now are dropped from the match
    for (const m of [...lobby.members.values()]) if (m.socketId === null) this.removeMember(lobby, m, 'not connected at start');
    const players = [...lobby.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color }));
    const room = this.room(lobby.code);
    const match = new Match(players, lobby.settings.difficulty, {
      broadcast: (ev, data, vol) => (vol ? this.io.to(room).volatile.emit(ev, data) : this.io.to(room).emit(ev, data)),
      toPlayer: (pid, ev, data) => {
        const sid = lobby.members.get(pid)?.socketId;
        if (sid) this.io.to(sid).emit(ev, data);
      },
      onEnded: (result: MatchResult) => this.onMatchEnded(lobby, result),
    });
    lobby.match = match;
    lobby.state = 'IN_GAME';
    lobby.lastActivity = Date.now();
    for (const m of lobby.members.values()) {
      m.ready = false;
      if (m.socketId) this.io.to(m.socketId).emit('game:start', match.initFor(m.id));
    }
    match.start();
    log.info('match started', { code: lobby.code, players: players.length, difficulty: lobby.settings.difficulty });
    this.broadcastLobby(lobby);
    return { ok: true, data: null };
  }

  private onMatchEnded(lobby: Lobby, result: MatchResult) {
    lobby.endedAt = Date.now();
    log.info('lobby match ended', { code: lobby.code, result });
  }

  /** Host returns everyone to the waiting room after a match. */
  returnToLobby(socket: Socket): Result<null> {
    const cur = this.memberOf(socket);
    if (!cur) return { ok: false, error: 'Not in a lobby.' };
    const { lobby, member } = cur;
    if (lobby.state !== 'IN_GAME') return { ok: true, data: null };
    if (lobby.hostId !== member.id && !lobby.match?.isEnded) return { ok: false, error: 'The match is still running.' };
    if (!lobby.match?.isEnded) return { ok: false, error: 'The match is still running.' };
    this.resetToLobby(lobby);
    return { ok: true, data: null };
  }

  private resetToLobby(lobby: Lobby) {
    lobby.match?.dispose();
    lobby.match = null;
    lobby.state = 'LOBBY';
    for (const m of [...lobby.members.values()]) {
      m.ready = false;
      if (m.socketId === null) this.removeMember(lobby, m, 'disconnected during match');
    }
    if (!this.lobbies.has(lobby.code)) return;
    this.io.to(this.room(lobby.code)).emit('lobby:returned', this.info(lobby));
    this.broadcastLobby(lobby);
  }

  handleDisconnect(socket: Socket) {
    const idx = this.socketIndex.get(socket.id);
    if (!idx) return;
    this.socketIndex.delete(socket.id);
    const lobby = this.lobbies.get(idx.code);
    const member = lobby?.members.get(idx.playerId);
    if (!lobby || !member || member.socketId !== socket.id) return;
    member.socketId = null;
    member.disconnectedAt = Date.now();
    member.ready = false;
    if (lobby.match && lobby.match.hasPlayer(member.id)) lobby.match.handleDisconnect(member.id);
    if (lobby.hostId === member.id && lobby.state === 'LOBBY') {
      const other = [...lobby.members.values()].find((m) => m.socketId !== null);
      if (other) this.transferHost(lobby);
    }
    this.broadcastLobby(lobby);
  }

  /** Periodic cleanup: expired seats, idle lobbies, finished matches nobody returned from. */
  private sweep() {
    const now = Date.now();
    for (const lobby of [...this.lobbies.values()]) {
      if (lobby.state === 'LOBBY') {
        for (const m of [...lobby.members.values()]) {
          if (m.socketId === null && m.disconnectedAt !== null && now - m.disconnectedAt > LOBBY_DISCONNECT_GRACE_MS) this.removeMember(lobby, m, 'timed out');
        }
      }
      if (!this.lobbies.has(lobby.code)) continue;
      const anyConnected = [...lobby.members.values()].some((m) => m.socketId !== null);
      if (!anyConnected) {
        const since = Math.max(...[...lobby.members.values()].map((m) => m.disconnectedAt ?? 0), lobby.lastActivity);
        const limit = lobby.state === 'IN_GAME' ? 120_000 : LOBBY_DISCONNECT_GRACE_MS;
        if (now - since > limit) this.closeLobby(lobby, 'Lobby expired.');
        continue;
      }
      if (lobby.state === 'IN_GAME' && lobby.match?.isEnded && now - lobby.endedAt > 5 * 60_000) this.resetToLobby(lobby);
      if (now - lobby.lastActivity > config.lobbyIdleMinutes * 60_000 && lobby.state === 'LOBBY') this.closeLobby(lobby, 'Lobby closed after being idle.');
    }
  }

  stats() {
    let players = 0;
    let matches = 0;
    for (const l of this.lobbies.values()) {
      players += [...l.members.values()].filter((m) => m.socketId).length;
      if (l.match && !l.match.isEnded) matches++;
    }
    return { lobbies: this.lobbies.size, players, matches };
  }

  touch(socket: Socket) {
    const cur = this.memberOf(socket);
    if (cur) cur.lobby.lastActivity = Date.now();
  }
}
