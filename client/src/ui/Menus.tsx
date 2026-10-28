import { useEffect, useState } from 'react';
import { DIFFICULTY, DIFFICULTIES, LOBBY_CODE_LENGTH, MAX_NAME_LENGTH, type Difficulty } from '@nower/shared';
import { audio } from '../game/audio/AudioEngine';
import { SERVER_URL, net } from '../net/net';
import { useStore, type Quality } from '../state/store';

export function Backdrop() {
  return (
    <div className="backdrop">
      <svg className="house" viewBox="0 0 900 360" preserveAspectRatio="xMidYMax meet" aria-hidden>
        <path
          d="M0 360 L0 300 L60 290 L90 300 L120 285 L160 300 L170 250 L190 250 L190 200 L250 140 L310 200 L310 170 L340 170 L340 120 L450 40 L560 120 L560 170 L590 170 L590 200 L650 140 L710 200 L710 250 L730 250 L740 300 L780 285 L810 300 L840 288 L900 300 L900 360 Z"
          fill="#030303"
        />
        <rect x="430" y="70" width="12" height="40" fill="#030303" />
      </svg>
      <div className="window-light" style={{ left: 'calc(50% - 24px)', bottom: '170px' }} />
      <div className="window-light" style={{ left: 'calc(50% + 140px)', bottom: '120px', animationDelay: '2.2s', opacity: 0.4 }} />
      <div className="grain" />
    </div>
  );
}

export function Splash() {
  const go = useStore((s) => s.go);
  return (
    <div
      className="screen"
      style={{ cursor: 'pointer' }}
      onClick={() => {
        audio.unlock();
        audio.applySettings(useStore.getState().settings);
        audio.menuMode(true);
        if (net.hasSession) void net.resume();
        else go('menu');
      }}
    >
      <h1 className="logo">
        THE N<span className="o">O</span>WER
      </h1>
      <p className="subtitle">CLICK ANYWHERE TO ENTER</p>
      <p className="hint" style={{ maxWidth: 420, textAlign: 'center' }}>
        Best with headphones. Sound is how you survive — and how he finds you.
      </p>
      <div className="credit">A GAME BY RAFF &amp; NOER</div>
    </div>
  );
}

