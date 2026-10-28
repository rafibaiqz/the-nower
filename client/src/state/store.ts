/** UI state (zustand). The game engine pushes HUD snapshots here at ~10 Hz. */
import { create } from 'zustand';
import type { EscapeRoute, LobbyInfo, MatchResult, PlayerStatus } from '@nower/shared';

export type Screen = 'splash' | 'menu' | 'create' | 'join' | 'lobby' | 'howto' | 'settings' | 'credits' | 'loading' | 'game' | 'error';
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  ambient: number;
  enemy: number;
  muted: boolean;
  quality: Quality;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  brightness: number;
  headBob: boolean;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.6,
  sfx: 0.85,
  ambient: 0.7,
  enemy: 0.9,
  muted: false,
  quality: 'medium',
  sensitivity: 1,
  invertY: false,
  fov: 72,
  brightness: 1,
  headBob: true,
  showFps: false,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export interface Teammate {
  id: string;
  name: string;
  color: number;
  status: PlayerStatus;
  connected: boolean;
  captures: number;
  escapedVia: EscapeRoute | null;
  you: boolean;
}

export interface Objective {
  route: 'front' | 'garage' | 'sewer';
  title: string;
  steps: { text: string; done: boolean }[];
  ready: boolean;
}

export interface Hud {
  prompt: string | null;
  promptEnabled: boolean;
  secondary: string[];
  hold: { label: string; progress: number } | null;
  held: { name: string; type: string; description: string; use?: string } | null;
  stamina: number;
  battery: number;
  flashlight: boolean;
  status: PlayerStatus;
  hideKind: string | null;
  breath: number;
  holdingBreath: boolean;
  cageText: string | null;
  countdown: number;
  phase: string;
  alert: string;
  danger: number;
  heardAt: number;
  spottedAt: number;
  teammates: Teammate[];
  objectives: Objective[];
  spectating: string | null;
  driving: boolean;
  carSpeed: number;
  fps: number;
  floorName: string;
  roomName: string;
  captureLimit: number;
}

export const EMPTY_HUD: Hud = {
  prompt: null,
  promptEnabled: true,
  secondary: [],
  hold: null,
  held: null,
  stamina: 1,
  battery: 1,
  flashlight: false,
  status: 'free',
  hideKind: null,
  breath: 8,
  holdingBreath: false,
  cageText: null,
  countdown: 0,
  phase: 'COUNTDOWN',
  alert: 'NONE',
  danger: 0,
  heardAt: 0,
  spottedAt: 0,
  teammates: [],
  objectives: [],
  spectating: null,
  driving: false,
  carSpeed: 0,
  fps: 0,
  floorName: '',
  roomName: '',
  captureLimit: 3,
};

export type Modal =
  | null
  | { kind: 'pause' }
  | { kind: 'keypad'; symbols: string[] }
  | { kind: 'note'; id: string }
  | { kind: 'journal' }
  | { kind: 'inspect'; type: string; cipher?: { symbol: string; digit: number }[] }
  | { kind: 'settings' }
  | { kind: 'howto' };

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'warn';
  at: number;
}

export interface Ending {
  result: MatchResult;
  escaped: { name: string; route: EscapeRoute }[];
  lost: string[];
  durationSec: number;
}

interface State {
  screen: Screen;
  backScreen: Screen;
  name: string;
  lobby: LobbyInfo | null;
  playerId: string | null;
  conn: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  error: { title: string; message: string } | null;
  notice: string | null;
  busy: boolean;
  settings: Settings;
  hud: Hud;
  modal: Modal;
  toasts: Toast[];
  journal: string[];
  ending: Ending | null;
  personalEnding: EscapeRoute | 'captured' | null;
  loadingText: string;
  pointerLocked: boolean;
  introPlaying: boolean;
  seenTutorial: boolean;
  set: (patch: Partial<State>) => void;
  go: (screen: Screen) => void;
  setSettings: (patch: Partial<Settings>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  setName: (name: string) => void;
  markTutorial: () => void;
}

let toastId = 1;

export const useStore = create<State>((set, get) => ({
  screen: 'splash',
  backScreen: 'menu',
  name: load<{ name: string }>('nower.profile', { name: '' }).name,
  lobby: null,
  playerId: null,
  conn: 'idle',
  error: null,
  notice: null,
  busy: false,
  settings: load<Settings>('nower.settings', DEFAULT_SETTINGS),
  hud: EMPTY_HUD,
  modal: null,
  toasts: [],
  journal: [],
  ending: null,
  personalEnding: null,
  loadingText: '',
  pointerLocked: false,
  introPlaying: false,
  seenTutorial: load<{ seen: boolean }>('nower.tutorial', { seen: false }).seen,
  set: (patch) => set(patch),
  go: (screen) => set({ backScreen: get().screen, screen }),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    save('nower.settings', settings);
    set({ settings });
  },
  toast: (text, tone = 'info') => {
    const t: Toast = { id: toastId++, text, tone, at: Date.now() };
    set({ toasts: [...get().toasts.slice(-3), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), tone === 'bad' ? 5200 : 4200);
  },
  setName: (name) => {
    save('nower.profile', { name });
    set({ name });
  },
  markTutorial: () => {
    save('nower.tutorial', { seen: true });
    set({ seenTutorial: true });
  },
}));

export const store = useStore;
