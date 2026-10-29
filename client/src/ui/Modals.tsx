import { useState } from 'react';
import { DEV_CREDIT, DIFFICULTY, getLevel, itemDef } from '@nower/shared';
import { audio } from '../game/audio/AudioEngine';
import { net } from '../net/net';
import { useStore } from '../state/store';
import { HowToPlayContent, SettingsContent } from './Menus';

const level = getLevel();

export function Modals({ onLeave, onResume }: { onLeave: () => void; onResume: () => void }) {
  const { modal, set } = useStore();
  if (!modal) return null;
  const close = () => {
    set({ modal: null });
    onResume();
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {modal.kind === 'pause' && <Pause onLeave={onLeave} onResume={close} />}
      {modal.kind === 'settings' && (
        <div className="panel">
          <h2>SETTINGS</h2>
          <SettingsContent />
          <button className="btn small" onClick={() => set({ modal: { kind: 'pause' } })}>
            BACK
          </button>
        </div>
      )}
      {modal.kind === 'howto' && (
        <div className="panel">
          <h2>HOW TO PLAY</h2>
          <HowToPlayContent />
          <button className="btn small" onClick={() => set({ modal: { kind: 'pause' } })}>
            BACK
          </button>
        </div>
      )}
      {modal.kind === 'keypad' && <Keypad symbols={modal.symbols} onClose={close} />}
      {modal.kind === 'note' && <NoteView id={modal.id} onClose={close} />}
      {modal.kind === 'journal' && <Journal onClose={close} />}
      {modal.kind === 'inspect' && <Inspect type={modal.type} cipher={modal.cipher} onClose={close} />}
    </div>
  );
}

function Pause({ onLeave, onResume }: { onLeave: () => void; onResume: () => void }) {
  const { set, lobby } = useStore();
  return (
    <div className="panel" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
      <h2>PAUSED</h2>
      <p className="hint">The game keeps running for everyone else. He does not wait.</p>
      {lobby && (
        <p className="hint">
          LOBBY {lobby.code} · DIFFICULTY {DIFFICULTY[lobby.settings.difficulty].label}
        </p>
      )}
      <nav className="menu" style={{ margin: '16px auto' }}>
        <button onClick={onResume}>RESUME</button>
        <button onClick={() => set({ modal: { kind: 'journal' } })}>JOURNAL</button>
        <button onClick={() => set({ modal: { kind: 'howto' } })}>HOW TO PLAY</button>
        <button onClick={() => set({ modal: { kind: 'settings' } })}>SETTINGS</button>
        <button onClick={onLeave}>LEAVE GAME</button>
      </nav>
    </div>
  );
}

function Keypad({ symbols, onClose }: { symbols: string[]; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const press = async (k: string) => {
    audio.play('keypad_ok', null, 0.15);
    if (k === 'C') return setCode('');
    if (k === 'OK') {
      if (code.length !== 4) return;
      const r = await net.emit('g:code', { code });
      if (r.ok) {
        setMsg('ACCEPTED');
        setTimeout(onClose, 700);
      } else {
        setMsg(r.error ?? 'WRONG');
        setCode('');
      }
      return;
    }
    if (code.length < 4) setCode(code + k);
  };
  return (
    <div className="keypad" onKeyDown={(e) => /^[0-9]$/.test(e.key) && press(e.key)} tabIndex={0} autoFocus>
      <div className="screen">
        <div className="symbols">{symbols.join(' ')}</div>
        <div>{code.padEnd(4, '·')}</div>
        {msg && <div style={{ fontSize: 11, marginTop: 6 }}>{msg}</div>}
      </div>
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map((k) => (
          <button key={k} onClick={() => press(k)}>
            {k}
          </button>
        ))}
      </div>
      <button className="btn small" style={{ marginTop: 12, width: '100%' }} onClick={onClose}>
        STEP AWAY
      </button>
    </div>
  );
}

function NoteView({ id, onClose }: { id: string; onClose: () => void }) {
  const n = level.notes.find((nn) => nn.spec.id === id);
  if (!n) return null;
  return (
    <div className="note" onClick={onClose}>
      <h3>{n.spec.title}</h3>
      {n.spec.text}
      <div style={{ marginTop: 18, fontSize: 11, opacity: 0.6 }}>Added to the journal · click to close</div>
    </div>
  );
}

