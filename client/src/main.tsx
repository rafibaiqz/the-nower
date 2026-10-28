import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './state/store';
import { audio } from './game/audio/AudioEngine';
import { gameRef } from './ui/GameView';
import './ui/styles.css';

// Read-only debugging hook for automated browser tests: only with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__nower = { gameRef, store: useStore, audio };

createRoot(document.getElementById('root')!).render(<App />);
