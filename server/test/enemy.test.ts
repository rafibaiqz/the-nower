/** Behavioural tests for the Nower's AI running inside a real Match. */
import { describe, expect, it } from 'vitest';
import { NOISE, canStand, floorOfY, yawToward, type EnemyState } from '@nower/shared';
import { act, doorIdx, give, level, makeMatch, standAt, standNear, ticks, type Ctx } from './helpers';

function wakeAt(ctx: Ctx, x: number, y: number, z: number, faceX?: number, faceZ?: number) {
  ctx.match.testWakeEnemy(x, y, z);
  if (faceX !== undefined && faceZ !== undefined) {
    ctx.match.enemy.yaw = yawToward(faceX - x, faceZ - z);
    ctx.match.enemy.holdStill(1.5);
  }
}

function runUntil(ctx: Ctx, seconds: number, pred: () => boolean) {
  for (let t = 0; t < seconds; t += 0.05) {
    ctx.match.tick(0.05);
    if (pred()) return true;
  }
  return false;
}

describe('The Nower — patrol and hearing', () => {
  it('patrols the mansion on his own', () => {
    const ctx = makeMatch(1, 'medium');
    standAt(ctx, 'p1', 3, 23, 23); // players stay silent upstairs
    wakeAt(ctx, 40.5, -4, 33.5);
    const start = { x: ctx.match.enemy.x, z: ctx.match.enemy.z };
    const seen = new Set<EnemyState>();
    let maxDist = 0;
    for (let t = 0; t < 60; t += 0.05) {
      ctx.match.tick(0.05);
      seen.add(ctx.match.enemy.state);
      maxDist = Math.max(maxDist, Math.hypot(ctx.match.enemy.x - start.x, ctx.match.enemy.z - start.z));
    }
    expect(seen.has('PATROL')).toBe(true);
    expect(maxDist).toBeGreaterThan(6);
  });

  it('a dropped metal tool attracts him to the right area; crouching nearby does not', () => {
    const ctx = makeMatch(1, 'medium');
    const { match } = ctx;
    standAt(ctx, 'p1', 2, 58, 38); // corridor, behind the closed kitchen door
    wakeAt(ctx, 58.5, 0, 28.5, 52, 28); // kitchen, facing away
    ctx.match.tick(0.05);
    match.noise(2, 58.5, 0, 38.5, NOISE.crouch, 'p1');
    ctx.match.tick(0.05);
    expect(match.enemy.state).not.toBe('INVESTIGATE_SOUND');

    give(ctx, 'p1', 'wrench');
    match.handleDrop('p1');
    ctx.match.tick(0.05);
    expect(match.enemy.state).toBe('INVESTIGATE_SOUND');
    const reached = runUntil(ctx, 20, () => match.enemy.z > 36.6 && Math.hypot(match.enemy.x - 58.5, match.enemy.z - 38.5) < 6);
    expect(reached).toBe(true);
    // every kitchen door starts closed: he had to open one himself on the way
    expect(ctx.events.some((e) => e.k === 'sound' && e.s === 'enemy_open_door')).toBe(true);
    void doorIdx;
  });
});

describe('The Nower — vision, chase and search', () => {
  it('seeing a player starts a chase', () => {
    const ctx = makeMatch(1, 'medium');
    standAt(ctx, 'p1', 2, 52, 46);
    wakeAt(ctx, 43.5, 0, 46.5, 52.5, 46.5);
    const chased = runUntil(ctx, 3, () => ctx.match.enemy.state === 'CHASE');
    expect(chased).toBe(true);
    expect(ctx.events.some((e) => e.k === 'cue' && e.cue === 'spotted')).toBe(true);
  });

  it('a player behind a wall is not seen', () => {
    const ctx = makeMatch(1, 'medium');
    standAt(ctx, 'p1', 2, 35, 46); // living room, other side of the hall wall
    wakeAt(ctx, 43.5, 0, 46.5, 35.5, 46.5);
    const chased = runUntil(ctx, 3, () => ctx.match.enemy.state === 'CHASE');
    expect(chased).toBe(false);
  });

  it('losing line of sight leads to a search at the last known position, not omniscience', () => {
    const ctx = makeMatch(1, 'medium');
    const { match } = ctx;
    standAt(ctx, 'p1', 2, 52, 46);
    wakeAt(ctx, 43.5, 0, 46.5, 52.5, 46.5);
    runUntil(ctx, 3, () => match.enemy.state === 'CHASE');
    // the player vanishes upstairs out of sight
    standAt(ctx, 'p1', 4, 35, 30);
    const searched = runUntil(ctx, 15, () => match.enemy.state === 'SEARCH_AREA');
    expect(searched).toBe(true);
    // he searches around where he last saw them, on the ground floor
    expect(floorOfY(match.enemy.y)).toBe(2);
    expect(Math.hypot(match.enemy.x - 52.5, match.enemy.z - 46.5)).toBeLessThan(12);
  });

  it('hiding unseen breaks detection', () => {
    const ctx = makeMatch(1, 'medium');
    const { match } = ctx;
    const h = level.hides.find((hh) => level.rooms[hh.room].spec.id === 'guest')!;
    standNear(ctx, 'p1', `hide:${h.index}`);
    act(ctx, 'p1', `hide:${h.index}`);
    expect(match.players.get('p1')!.status).toBe('hidden');
    wakeAt(ctx, 40.5, -4, 33.5);
    ticks(ctx, 30);
    expect(match.players.get('p1')!.status).toBe('hidden');
  });

  it('he searches a hiding spot he saw a player enter', () => {
    const ctx = makeMatch(1, 'medium');
    const { match } = ctx;
    const h = level.hides.find((hh) => hh.kind === 'wardrobe' && level.rooms[hh.room].spec.id === 'master')!;
    standNear(ctx, 'p1', `hide:${h.index}`);
    const p = match.testPlayer('p1');
    // put him a few metres away, looking at the player
    let spot: [number, number] | null = null;
    for (let r = 4; r <= 7 && !spot; r++)
      for (let a = 0; a < 16 && !spot; a++) {
        const x = p.x + Math.cos((a / 16) * Math.PI * 2) * r;
        const z = p.z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (canStand(level, match.dyn, x, 4, z) && level.floors[3].room[Math.floor(z) * level.W + Math.floor(x)] === h.room) spot = [x, z];
      }
    expect(spot).not.toBeNull();
    wakeAt(ctx, spot![0], 4, spot![1], p.x, p.z);
    expect(runUntil(ctx, 4, () => match.enemy.state === 'CHASE')).toBe(true);
    act(ctx, 'p1', `hide:${h.index}`);
    expect(match.players.get('p1')!.status).toBe('hidden');
    const searched = runUntil(ctx, 2, () => match.enemy.state === 'SEARCH_HIDING_SPOT');
    expect(searched).toBe(true);
    const caught = runUntil(ctx, 12, () => match.players.get('p1')!.status === 'captured');
    expect(caught).toBe(true);
  });
});