function Journal({ onClose }: { onClose: () => void }) {
  const { journal, hud } = useStore();
  const [open, setOpen] = useState<string | null>(journal[journal.length - 1] ?? null);
  const note = level.notes.find((n) => n.spec.id === open);
  return (
    <div className="panel" style={{ width: 'min(820px, 100%)' }}>
      <h2>JOURNAL</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 2fr', gap: 18 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>OBJECTIVES</h3>
          {hud.objectives.map((o) => (
            <div key={o.route} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--title)', letterSpacing: '0.15em' }}>{o.title}</div>
              {o.steps.map((s, i) => (
                <div key={i} className="hint" style={{ textDecoration: s.done ? 'line-through' : undefined, opacity: s.done ? 0.5 : 1 }}>
                  {s.done ? '✓' : '·'} {s.text}
                </div>
              ))}
            </div>
          ))}
          <h3>NOTES FOUND ({journal.length})</h3>
          {journal.length === 0 && <div className="hint">Nothing yet. Notes lie on tables and shelves.</div>}
          {journal.map((j) => {
            const n = level.notes.find((nn) => nn.spec.id === j);
            return (
              <div key={j}>
                <button className="btn small" style={{ textAlign: 'left', color: open === j ? 'var(--blood-hi)' : undefined }} onClick={() => setOpen(j)}>
                  {n?.spec.title}
                </button>
              </div>
            );
          })}
        </div>
        <div>{note && <div className="note" style={{ transform: 'none', width: '100%' }}><h3>{note.spec.title}</h3>{note.spec.text}</div>}</div>
      </div>
      <button className="btn small" style={{ marginTop: 14 }} onClick={onClose}>
        CLOSE
      </button>
    </div>
  );
}

function Inspect({ type, cipher, onClose }: { type: string; cipher?: { symbol: string; digit: number }[]; onClose: () => void }) {
  const d = itemDef(type);
  return (
    <div className="panel" style={{ width: 'min(480px, 100%)' }}>
      <h2>{d.name.toUpperCase()}</h2>
      <p>{d.description}</p>
      {cipher && (
        <>
          <p className="hint">The plate pairs each symbol with a digit:</p>
          <div className="cipher">
            {[...cipher]
              .sort((a, b) => a.digit - b.digit)
              .map((c) => (
                <div key={c.symbol}>
                  <div className="sym">{c.symbol}</div>
                  <div>{c.digit}</div>
                </div>
              ))}
          </div>
        </>
      )}
      <button className="btn small" onClick={onClose}>
        CLOSE
      </button>
    </div>
  );
}

export function EndingScreen({ onLobby, onLeave }: { onLobby: () => void; onLeave: () => void }) {
  const { ending, lobby, playerId } = useStore();
  if (!ending) return null;
  const host = lobby?.players.find((p) => p.id === playerId)?.host;
  const title = ending.result === 'TEAM_VICTORY' ? 'YOU ALL ESCAPED' : ending.result === 'PARTIAL_ESCAPE' ? 'NOT EVERYONE MADE IT' : 'NO ONE LEFT THE HOUSE';
  const routeName = { front: 'the main entrance', garage: 'the car', sewer: 'the sewers' } as const;
  const mins = Math.floor(ending.durationSec / 60);
  const secs = String(ending.durationSec % 60).padStart(2, '0');
  return (
    <div className="ending">
      <div style={{ maxWidth: 680, width: '100%' }}>
        <div className={`title ${ending.result === 'GAME_OVER' ? 'bad' : ''}`}>{title}</div>
        <div className="panel" style={{ margin: '26px auto 0', textAlign: 'center' }}>
          {ending.escaped.map((e) => (
            <p key={e.name}>
              <b>{e.name}</b> escaped through {routeName[e.route]}.
            </p>
          ))}
          {ending.lost.map((n) => (
            <p key={n} style={{ color: 'var(--blood-hi)' }}>
              {n} stayed. Forever.
            </p>
          ))}
          <p className="hint">
            Time in the house: {mins}:{secs}
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn primary" onClick={onLobby} disabled={!host}>
              {host ? 'BACK TO LOBBY' : 'WAITING FOR HOST…'}
            </button>
            <button className="btn small" onClick={onLeave}>
              MAIN MENU
            </button>
          </div>
        </div>
        <div className="roll">
          THE NOWER
          <br />
          CREATED BY {DEV_CREDIT.toUpperCase()}
        </div>
      </div>
    </div>
  );
}
