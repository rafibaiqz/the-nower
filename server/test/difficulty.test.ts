/** Difficulty levels change real behaviour, stay fair, and remain solvable. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, DIFFICULTY, NOISE, SPRINT_SPEED, type Difficulty } from '@nower/shared';
import { act, doorIdx, give, level, makeMatch, standAt, standNear, ticks, walkTo } from './helpers';

const ORDER: Difficulty[] = ['easy', 'medium', 'hard', 'extreme'];

describe('difficulty configuration', () => {
  it('has exactly EASY, MEDIUM, HARD and EXTREME with MEDIUM as the default', () => {
    expect(DIFFICULTIES).toEqual(ORDER);
    expect(ORDER.map((d) => DIFFICULTY[d].label)).toEqual(['EASY', 'MEDIUM', 'HARD', 'EXTREME']);
    expect(DEFAULT_DIFFICULTY).toBe('medium');
  });

  it('gets strictly harder on every axis from EASY to EXTREME', () => {
    const t = ORDER.map((d) => DIFFICULTY[d]);
    for (let i = 1; i < t.length; i++) {
      const [a, b] = [t[i - 1], t[i]];
      expect(b.enemyPatrolSpeed).toBeGreaterThan(a.enemyPatrolSpeed);
      expect(b.enemyChaseSpeed).toBeGreaterThan(a.enemyChaseSpeed);
      expect(b.hearingMultiplier).toBeGreaterThan(a.hearingMultiplier);
      expect(b.visionRange).toBeGreaterThan(a.visionRange);
      expect(b.detectionRate).toBeGreaterThan(a.detectionRate);
      expect(b.searchDuration).toBeGreaterThan(a.searchDuration);
      expect(b.chasePersistence).toBeGreaterThan(a.chasePersistence);
      expect(b.holdMultiplier).toBeGreaterThan(a.holdMultiplier);
      expect(b.staminaDrainMultiplier).toBeGreaterThan(a.staminaDrainMultiplier);
      expect(b.stunSeconds).toBeLessThan(a.stunSeconds);
      expect(b.decoySeconds).toBeLessThan(a.decoySeconds);
      expect(b.hintLevel).toBeLessThan(a.hintLevel);
      expect(b.captureLimit).toBeLessThan(a.captureLimit);
    }
  });

  it('stays fair: a sprinting player is always faster than his chase', () => {
    for (const d of ORDER) expect(DIFFICULTY[d].enemyChaseSpeed).toBeLessThan(SPRINT_SPEED);
  });
});

describe('the match uses the selected difficulty', () => {
  it('scales hold-to-interact durations', () => {
    const durs = ORDER.map((d) => {
      const ctx = makeMatch(1, d);
      give(ctx, 'p1', 'lock_pick');
      standNear(ctx, 'p1', 'mech:front_door');
      ctx.match.mechs.front.keyLock = true;
      const r = ctx.match.handleAct('p1', 'mech:front_door');
      expect(r.ok).toBe(true);
      expect(ctx.match.tuning).toBe(DIFFICULTY[d]);
      return (r.data as { hold: number }).hold;
    });
    for (let i = 1; i < durs.length; i++) expect(durs[i]).toBeGreaterThan(durs[i - 1]);
  });

  it('a noise behind a closed door is heard on EXTREME but not on EASY', () => {
    const heard = (d: Difficulty) => {
      const ctx = makeMatch(1, d);
      standAt(ctx, 'p1', 3, 23, 23);
      ctx.match.testWakeEnemy(58.5, 0, 28.5); // kitchen; the corridor door is closed
      ctx.match.tick(0.05);
      ctx.match.noise(2, 58.5, 0, 38.5, 13, null); // corridor, ~10 m away through the door
      ctx.match.tick(0.05);
      return ctx.match.enemy.state === 'INVESTIGATE_SOUND';
    };
    expect(heard('easy')).toBe(false);
    expect(heard('extreme')).toBe(true);
    void NOISE;
  });

  it('chases faster on harder levels', () => {
    const covered = (d: Difficulty) => {
      const ctx = makeMatch(1, d);
      standAt(ctx, 'p1', 2, 64, 38); // main corridor, 10 m west of him
      ctx.match.testWakeEnemy(74.5, 0, 38.5);
      ctx.match.enemy.yaw = Math.PI / 2; // facing west, down the corridor
      for (let i = 0; i < 80 && ctx.match.enemy.state !== 'CHASE'; i++) ctx.match.tick(0.05);
      expect(ctx.match.enemy.state).toBe('CHASE');
      ticks(ctx, 0.7); // the startled reaction before he runs
      const x0 = ctx.match.enemy.x;
      ticks(ctx, 0.6);
      return x0 - ctx.match.enemy.x;
    };
    const easy = covered('easy');
    const extreme = covered('extreme');
    expect(extreme).toBeGreaterThan(easy * 1.2);
  });

  it('the flash camera stuns for the level’s recovery time', () => {
    for (const d of ['easy', 'extreme'] as Difficulty[]) {
      const ctx = makeMatch(1, d);
      standAt(ctx, 'p1', 2, 52, 46);
      ctx.match.testWakeEnemy(46.5, 0, 46.5);
      ctx.match.enemy.yaw = -Math.PI / 2;
      ctx.match.enemy.holdStill(2);
      give(ctx, 'p1', 'flash_camera');
      const p = ctx.match.testPlayer('p1');
      const yaw = Math.atan2(-(46.5 - p.x), -(46.5 - p.z));
      ctx.match.testPlace('p1', p.x, p.y, p.z, yaw);
      expect(ctx.match.handleUse('p1', yaw, 0).ok).toBe(true);
      expect(ctx.match.enemy.state).toBe('TEMPORARILY_DISABLED');
      ticks(ctx, DIFFICULTY[d].stunSeconds - 0.4);
      expect(ctx.match.enemy.state).toBe('TEMPORARILY_DISABLED');
      ticks(ctx, 0.8);
      expect(ctx.match.enemy.state).not.toBe('TEMPORARILY_DISABLED');
    }
  });

  for (const d of ORDER) {
    it(`the main entrance route is completable on ${DIFFICULTY[d].label}`, () => {
      const ctx = makeMatch(1, d);
      const { match } = ctx;
      for (const [item, ref] of [
        ['entrance_key', 'mech:front_door'],
        ['lock_pick', 'mech:front_door'],
        ['fuse_module', 'mech:fuse_box'],
      ] as const) {
        give(ctx, 'p1', item);
        standNear(ctx, 'p1', ref);
        act(ctx, 'p1', ref);
      }
      standNear(ctx, 'p1', 'mech:security_panel');
      act(ctx, 'p1', 'mech:security_panel');
      expect(match.handleCode('p1', match.testPuzzles().code).ok).toBe(true);
      give(ctx, 'p1', 'gear_handle');
      standNear(ctx, 'p1', 'mech:winch');
      act(ctx, 'p1', 'mech:winch');
      act(ctx, 'p1', 'mech:winch');
      standNear(ctx, 'p1', 'mech:front_door');
      act(ctx, 'p1', 'mech:front_door');
      expect(match.doors[doorIdx('front_door')].open).toBe(true);
      walkTo(ctx, 'p1', 2, 48.5, 83.5);
      expect(match.players.get('p1')!.escapedVia).toBe('front');
    });
  }
});

describe('hiding regressions', () => {
  it('when he opens a hiding place every client is told (doors swing open, sound)', () => {
    const ctx = makeMatch(1, 'medium');
    const { match } = ctx;
    const h = level.hides.find((hh) => hh.kind === 'wardrobe' && level.rooms[hh.room].spec.id === 'master')!;
    standNear(ctx, 'p1', `hide:${h.index}`);
    const p = match.testPlayer('p1');
    match.testWakeEnemy(p.x, 4, p.z + (h.exit[2] > h.inside[2] ? 3 : -3));
    match.enemy.yaw = Math.atan2(-(p.x - match.enemy.x), -(p.z - match.enemy.z));
    match.enemy.holdStill(1.5);
    for (let i = 0; i < 80 && match.enemy.state !== 'CHASE'; i++) match.tick(0.05);
    act(ctx, 'p1', `hide:${h.index}`);
    for (let i = 0; i < 240 && !ctx.events.some((e) => e.k === 'hideCheck'); i++) match.tick(0.05);
    const check = ctx.events.find((e) => e.k === 'hideCheck');
    expect(check && check.k === 'hideCheck' && check.i).toBe(h.index);
    expect(ctx.events.some((e) => e.k === 'sound' && e.s === 'enemy_search_hide')).toBe(true);
  });

  it('a player who disconnects while hidden frees the hiding place and is not stuck hidden', () => {
    const ctx = makeMatch(2, 'medium');
    const { match } = ctx;
    const h = level.hides.find((hh) => hh.kind === 'bed' && level.rooms[hh.room].spec.id === 'westbed')!;
    standNear(ctx, 'p1', `hide:${h.index}`);
    act(ctx, 'p1', `hide:${h.index}`);
    expect(match.hides[h.index]).toBe('p1');
    match.handleDisconnect('p1');
    expect(match.hides[h.index]).toBeNull();
    expect(match.players.get('p1')!.status).toBe('free');
    match.handleReconnect('p1');
    expect(match.players.get('p1')!.status).toBe('free');
    // the place is usable by someone else afterwards
    standNear(ctx, 'p2', `hide:${h.index}`);
    act(ctx, 'p2', `hide:${h.index}`);
    expect(match.hides[h.index]).toBe('p2');
  });
});
