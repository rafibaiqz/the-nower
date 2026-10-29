import { useState } from 'react';
import { DifficultyPicker } from './DifficultyPicker';
import { net } from '../net/net';
import { useStore } from '../state/store';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export function LobbyRoom() {
  const { lobby, playerId, go, conn } = useStore();
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!lobby) {
    return (
      <div className="screen">
        <p className="subtitle">CONNECTING…</p>
      </div>
    );
  }
  const me = lobby.players.find((p) => p.id === playerId);
  const host = !!me?.host;
  const act = async (ev: string, payload: unknown = {}) => {
    setErr(null);
    const r = await net.emit(ev, payload);
    if (!r.ok) setErr(r.error ?? 'Failed.');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('Copy failed — share the code manually.');
    }
  };
  return (
    <div className="screen">
      <div className="panel">
        <h2>LOBBY</h2>
        <div style={{ textAlign: 'center' }}>
          <div className="hint">SHARE THIS CODE</div>
          <div className="lobby-code">{lobby.code}</div>
          <button className="btn small" onClick={copy}>
            {copied ? 'COPIED' : 'COPY CODE'}
          </button>
        </div>
        <ul className="players">
          {lobby.players.map((p) => (
            <li key={p.id}>
              <span className="dot" style={{ background: hex(p.color) }} />
              <span style={{ flex: 1 }}>
                {p.name}
                {p.id === playerId ? ' (you)' : ''}
              </span>
              {p.host && <span className="tag host">HOST</span>}
              {!p.host && <span className={`tag ${p.ready ? 'ready' : ''}`}>{p.ready ? 'READY' : 'NOT READY'}</span>}
              <span className="tag" style={{ color: p.connected ? 'var(--good)' : 'var(--blood-hi)' }}>
                {p.connected ? 'ONLINE' : 'RECONNECTING'}
              </span>
            </li>
          ))}
          {Array.from({ length: Math.max(0, lobby.settings.maxPlayers - lobby.players.length) }).map((_, i) => (
            <li key={'empty' + i} style={{ color: 'var(--faint)' }}>
              <span className="dot" style={{ background: '#222' }} /> waiting for a survivor…
            </li>
          ))}
        </ul>
        <DifficultyPicker
          value={lobby.settings.difficulty}
          disabled={!host}
          note={host ? 'you choose for everyone' : 'chosen by the host'}
          onChange={(d) => act('lobby:settings', { difficulty: d })}
        />
        {host && (
          <div className="field">
            <label>MAX PLAYERS</label>
            <select value={lobby.settings.maxPlayers} onChange={(e) => act('lobby:settings', { maxPlayers: Number(e.target.value) })}>
              {Array.from({ length: lobby.serverMaxPlayers }, (_, i) => i + 1)
                .filter((n) => n >= lobby.players.length)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </div>
        )}
        {conn === 'reconnecting' && <div className="notice">Connection lost — reconnecting…</div>}
        {err && <div className="error">{err}</div>}
        {host && lobby.startBlocker && <div className="hint" style={{ marginBottom: 10 }}>{lobby.startBlocker}</div>}
        <div className="row">
          <button
            className="btn small"
            onClick={async () => {
              await net.leave();
              go('menu');
            }}
          >
            LEAVE
          </button>
          {!host && (
            <button className="btn primary" onClick={() => act('lobby:ready', { ready: !me?.ready })}>
              {me?.ready ? 'NOT READY' : 'READY'}
            </button>
          )}
          {host && (
            <button className="btn primary" disabled={!lobby.canStart} onClick={() => act('lobby:start')}>
              START GAME
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