describe('The Nower — capture, rescue and stuns', () => {
  it('captures a player, cages them, and a teammate can rescue', () => {
    const ctx = makeMatch(2, 'medium');
    const { match } = ctx;
    standAt(ctx, 'p1', 2, 46, 46);
    standAt(ctx, 'p2', 3, 23, 23);
    wakeAt(ctx, 44.5, 0, 46.5, 46.5, 46.5);
    expect(runUntil(ctx, 5, () => match.players.get('p1')!.status === 'captured')).toBe(true);
    expect(match.alert).toBe('PLAYER_CAPTURED');
    match.testFreezeEnemy();
    ticks(ctx, 3);
    const p1 = match.players.get('p1')!;
    expect(p1.status).toBe('caged');
    expect(p1.captures).toBe(1);
    const cage = level.cageDoor;
    expect(match.doors[cage].locked).toBe(true);
    // caged player cannot open it yet
    expect(match.handleAct('p1', `door:${cage}`).ok).toBe(false);
    standAt(ctx, 'p2', 1, 39, 32, [38.5, -3, 32.5]);
    act(ctx, 'p2', `door:${cage}`);
    expect(match.players.get('p1')!.status).toBe('free');
    expect(match.doors[cage].open).toBe(true);
    expect(ctx.ended()).toBeNull();
  });

  it('captured players can work the latch loose after the self-release delay (easy)', () => {
    const ctx = makeMatch(1, 'easy');
    const { match } = ctx;
    match.capture('p1');
    ticks(ctx, 3);
    expect(match.players.get('p1')!.status).toBe('caged');
    standAt(ctx, 'p1', 1, 37, 32, [38.5, -3, 32.5]);
    expect(match.handleAct('p1', `door:${level.cageDoor}`).ok).toBe(false);
    ticks(ctx, 26);
    act(ctx, 'p1', `door:${level.cageDoor}`);
    expect(match.players.get('p1')!.status).toBe('free');
  });

  it('on extreme a lone caged player loses (no self rescue) and the game ends', () => {
    const ctx = makeMatch(1, 'extreme');
    ctx.match.capture('p1');
    ticks(ctx, 3);
    expect(ctx.ended()).toBe('GAME_OVER');
  });

  it('the flash camera temporarily disables him', () => {
    const ctx = makeMatch(1, 'medium');
    const { match } = ctx;
    standAt(ctx, 'p1', 2, 52, 46);
    wakeAt(ctx, 46.5, 0, 46.5, 52.5, 46.5);
    give(ctx, 'p1', 'flash_camera');
    const p = match.testPlayer('p1');
    const yaw = yawToward(46.5 - p.x, 46.5 - p.z);
    match.testPlace('p1', p.x, p.y, p.z, yaw);
    expect(match.handleUse('p1', yaw, 0).ok).toBe(true);
    expect(match.enemy.state).toBe('TEMPORARILY_DISABLED');
    // still blinded a few seconds later even though the player is right in front of him
    ticks(ctx, 3);
    expect(match.enemy.state).toBe('TEMPORARILY_DISABLED');
    ticks(ctx, 4);
    expect(match.enemy.state).not.toBe('TEMPORARILY_DISABLED');
  });

  it('survives a long noisy session without breaking (no NaN, never stuck in walls)', () => {
    const ctx = makeMatch(2, 'hard', 777);
    const { match } = ctx;
    standAt(ctx, 'p1', 2, 60, 30);
    standAt(ctx, 'p2', 1, 60, 30);
    wakeAt(ctx, 48.5, 0, 46.5);
    const states = new Set<EnemyState>();
    for (let t = 0; t < 180; t += 0.05) {
      match.tick(0.05);
      states.add(match.enemy.state);
      const e = match.enemy;
      expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z)).toBe(true);
      if (Math.round(t * 20) % 60 === 0) {
        const p = match.testPlayer(Math.random() < 0.5 ? 'p1' : 'p2');
        if (p.pub.status === 'free') match.noise(floorOfY(p.y), p.x, p.y, p.z, 18 + Math.random() * 15, p.pub.id);
      }
      if (match.players.get('p1')!.status === 'caged') match.testPlayer('p1').pub.status = 'free';
      if (match.players.get('p2')!.status === 'caged') match.testPlayer('p2').pub.status = 'free';
    }
    expect(canStand(level, match.dyn, match.enemy.x, match.enemy.y, match.enemy.z)).toBe(true);
    expect(states.size).toBeGreaterThanOrEqual(3);
  });
});
