/**
 * Difficulty tuning. Every value here changes real simulation behaviour on the server
 * (enemy speed, perception, traps, capture rules) or what the client is shown (hints).
 */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'extreme'];

export interface DifficultyTuning {
  label: string;
  description: string;
  enemyPatrolSpeed: number;
  enemyInvestigateSpeed: number;
  enemyChaseSpeed: number;
  hearingMultiplier: number;
  visionRange: number;
  visionFovDeg: number;
  detectionRate: number;
  searchDuration: number;
  hidingCheckChance: number;
  chasePersistence: number;
  trapCount: number;
  hintLevel: 0 | 1 | 2 | 3;
  captureLimit: number;
  selfReleaseSeconds: number | null;
  graceSeconds: number;
  interactionNoiseMult: number;
  trapHoldSeconds: number;
  escapeAwareness: number; // how strongly the Nower is drawn to escape mechanisms
}

export const DIFFICULTY: Record<Difficulty, DifficultyTuning> = {
  easy: {
    label: 'EASY',
    description: 'Slower, half-deaf Nower. Generous hints and more chances.',
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
  },
  normal: {
    label: 'NORMAL',
    description: 'The intended experience. Every footstep matters.',
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
  },
  hard: {
    label: 'HARD',
    description: 'He hears more, runs faster and patrols the exits.',
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
  },
  extreme: {
    label: 'EXTREME',
    description: 'One mistake is enough. Caged players must be rescued.',
    enemyPatrolSpeed: 1.95,
    enemyInvestigateSpeed: 3.0,
    enemyChaseSpeed: 5.0,
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
  },
};
