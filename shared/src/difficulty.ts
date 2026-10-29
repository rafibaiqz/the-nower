/**
 * Difficulty tuning — the single source of truth. Every value changes real behaviour: the
 * server reads it for the Nower's AI, traps, captures, interaction timings and distractions;
 * the client reads it only for its own player's stamina and for how much hint text it shows.
 * The lobby host picks the level, the server validates it and locks it when the match starts.
 */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'extreme'];
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

export interface DifficultyTuning {
  label: string;
  description: string;
  /** Walking speed while patrolling (m/s). */
  enemyPatrolSpeed: number;
  /** Speed while investigating a sound or sighting (m/s). */
  enemyInvestigateSpeed: number;
  /** Chase speed (m/s). Kept below the player's sprint (5.2) so a chase can always be broken. */
  enemyChaseSpeed: number;
  /** Multiplies the audible range of every noise. */
  hearingMultiplier: number;
  /** Sight range in a lit room (m). Darkness, crouching and flashlights modify it. */
  visionRange: number;
  visionFovDeg: number;
  /** How fast a visible player fills his awareness meter. */
  detectionRate: number;
  /** Seconds he keeps searching an area after losing a trail. */
  searchDuration: number;
  /** Chance he opens a nearby hiding place he did NOT see anyone enter. */
  hidingCheckChance: number;
  /** Seconds he keeps chasing towards where a player was heading after losing sight. */
  chasePersistence: number;
  trapCount: number;
  /** 0 = none … 3 = explicit objectives and item names in prompts. */
  hintLevel: 0 | 1 | 2 | 3;
  /** Captures a player can survive. */
  captureLimit: number;
  /** Seconds before a caged player can work the latch alone; null = only a teammate can. */
  selfReleaseSeconds: number | null;
  /** Seconds the Nower stays dormant at the start. */
  graceSeconds: number;
  /** Multiplies the noise of interactions (doors, drawers, cranking…). */
  interactionNoiseMult: number;
  /** Seconds a snare holds a player. */
  trapHoldSeconds: number;
  /** How strongly his patrols are drawn to escape mechanisms in progress. */
  escapeAwareness: number;
  /** Multiplies the duration of every hold-to-interact action (repairs, cranks, lockpicking…). */
  holdMultiplier: number;
  /** Multiplies sprint stamina drain. */
  staminaDrainMultiplier: number;
  /** Seconds the flash camera blinds him (his recovery time after a distraction). */
  stunSeconds: number;
  /** Seconds he is knocked down when hit by the car. */
  impactStunSeconds: number;
  /** Seconds a clockwork decoy rattles. */
  decoySeconds: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyTuning> = {
  easy: {
    label: 'EASY',
    description: 'For first visits. He is slower, half-deaf and gives up sooner. Clear hints, four chances, long stuns.',
    enemyPatrolSpeed: 1.25,
    enemyInvestigateSpeed: 1.8,
    enemyChaseSpeed: 3.5,
    hearingMultiplier: 0.7,
    visionRange: 15,
    visionFovDeg: 95,
    detectionRate: 1.4,
    searchDuration: 9,
    hidingCheckChance: 0.12,
    chasePersistence: 2.0,
    trapCount: 3,
    hintLevel: 3,
    captureLimit: 4,
    selfReleaseSeconds: 25,
    graceSeconds: 35,
    interactionNoiseMult: 0.8,
    trapHoldSeconds: 4,
    escapeAwareness: 0.15,
    holdMultiplier: 0.8,
    staminaDrainMultiplier: 0.8,
    stunSeconds: 7,
    impactStunSeconds: 5,
    decoySeconds: 9,
  },
  medium: {
    label: 'MEDIUM',
    description: 'The intended experience. Every footstep matters; he searches thoroughly and hints are sparing.',
    enemyPatrolSpeed: 1.45,
    enemyInvestigateSpeed: 2.2,
    enemyChaseSpeed: 4.1,
    hearingMultiplier: 1.0,
    visionRange: 20,
    visionFovDeg: 110,
    detectionRate: 2.0,
    searchDuration: 14,
    hidingCheckChance: 0.25,
    chasePersistence: 3.0,
    trapCount: 6,
    hintLevel: 2,
    captureLimit: 3,
    selfReleaseSeconds: 50,
    graceSeconds: 25,
    interactionNoiseMult: 1.0,
    trapHoldSeconds: 6,
    escapeAwareness: 0.3,
    holdMultiplier: 1.0,
    staminaDrainMultiplier: 1.0,
    stunSeconds: 5.5,
    impactStunSeconds: 4,
    decoySeconds: 7,
  },
  hard: {
    label: 'HARD',
    description: 'For veterans. Faster, sharper hearing and sight, longer searches, he watches the exits. Few hints.',
    enemyPatrolSpeed: 1.7,
    enemyInvestigateSpeed: 2.6,
    enemyChaseSpeed: 4.6,
    hearingMultiplier: 1.3,
    visionRange: 24,
    visionFovDeg: 120,
    detectionRate: 2.8,
    searchDuration: 20,
    hidingCheckChance: 0.38,
    chasePersistence: 4.0,
    trapCount: 9,
    hintLevel: 1,
    captureLimit: 2,
    selfReleaseSeconds: 90,
    graceSeconds: 15,
    interactionNoiseMult: 1.2,
    trapHoldSeconds: 8,
    escapeAwareness: 0.55,
    holdMultiplier: 1.15,
    staminaDrainMultiplier: 1.15,
    stunSeconds: 4.5,
    impactStunSeconds: 3.5,
    decoySeconds: 6,
  },
  extreme: {
    label: 'EXTREME',
    description: 'One mistake is enough. He hears almost everything and never stops looking. No hints; caged players need rescue.',
    enemyPatrolSpeed: 1.95,
    enemyInvestigateSpeed: 3.0,
    enemyChaseSpeed: 4.9,
    hearingMultiplier: 1.6,
    visionRange: 28,
    visionFovDeg: 130,
    detectionRate: 3.6,
    searchDuration: 28,
    hidingCheckChance: 0.5,
    chasePersistence: 5.0,
    trapCount: 12,
    hintLevel: 0,
    captureLimit: 1,
    selfReleaseSeconds: null,
    graceSeconds: 10,
    interactionNoiseMult: 1.4,
    trapHoldSeconds: 10,
    escapeAwareness: 0.8,
    holdMultiplier: 1.3,
    staminaDrainMultiplier: 1.3,
    stunSeconds: 3.5,
    impactStunSeconds: 3,
    decoySeconds: 5,
  },
};
