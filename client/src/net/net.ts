/**
 * Socket.IO client. The server is the only source of truth for lobbies; this module just
 * mirrors what the server says into the UI store and handles reconnection with the
 * per-seat session token.
 */
import { io } from 'socket.io-client';
import type { Ack, JoinAck, LobbyInfo, MatchInit } from '@nower/shared';
import { store } from '../state/store';
import { WsTransport, type ClientSocket } from './wsTransport';

export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3001` : location.origin);

/**
 * 'socketio' (default): the Node.js server. 'ws': the Cloudflare Worker / Durable Object, built
 * with `vite build --mode cloudflare` (client/.env.cloudflare).
 */
export const TRANSPORT: 'ws' | 'socketio' = import.meta.env.VITE_TRANSPORT === 'ws' ? 'ws' : 'socketio';

const SESSION_KEY = 'nower.session';

interface Session {
  token: string;
  playerId: string;
  code: string;
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function writeSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type MatchHandler = (init: MatchInit, resumed: boolean) => void;

class Net {
  socket: ClientSocket | null = null;
  private session: Session | null = readSession();
  private onMatch: MatchHandler | null = null;
  private onReturned: (() => void) | null = null;
  private everConnected = false;
  private resuming = false;

  get hasSession() {
    return !!this.session;
  }

  get playerId() {
    return this.session?.playerId ?? null;
  }

  setMatchHandler(h: MatchHandler) {
    this.onMatch = h;
  }

  setReturnedHandler(h: () => void) {
    this.onReturned = h;
  }

  connect(): Promise<ClientSocket> {
    if (this.socket?.connected) return Promise.resolve(this.socket);
    if (!this.socket) this.createSocket();
    store.getState().set({ conn: 'connecting' });
    return new Promise((resolve, reject) => {
      const s = this.socket!;
      const ok = () => {
        cleanup();
        resolve(s);
      };
      const fail = () => {
        cleanup();
        reject(new Error(`Cannot reach the game server at ${SERVER_URL}.`));
      };
      const timer = setTimeout(fail, 9000);
      const cleanup = () => {
        clearTimeout(timer);
        s.off('connect', ok);
      };
      s.on('connect', ok);
      if (!s.connected) s.connect();
    });
  }

  private createSocket() {
    const s: ClientSocket =
      TRANSPORT === 'ws'
        ? new WsTransport(`${SERVER_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`)
        : (io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            autoConnect: false,
            reconnection: true,
            reconnectionDelay: 800,
            reconnectionDelayMax: 4000,
            timeout: 8000,
          }) as unknown as ClientSocket);
    this.socket = s;
    s.on('connect', () => {
      store.getState().set({ conn: 'connected' });
      if (this.everConnected && this.session) void this.resume();
      this.everConnected = true;
    });
    s.on('disconnect', (reason: string) => {
      const st = store.getState();
      if (reason === 'io client disconnect') {
        st.set({ conn: 'idle' });
        return;
      }
      st.set({ conn: this.session ? 'reconnecting' : 'idle' });
    });
    s.on('connect_error', () => {
      if (!this.everConnected) store.getState().set({ conn: 'idle' });
    });
    s.on('lobby:update', (info: LobbyInfo) => store.getState().set({ lobby: info }));
    s.on('lobby:notice', (p: { text: string }) => store.getState().toast(p.text, 'info'));
    s.on('lobby:closed', (p: { reason: string }) => {
      this.clearSession();
      const st = store.getState();
      st.set({ lobby: null, notice: `Lobby closed: ${p.reason}` });
      if (st.screen === 'lobby' || st.screen === 'game' || st.screen === 'loading') st.go('menu');
    });
    s.on('lobby:returned', (info: LobbyInfo) => {
      store.getState().set({ lobby: info });
      this.onReturned?.();
    });
    s.on('game:start', (init: MatchInit) => this.onMatch?.(init, false));
    s.on('session:replaced', (p: { reason: string }) => {
      this.clearSession();
      s.disconnect();
      store.getState().set({ error: { title: 'Session moved', message: p.reason }, lobby: null });
      store.getState().go('error');
    });
  }

  emit<T = unknown>(event: string, payload: unknown = {}, timeout = 8000): Promise<Ack<T>> {
    const s = this.socket;
    if (!s || !s.connected) return Promise.resolve({ ok: false, error: 'Not connected to the server.' });
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ ok: false, error: 'The server did not answer in time.' });
        }
      }, timeout);
      s.emit(event, payload, (res: Ack<T>) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(res ?? { ok: false, error: 'No response.' });
      });
    });
  }

  /** Fire-and-forget (movement, car input). */
  send(event: string, payload: unknown) {
    if (this.socket?.connected) this.socket.volatile.emit(event, payload);
  }

  private adopt(data: JoinAck) {
    this.session = { token: data.token, playerId: data.playerId, code: data.lobby.code };
    writeSession(this.session);
    store.getState().set({ lobby: data.lobby, playerId: data.playerId });
  }

  clearSession() {
    this.session = null;
    writeSession(null);
    store.getState().set({ playerId: null });
  }

  async create(name: string): Promise<Ack<JoinAck>> {
    await this.connect();
    const r = await this.emit<JoinAck>('lobby:create', { name });
    if (r.ok && r.data) this.adopt(r.data);
    return r;
  }

  async join(code: string, name: string): Promise<Ack<JoinAck>> {
    await this.connect();
    const r = await this.emit<JoinAck>('lobby:join', { code, name });
    if (r.ok && r.data) this.adopt(r.data);
    return r;
  }

  /** Re-attach to our seat after a dropped connection or a page refresh. */
  async resume(): Promise<boolean> {
    if (!this.session || this.resuming) return false;
    this.resuming = true;
    try {
      await this.connect();
      const r = await this.emit<JoinAck>('lobby:resume', { token: this.session.token });
      if (!r.ok || !r.data) {
        this.clearSession();
        const st = store.getState();
        st.set({ lobby: null, error: { title: 'Session expired', message: r.error ?? 'Your seat in that lobby no longer exists.' } });
        st.go('error');
        return false;
      }
      this.adopt(r.data);
      store.getState().set({ conn: 'connected' });
      if (r.data.match) this.onMatch?.(r.data.match, true);
      else if (store.getState().screen !== 'lobby') store.getState().go('lobby');
      return true;
    } catch (e) {
      store.getState().set({ conn: 'reconnecting' });
      return false;
    } finally {
      this.resuming = false;
    }
  }

  async leave() {
    await this.emit('lobby:leave');
    this.clearSession();
    store.getState().set({ lobby: null });
  }
}

export const net = new Net();
