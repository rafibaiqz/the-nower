import { describe, expect, it } from 'vitest';
import { NOISE, STATIC_CLOSED, STATIC_OPEN, SoundField, audibility, getLevel } from '../src/index';

const level = getLevel();

describe('sound propagation', () => {
  const field = new SoundField(level);
  it('sprinting is more detectable than walking, walking more than crouching', () => {
    field.compute(STATIC_OPEN, 2, 44, 50);
    const near = field.at(2, 48.5, 50.5); // ~4.5m across the hall
    const far = field.at(2, 54.5, 43.5); // ~11m away
    expect(audibility(NOISE.crouch, 1, near)).toBe(0);
    expect(audibility(NOISE.walk, 1, near)).toBeGreaterThan(0);
    expect(audibility(NOISE.sprint, 1, near)).toBeGreaterThan(audibility(NOISE.walk, 1, near));
    expect(audibility(NOISE.walk, 1, far)).toBe(0);
    expect(audibility(NOISE.sprint, 1, far)).toBeGreaterThan(0);
  });

  it('walls and closed doors attenuate sound', () => {
    field.compute(STATIC_OPEN, 2, 45, 48);
    const openD = field.at(2, 35.5, 48.5); // living room through the open double door
    field.compute(STATIC_CLOSED, 2, 45, 48);
    const closedD = field.at(2, 35.5, 48.5);
    expect(closedD).toBeGreaterThan(openD);
    // straight-line distance is ~9.5m, but the field must not be shorter than that
    expect(openD).toBeGreaterThanOrEqual(9.4);
  });

  it('a dropped metal tool is heard from the next room but not across the house', () => {
    field.compute(STATIC_OPEN, 2, 58, 29); // kitchen
    expect(audibility(NOISE.dropMetal, 1, field.at(2, 58.5, 38.5))).toBeGreaterThan(0); // corridor
    expect(audibility(NOISE.dropMetal, 1, field.at(4, 30.5, 45.5))).toBe(0); // attic storage
  });

  it('floors attenuate sound unless open to each other', () => {
    field.compute(STATIC_OPEN, 2, 48, 43); // hall, under the gallery
    const gallery = field.at(3, 48.5, 42.5); // above through the slab
    field.compute(STATIC_OPEN, 2, 52, 50); // hall, under the open void
    const throughVoid = field.at(3, 52.5, 43.5);
    expect(gallery).toBeGreaterThan(5);
    expect(throughVoid).toBeLessThan(gallery + 10);
  });
});