function useMenuAudio() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      audio.menuTick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export function MainMenu() {
  const { go, notice, set, name } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useMenuAudio();
  const click = (fn: () => void) => () => {
    audio.uiClick();
    fn();
  };
  const quickPlay = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await net.create(name.trim() || 'Survivor');
      if (!r.ok) throw new Error(r.error);
      const s = await net.emit('lobby:start');
      if (!s.ok) {
        go('lobby');
        throw new Error(s.error);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <h1 className="logo">
        THE N<span className="o">O</span>WER
      </h1>
      <p className="subtitle">ESCAPE BEFORE HE FINDS YOU.</p>
      {notice && (
        <div className="notice" onClick={() => set({ notice: null })}>
          {notice}
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <nav className="menu">
        <button disabled={busy} onClick={click(quickPlay)}>
          {busy ? 'WAKING UP…' : 'PLAY'}
        </button>
        <button onClick={click(() => go('create'))}>CREATE LOBBY</button>
        <button onClick={click(() => go('join'))}>JOIN LOBBY</button>
        <button onClick={click(() => go('howto'))}>HOW TO PLAY</button>
        <button onClick={click(() => go('settings'))}>SETTINGS</button>
        <button onClick={click(() => go('credits'))}>CREDITS</button>
      </nav>
      <div className="credit">A GAME BY RAFF &amp; NOER</div>
    </div>
  );
}

function NameField() {
  const { name, setName } = useStore();
  return (
    <div className="field">
      <label>YOUR NAME</label>
      <input autoFocus maxLength={MAX_NAME_LENGTH} value={name} placeholder="Survivor" onChange={(e) => setName(e.target.value)} />
    </div>
  );
}

export function CreateLobby() {
  const { go, name } = useStore();
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await net.create(name.trim() || 'Survivor');
      if (!r.ok) throw new Error(r.error);
      await net.emit('lobby:settings', { difficulty });
      go('lobby');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <div className="panel">
        <h2>CREATE LOBBY</h2>
        <NameField />
        <div className="field">
          <label>DIFFICULTY</label>
          <div className="diff-grid">
            {DIFFICULTIES.map((d) => (
              <button key={d} className={d === difficulty ? 'on' : ''} onClick={() => setDifficulty(d)}>
                {DIFFICULTY[d].label}
              </button>
            ))}
          </div>
          <span className="hint">{DIFFICULTY[difficulty].description}</span>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row">
          <button className="btn small" onClick={() => go('menu')}>
            BACK
          </button>
          <button className="btn primary" disabled={busy} onClick={create}>
            {busy ? 'CREATING…' : 'CREATE'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function JoinLobby() {
  const { go, name } = useStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await net.join(code.trim().toUpperCase(), name.trim() || 'Survivor');
      if (!r.ok) throw new Error(r.error);
      go('lobby');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <div className="panel">
        <h2>JOIN LOBBY</h2>
        <NameField />
        <div className="field">
          <label>LOBBY CODE</label>
          <input
            className="code-input"
            maxLength={LOBBY_CODE_LENGTH}
            value={code}
            placeholder="•••••"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && code.length === LOBBY_CODE_LENGTH && join()}
          />
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row">
          <button className="btn small" onClick={() => go('menu')}>
            BACK
          </button>
          <button className="btn primary" disabled={busy || code.length !== LOBBY_CODE_LENGTH} onClick={join}>
            {busy ? 'JOINING…' : 'JOIN'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HowToPlayContent() {
  return (
    <>
      <h3>THE HOUSE</h3>
      <p>
        You wake in a bedroom of an enormous mansion. Its owner — the Nower — is still here. Search rooms, drawers and cupboards for keys, tools and parts. Read the notes you find: they explain the puzzles. Your team shares the
        journal (<kbd>TAB</kbd>).
      </p>
      <h3>CONTROLS</h3>
      <p>
        <kbd>W A S D</kbd> move · <kbd>MOUSE</kbd> look · <kbd>SHIFT</kbd> sprint · <kbd>CTRL</kbd>/<kbd>C</kbd> crouch · <kbd>E</kbd> interact (hold for long actions) · <kbd>G</kbd> drop · <kbd>F</kbd> use item · <kbd>L</kbd>/<kbd>RMB</kbd>{' '}
        flashlight · <kbd>I</kbd> inspect · <kbd>TAB</kbd> journal · <kbd>SPACE</kbd> hold breath while hiding · <kbd>ESC</kbd> pause
      </p>
      <h3>SOUND IS EVERYTHING</h3>
      <p>
        He hunts mostly by ear. Crouching is near silent, walking can be heard nearby, sprinting carries far. Creaking floorboards, slammed doors, dropped tools and machines are loud. Closed doors and walls muffle sound. You can
        use this: drop a bottle in one room while a teammate sneaks past another.
      </p>
      <h3>HIDING</h3>
      <p>
        Wardrobes, cupboards, beds and sewer niches hide you. If he did not see you go in, he will usually walk past — unless you are panting. Hold <kbd>SPACE</kbd> to hold your breath. If he saw you hide, he will come looking.
      </p>
      <h3>CAUGHT</h3>
      <p>
        If he catches you, you wake in a cage in the basement. Teammates can force the cage open; on lower difficulties you can work the latch loose yourself after a while. Every capture uses up one of your chances.
      </p>
      <h3>THREE WAYS OUT</h3>
      <p>
        <b>Main entrance</b> — four locks: an old key, a padlock, an electric bolt powered from the basement and coded by a cipher, and an iron bar lifted by a winch. <br />
        <b>Garage</b> — get in, repair the car (battery, coil, relay, fuel, key), open the shutter, start it (loud!) and drive through the gate. <br />
        <b>Sewer</b> — open the tunnel gate, drain the cistern, equalise the valve pressure, raise the floodgate, and crank open the outfall grate.
      </p>
      <h3>TOGETHER</h3>
      <p>Split up, share what you find, distract him for each other, and come back for whoever gets caught. Items are one-per-hand, so plan who carries what.</p>
    </>
  );
}

export function HowToPlay() {
  const back = useStore((s) => s.backScreen);
  const go = useStore((s) => s.go);
  return (
    <div className="screen">
      <div className="panel">
        <h2>HOW TO PLAY</h2>
        <HowToPlayContent />
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn small" onClick={() => go(back === 'howto' ? 'menu' : back)}>
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, fmt }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; fmt?: (v: number) => string }) {
  return (
    <div className="slider-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span>{fmt ? fmt(value) : Math.round(value * 100)}</span>
    </div>
  );
}

export function SettingsContent() {
  const { settings, setSettings } = useStore();
  const upd = (patch: Partial<typeof settings>) => {
    setSettings(patch);
    audio.applySettings({ ...settings, ...patch });
  };
  return (
    <>
      <h3>AUDIO</h3>
      <Slider label="MASTER" value={settings.master} onChange={(v) => upd({ master: v })} />
      <Slider label="MUSIC" value={settings.music} onChange={(v) => upd({ music: v })} />
      <Slider label="EFFECTS" value={settings.sfx} onChange={(v) => upd({ sfx: v })} />
      <Slider label="AMBIENCE" value={settings.ambient} onChange={(v) => upd({ ambient: v })} />
      <Slider label="THE NOWER" value={settings.enemy} onChange={(v) => upd({ enemy: v })} />
      <div className="row">
        <label className="hint">
          <input type="checkbox" checked={settings.muted} onChange={(e) => upd({ muted: e.target.checked })} /> MUTE ALL
        </label>
      </div>
      <h3>GRAPHICS</h3>
      <div className="field">
        <div className="diff-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(['low', 'medium', 'high'] as Quality[]).map((q) => (
            <button key={q} className={settings.quality === q ? 'on' : ''} onClick={() => upd({ quality: q })}>
              {q.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="hint">Quality changes apply when the next match loads.</span>
      </div>
      <Slider label="BRIGHTNESS" value={settings.brightness} min={0.6} max={1.8} onChange={(v) => upd({ brightness: v })} fmt={(v) => v.toFixed(2)} />
      <Slider label="FIELD OF VIEW" value={settings.fov} min={60} max={95} step={1} onChange={(v) => upd({ fov: v })} fmt={(v) => String(v)} />
      <h3>CONTROLS</h3>
      <Slider label="SENSITIVITY" value={settings.sensitivity} min={0.2} max={3} onChange={(v) => upd({ sensitivity: v })} fmt={(v) => v.toFixed(2)} />
      <div className="row" style={{ justifyContent: 'flex-start', gap: 24 }}>
        <label className="hint">
          <input type="checkbox" checked={settings.invertY} onChange={(e) => upd({ invertY: e.target.checked })} /> INVERT Y
        </label>
        <label className="hint">
          <input type="checkbox" checked={settings.headBob} onChange={(e) => upd({ headBob: e.target.checked })} /> HEAD BOB
        </label>
        <label className="hint">
          <input type="checkbox" checked={settings.showFps} onChange={(e) => upd({ showFps: e.target.checked })} /> SHOW FPS
        </label>
      </div>
    </>
  );
}

export function SettingsScreen() {
  const go = useStore((s) => s.go);
  return (
    <div className="screen">
      <div className="panel">
        <h2>SETTINGS</h2>
        <SettingsContent />
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn small" onClick={() => go('menu')}>
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}

export function Credits() {
  const go = useStore((s) => s.go);
  return (
    <div className="screen">
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2>CREDITS</h2>
        <p style={{ fontFamily: 'var(--title)', fontSize: 34, letterSpacing: '0.15em', margin: '10px 0' }}>THE NOWER</p>
        <p style={{ fontFamily: 'var(--title)', letterSpacing: '0.3em' }}>CREATED BY RAFF &amp; NOER</p>
        <h3>DESIGN · CODE · SOUND</h3>
        <p>Raff &amp; Noer</p>
        <h3>TECHNOLOGY</h3>
        <p>Three.js · React · Socket.IO · Web Audio API</p>
        <p className="hint">All models, textures, music and sound effects are generated procedurally by the game itself.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <button className="btn small" onClick={() => go('menu')}>
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorScreen() {
  const { error, go, set } = useStore();
  return (
    <div className="screen">
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2>{error?.title ?? 'CONNECTION ERROR'}</h2>
        <p>{error?.message ?? 'Something went wrong.'}</p>
        <p className="hint">Game server: {SERVER_URL}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button
            className="btn primary"
            onClick={() => {
              set({ error: null });
              go('menu');
            }}
          >
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
}
