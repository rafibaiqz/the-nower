import { useEffect, useState } from 'react';
import type { PlayerStatus } from '@nower/shared';
import { useStore } from '../state/store';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

const STATUS: Record<PlayerStatus, [string, '' | 'bad' | 'good']> = {
  free: ['', ''],
  hidden: ['HIDING', ''],
  trapped: ['TRAPPED', 'bad'],
  climbing: ['CLIMBING', ''],
  driving: ['DRIVING', 'good'],
  passenger: ['IN THE CAR', 'good'],
  captured: ['CAUGHT', 'bad'],
  caged: ['CAGED', 'bad'],
  escaped: ['ESCAPED', 'good'],
  eliminated: ['LOST', 'bad'],
};

function HoldRing({ progress }: { progress: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg className="hold-ring" viewBox="0 0 54 54">
      <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
      <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(230,215,190,0.85)" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} transform="rotate(-90 27 27)" />
    </svg>
  );
}

export function Hud() {
  const hud = useStore((s) => s.hud);
  const toasts = useStore((s) => s.toasts);
  const showFps = useStore((s) => s.settings.showFps);
  const [showObjectives, setShowObjectives] = useState(true);
  const now = performance.now();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'KeyO') setShowObjectives((v) => !v);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const spectating = hud.status === 'escaped' || hud.status === 'eliminated';
  const chaseQuiet = hud.danger > 0.7;
  return (
    <div className="hud">
      {hud.danger > 0.2 && <div className="danger-edge" style={{ opacity: Math.min(1, (hud.danger - 0.2) * 1.4) }} />}
      {!spectating && hud.status !== 'hidden' && <div className={`reticle ${hud.prompt && hud.promptEnabled ? 'active' : ''}`} />}
      {hud.hold && <HoldRing progress={hud.hold.progress} />}
      {hud.prompt && !hud.hold && <div className={`prompt ${hud.promptEnabled ? '' : 'disabled'}`}>{hud.prompt}</div>}
      {hud.hold && <div className="prompt">{hud.hold.label.replace(/^HOLD E — /, '')}…</div>}

      <div className="team">
        {hud.teammates.map((t) => {
          const [label, tone] = STATUS[t.status];
          return (
            <div className="mate" key={t.id}>
              <span className="dot" style={{ background: hex(t.color), opacity: t.connected ? 1 : 0.3 }} />
              <span style={{ opacity: t.connected ? 1 : 0.5 }}>
                {t.name}
                {t.you ? ' (you)' : ''}
              </span>
              {label && <span className={`st ${tone}`}>{label}</span>}
              {!t.connected && <span className="st bad">OFFLINE</span>}
              {t.captures > 0 && t.status !== 'escaped' && (
                <span className="st">
                  {t.captures}/{hud.captureLimit}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {showObjectives && !chaseQuiet && !spectating && (
        <div className="objectives">
          {hud.objectives.map((o) => {
            const next = o.steps.find((s) => !s.done);
            const done = o.steps.filter((s) => s.done).length;
            return (
              <div key={o.route}>
                <div className="route">
                  {o.title} <span className="hint">{done}/{o.steps.length}</span>
                </div>
                {o.ready && <div className="readyline">◆ READY — {o.steps[o.steps.length - 1].text}</div>}
                {!o.ready && next && <div>— {next.text}</div>}
              </div>
            );
          })}
          <div className="hint" style={{ marginTop: 6 }}>
            TAB journal · O hide objectives
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>

      {now - hud.heardAt < 2200 && <div className="ear" key={hud.heardAt}>◉ HE HEARD THAT</div>}
      {now - hud.spottedAt < 2200 && hud.spottedAt > hud.heardAt && (
        <div className="ear spotted" key={'s' + hud.spottedAt}>
          ◉ HE SEES SOMEONE
        </div>
      )}

      {hud.countdown > 0 && (
        <div className="center-msg">
          {hud.countdown}
          <small>THE HOUSE IS WAKING UP</small>
        </div>
      )}
      {hud.status === 'captured' && <div className="center-msg">CAUGHT</div>}
      {hud.status === 'trapped' && (
        <div className="center-msg" style={{ fontSize: 20 }}>
          CAUGHT IN A SNARE
          <small>Struggle free in a moment — or a teammate can pry it open</small>
        </div>
      )}
      {hud.cageText && (
        <div className="center-msg" style={{ top: '78%', fontSize: 15, letterSpacing: '0.1em' }}>
          {hud.cageText}
        </div>
      )}
      {spectating && (
        <div className="center-msg" style={{ top: '86%', fontSize: 16 }}>
          {hud.status === 'escaped' ? 'YOU ESCAPED' : 'THE HOUSE KEPT YOU'}
          <small>{hud.spectating ? `Watching ${hud.spectating} — click to switch` : 'Watching the house…'}</small>
        </div>
      )}
      {hud.status === 'hidden' && (
        <div className="breath">
          {hud.holdingBreath ? 'HOLDING BREATH' : 'HIDING'}
          <div className="meter" style={{ marginTop: 6 }}>
            <div className="bar">
              <div className="fill" style={{ width: `${(hud.breath / 8) * 100}%`, background: hud.breath < 2 ? 'var(--blood-hi)' : undefined }} />
            </div>
          </div>
        </div>
      )}

      {!spectating && (
        <div className="meters">
          <div className="meter">
            STAMINA
            <div className="bar">
              <div className="fill" style={{ width: `${hud.stamina * 100}%` }} />
            </div>
          </div>
          <div className="meter">
            LIGHT
            <div className="bar">
              <div className="fill" style={{ width: `${hud.battery * 100}%`, background: hud.battery < 0.15 ? 'var(--blood-hi)' : hud.flashlight ? undefined : 'rgba(217,208,191,0.25)' }} />
            </div>
          </div>
          {hud.driving && <div className="meter">SPEED {Math.round(hud.carSpeed * 3.6)} KM/H</div>}
        </div>
      )}

      {hud.secondary.length > 0 && (
        <div className="secondary">
          {hud.secondary.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
      )}
      {hud.held && (
        <div className="held">
          <div className="hint">CARRYING</div>
          <div className="name">{hud.held.name}</div>
        </div>
      )}
      {hud.roomName && !spectating && (
        <div className="room-name">
          {hud.roomName.toUpperCase()} · {hud.floorName.toUpperCase()}
        </div>
      )}
      {showFps && <div className="fps">{hud.fps} FPS</div>}
    </div>
  );
}
