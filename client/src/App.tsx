import { useEffect } from 'react';
import { audio } from './game/audio/AudioEngine';
import { net } from './net/net';
import { useStore } from './state/store';
import { GameView, gameRef } from './ui/GameView';
import { LobbyRoom } from './ui/LobbyRoom';
import { Backdrop, Credits, CreateLobby, ErrorScreen, HowToPlay, JoinLobby, MainMenu, SettingsScreen, Splash } from './ui/Menus';

export function App() {
  const screen = useStore((s) => s.screen);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    net.setMatchHandler((init, resumed) => {
      const st = useStore.getState();
      // already in this match (network blip): resync in place instead of reloading
      if (gameRef.current && st.screen === 'game' && resumed) {
        gameRef.current.resync(init);
        return;
      }
      gameRef.pending = { init, resumed };
      if (st.screen === 'game') st.go('loading');
      setTimeout(() => useStore.getState().go('game'), 0);
    });
    net.setReturnedHandler(() => {
      useStore.getState().set({ ending: null, modal: null });
      audio.menuMode(true);
      useStore.getState().go('lobby');
    });
  }, []);

  useEffect(() => audio.applySettings(settings), [settings]);

  const inGame = screen === 'game';
  return (
    <>
      {!inGame && <Backdrop />}
      {screen === 'splash' && <Splash />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'create' && <CreateLobby />}
      {screen === 'join' && <JoinLobby />}
      {screen === 'lobby' && <LobbyRoom />}
      {screen === 'howto' && <HowToPlay />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'credits' && <Credits />}
      {screen === 'error' && <ErrorScreen />}
      {screen === 'loading' && (
        <div className="screen">
          <p className="subtitle">LOADING…</p>
        </div>
      )}
      {inGame && <GameView />}
    </>
  );
}
