import { useEffect, useRef, useState } from 'react';
import type { MatchInit } from '@nower/shared';
import { Game } from '../game/Game';
import { audio } from '../game/audio/AudioEngine';
import { net } from '../net/net';
import { EMPTY_HUD, useStore } from '../state/store';
import { Hud } from './Hud';
import { EndingScreen, Modals } from './Modals';

/** The currently running game (one at a time). */
export const gameRef: { current: Game | null; pending: { init: MatchInit; resumed: boolean } | null } = { current: null, pending: null };

export function GameView() {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<{ text: string; p: number } | null>({ text: 'Opening your eyes', p: 0 });
  const [cine, setCine] = useState<Game['cineOverlay']>(null);
  const { modal, ending, conn, set, go, introPlaying } = useStore();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const pending = gameRef.pending;
    if (!host.current || !pending) return;
    let disposed = false;
    gameRef.current?.dispose();
    const g = new Game(host.current, pending.init);
    gameRef.current = g;
    gameRef.pending = null;
    set({ hud: EMPTY_HUD, ending: null, personalEnding: null, journal: [...pending.init.journal], modal: null });
    void g
      .build((text, p) => !disposed && setLoading({ text, p }))
      .then(() => {
        if (disposed) return;
        setLoading(null);
        g.start(!pending.resumed);
      })
      .catch((err: Error) => {
        console.error(err);
        if (disposed) return;
        set({ error: { title: 'Could not load the house', message: `${err.message}. Try lowering graphics quality in Settings, or use a browser with WebGL 2.` } });
        go('error');
      });
    let raf = 0;
    const poll = () => {
      setCine(g.cineOverlay ? { ...g.cineOverlay } : null);
      setLocked(document.pointerLockElement === g.renderer.domElement);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      g.dispose();
      if (gameRef.current === g) gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = async () => {
    set({ modal: null, ending: null });
    await net.leave();
    audio.menuMode(true);
    go('menu');
  };
  const toLobby = async () => {
    const r = await net.emit('lobby:return');
    if (!r.ok) useStore.getState().toast(r.error ?? 'Cannot return yet.', 'warn');
  };

  return (
    <div ref={host} style={{ position: 'fixed', inset: 0 }}>
      {loading && (
        <div className="screen" style={{ background: '#000', zIndex: 40 }}>
          <h1 className="logo" style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}>
            THE N<span className="o">O</span>WER
          </h1>
          <p className="subtitle">{loading.text.toUpperCase()}…</p>
          <div className="loading-bar">
            <div style={{ width: `${loading.p * 100}%` }} />
          </div>
        </div>
      )}
      {!loading && !cine && <Hud />}
      {cine && (
        <div className="cine">
          <div className="black" style={{ opacity: Math.max(0, Math.min(1, cine.fade)) }} />
          {cine.title && <div className="t">{cine.title}</div>}
          {cine.subtitle && <div className="s">{cine.subtitle}</div>}
          {introPlaying && <div className="skip">SPACE — SKIP</div>}
        </div>
      )}
      {!loading && !cine && !modal && !ending && !locked && (
        <div className="click-to-play" onClick={() => gameRef.current?.requestLock()}>
          CLICK TO {useStore.getState().hud.phase === 'COUNTDOWN' ? 'BEGIN' : 'CONTINUE'}
        </div>
      )}
      {conn === 'reconnecting' && (
        <div className="notice" style={{ position: 'fixed', top: 12, left: 0, right: 0, zIndex: 50 }}>
          CONNECTION LOST — RECONNECTING…
        </div>
      )}
      <Modals onLeave={leave} onResume={() => gameRef.current?.requestLock()} />
      {ending && <EndingScreen onLobby={toLobby} onLeave={leave} />}
    </div>
  );
}
