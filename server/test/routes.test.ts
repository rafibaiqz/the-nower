/** End-to-end playthroughs of all three escape routes through the authoritative Match API. */
import { describe, expect, it } from 'vitest';
import { Navigator, pressureOf, resolveInteraction, type NavWorld } from '@nower/shared';
import { act, doorIdx, give, level, makeMatch, standAt, standNear, ticks, walkTo } from './helpers';

describe('Route A — main entrance', () => {
  it('can be completed: four locks, open, walk out through the gate', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    const fr = () => match.mechs.front;

    // the door refuses to open while locked
    standNear(ctx, 'p1', 'mech:front_door');
    expect(match.handleAct('p1', 'mech:front_door').ok).toBe(false);

    give(ctx, 'p1', 'entrance_key');
    act(ctx, 'p1', 'mech:front_door');
    expect(fr().keyLock).toBe(true);

    give(ctx, 'p1', 'lock_pick');
    act(ctx, 'p1', 'mech:front_door');
    expect(fr().padlock).toBe(true);

    // panel is dead until the basement fuse board is powered
    standNear(ctx, 'p1', 'mech:security_panel');
    expect(match.handleAct('p1', 'mech:security_panel').ok).toBe(false);
    give(ctx, 'p1', 'fuse_module');
    standNear(ctx, 'p1', 'mech:fuse_box');
    act(ctx, 'p1', 'mech:fuse_box');
    expect(match.mechs.fuse).toBe(true);

    standNear(ctx, 'p1', 'mech:security_panel');
    const panel = act(ctx, 'p1', 'mech:security_panel');
    expect((panel.data as { panel: boolean }).panel).toBe(true);
    const wrong = match.testPuzzles().code === '0000' ? '1111' : '0000';
    expect(match.handleCode('p1', wrong).ok).toBe(false);
    expect(match.handleCode('p1', match.testPuzzles().code).ok).toBe(true);
    expect(fr().maglock).toBe(true);

    give(ctx, 'p1', 'gear_handle');
    standNear(ctx, 'p1', 'mech:winch');
    act(ctx, 'p1', 'mech:winch');
    act(ctx, 'p1', 'mech:winch');
    expect(fr().bar).toBe(true);

    standNear(ctx, 'p1', 'mech:front_door');
    act(ctx, 'p1', 'mech:front_door');
    expect(match.doors[doorIdx('front_door')].open).toBe(true);

    walkTo(ctx, 'p1', 2, 48.5, 83.5);
    const p = match.players.get('p1')!;
    expect(p.status).toBe('escaped');
    expect(p.escapedVia).toBe('front');
    expect(ctx.ended()).toBe('TEAM_VICTORY');
  });

  it('three wrong codes trigger the alarm and lock the panel', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    match.mechs.fuse = true;
    standNear(ctx, 'p1', 'mech:security_panel');
    const bad = match.testPuzzles().code === '9999' ? '8888' : '9999';
    for (let i = 0; i < 3; i++) match.handleCode('p1', bad);
    expect(match.mechs.front.lockedUntil).toBeGreaterThan(match.now);
    match.tick(0.05);
    expect(ctx.events.some((e) => e.k === 'sound' && e.s === 'alarm')).toBe(true);
    expect(match.handleAct('p1', 'mech:security_panel').ok).toBe(false);
  });
});

describe('Route B — garage car', () => {
  it('can be completed: unlock garage, repair, fuel, open shutter, start and drive out', () => {
    const ctx = makeMatch(2);
    const { match } = ctx;
    const ug = doorIdx('utility_garage');
    standAt(ctx, 'p1', 2, 75, 33, [76.5, 1, 33.5]);
    expect(match.handleAct('p1', `door:${ug}`).ok).toBe(false);
    give(ctx, 'p1', 'garage_key');
    act(ctx, 'p1', `door:${ug}`);
    expect(match.doors[ug].open).toBe(true);
    expect(match.doors[ug].locked).toBe(false);

    standNear(ctx, 'p1', 'car:hood');
    act(ctx, 'p1', 'car:hood');
    expect(match.car.hood).toBe(true);
    for (const part of ['car_battery', 'ignition_coil', 'starter_relay']) {
      give(ctx, 'p1', part);
      act(ctx, 'p1', 'car:hood');
    }
    expect(match.car.battery && match.car.coil && match.car.relay).toBe(true);

    give(ctx, 'p1', 'fuel_canister');
    standNear(ctx, 'p1', 'car:fuel');
    act(ctx, 'p1', 'car:fuel');
    expect(match.car.fuel).toBe(1);

    // starting without the key fails loudly
    standNear(ctx, 'p1', 'car:driver');
    act(ctx, 'p1', 'car:driver');
    expect(match.players.get('p1')!.status).toBe('driving');
    expect(match.handleUse('p1', 0, 0).ok).toBe(false);
    expect(match.car.running).toBe(false);
    act(ctx, 'p1', 'car:driver'); // get out
    give(ctx, 'p1', 'car_key');
    act(ctx, 'p1', 'car:driver');
    expect(match.car.key).toBe(true);

    give(ctx, 'p2', 'wrench');
    standNear(ctx, 'p2', 'mech:shutter');
    act(ctx, 'p2', 'mech:shutter');
    act(ctx, 'p2', 'mech:shutter');
    expect(match.mechs.shutter.open).toBe(true);

    act(ctx, 'p1', 'car:driver');
    standNear(ctx, 'p2', 'car:passenger');
    act(ctx, 'p2', 'car:passenger');
    expect(match.handleUse('p1', 0, 0).ok).toBe(true);
    expect(match.car.running).toBe(true);
    match.tick(0.05);
    expect(ctx.events.some((e) => e.k === 'sound' && e.s === 'car_start')).toBe(true);

    match.handleCarInput('p1', { throttle: 1, steer: 0 });
    ticks(ctx, 20);
    expect(match.mechs.driveGate).toBe(true);
    expect(match.car.escaped).toBe(true);
    expect(match.players.get('p1')!.escapedVia).toBe('garage');
    expect(match.players.get('p2')!.escapedVia).toBe('garage');
    expect(ctx.ended()).toBe('TEAM_VICTORY');
  });

  it('the closed shutter physically stops the car', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    Object.assign(match.car, { battery: true, coil: true, relay: true, fuel: 1, key: true });
    standNear(ctx, 'p1', 'car:driver');
    act(ctx, 'p1', 'car:driver');
    match.handleUse('p1', 0, 0);
    match.handleCarInput('p1', { throttle: 1, steer: 0 });
    ticks(ctx, 6);
    expect(match.car.z).toBeLessThan(47);
    expect(match.car.escaped).toBe(false);
  });
});

describe('Route C — sewer', () => {
  it('can be completed: tunnel gate, drain the cistern, valves, floodgate, outfall grate', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    const nav = new Navigator(level);
    const world: NavWorld = { doorOpen: (i) => match.doors[i].open, doorPassable: (i) => !match.doors[i].locked, waterDrained: (i) => match.water[i].drained, ladderOpen: () => false };

    // the sewer is sealed off until the tunnel gate is unlocked
    expect(nav.findPath(world, 1, 71.5, 33.5, 0, 80.5, 52.5)).toBeNull();
    const gate = doorIdx('pump_tunnel');
    standAt(ctx, 'p1', 1, 71, 35, [71.5, -3, 36.5]);
    give(ctx, 'p1', 'maintenance_key');
    act(ctx, 'p1', `door:${gate}`);
    expect(nav.findPath(world, 1, 71.5, 33.5, 0, 80.5, 52.5)).not.toBeNull();

    // walk down into the sewer for real
    walkTo(ctx, 'p1', 0, 72.5, 51.5);
    const smaint = doorIdx('saccess_smaint');
    standAt(ctx, 'p1', 0, 75, 51, [76.5, -7, 51.5]);
    act(ctx, 'p1', `door:${smaint}`);

    // flooded cistern blocks the way west
    expect(nav.findPath(world, 0, 72.5, 51.5, 0, 32.5, 44.5)).toBeNull();
    give(ctx, 'p1', 'pump_fuse');
    standNear(ctx, 'p1', 'mech:pump_panel');
    act(ctx, 'p1', 'mech:pump_panel');
    act(ctx, 'p1', 'mech:pump_panel');
    expect(match.mechs.pump.running).toBe(true);
    ticks(ctx, 26);
    expect(match.water[0].drained).toBe(true);
    expect(nav.findPath(world, 0, 72.5, 51.5, 0, 32.5, 44.5)).not.toBeNull();

    walkTo(ctx, 'p1', 0, 32.5, 44.5);
    give(ctx, 'p1', 'pressure_gauge');
    standNear(ctx, 'p1', 'mech:manifold');
    act(ctx, 'p1', 'mech:manifold');
    give(ctx, 'p1', 'valve_handle');
    act(ctx, 'p1', 'mech:manifold');
    expect(match.mechs.manifold.gauge && match.mechs.manifold.handle).toBe(true);
    const w = match.valveWeights;
    let mask = -1;
    for (let mm = 0; mm < 8; mm++) if (w.reduce((s, v, i) => s + (mm & (1 << i) ? v : 0), 0) === match.valveTarget) mask = mm;
    for (let v = 0; v < 3; v++) {
      const want = !!(mask & (1 << v));
      if (match.mechs.manifold.valves[v] !== want) {
        standNear(ctx, 'p1', `mech:valve_${v + 1}`);
        act(ctx, 'p1', `mech:valve_${v + 1}`);
      }
    }
    expect(pressureOf(match)).toBe(match.valveTarget);
    expect(match.mechs.manifold.equalized).toBe(true);

    walkTo(ctx, 'p1', 0, 14.5, 57.5);
    give(ctx, 'p1', 'floodgate_key');
    standNear(ctx, 'p1', 'mech:floodgate_box');
    act(ctx, 'p1', 'mech:floodgate_box');
    act(ctx, 'p1', 'mech:floodgate_box');
    expect(match.doors[doorIdx('floodgate')].open).toBe(true);

    walkTo(ctx, 'p1', 0, 12.5, 7.5);
    give(ctx, 'p1', 'access_wheel');
    standNear(ctx, 'p1', 'mech:final_wheel');
    act(ctx, 'p1', 'mech:final_wheel');
    act(ctx, 'p1', 'mech:final_wheel');
    expect(match.doors[doorIdx('final_grate')].open).toBe(true);

    walkTo(ctx, 'p1', 0, 11.5, 2.5);
    expect(match.players.get('p1')!.escapedVia).toBe('sewer');
    expect(ctx.ended()).toBe('TEAM_VICTORY');
  });

  it('the optional garden grate shortcut can be forced with the hydraulic spreader', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    const li = level.ladders.findIndex((l) => l.spec.id === 'garden_grate');
    standAt(ctx, 'p1', 2, 11, 31, [11.5, 1, 30.5]);
    expect(match.handleAct('p1', `ladder:${li}:a`).ok).toBe(false);
    give(ctx, 'p1', 'hydraulic_tool');
    act(ctx, 'p1', `ladder:${li}:a`);
    expect(match.ladders[li]).toBe(true);
    match.handleDrop('p1');
    act(ctx, 'p1', `ladder:${li}:a`);
    ticks(ctx, 1.6);
    const p = match.testPlayer('p1');
    expect(p.pub.status).toBe('free');
    expect(p.y).toBeLessThan(-7);
  });
});

describe('item and door rules', () => {
  it('two players cannot obtain the same unique item', () => {
    const ctx = makeMatch(2);
    const { match } = ctx;
    const it = match.items.get('wrench')!;
    const ref = 'item:wrench';
    if (it.container >= 0) match.containers[it.container] = true;
    standNear(ctx, 'p1', ref);
    standNear(ctx, 'p2', ref);
    const a = match.handleAct('p1', ref);
    const b = match.handleAct('p2', ref);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(match.items.get('wrench')!.holder).toBe('p1');
    expect(match.players.get('p2')!.held).toBeNull();
  });

  it('cannot interact from impossible distances or through walls', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    const it = match.items.get('entrance_key')!;
    if (it.container >= 0) match.containers[it.container] = true;
    match.testPlace('p1', it.pos[0] + 6, it.pos[1], it.pos[2]);
    expect(match.handleAct('p1', 'item:entrance_key').ok).toBe(false);
    // door from the far side of a wall
    standAt(ctx, 'p1', 2, 41, 43); // hall, well away from the living-room door
    expect(match.handleAct('p1', `door:${doorIdx('living_corridor')}`).ok).toBe(false);
  });

  it('dropped items land on a valid reachable floor position', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    give(ctx, 'p1', 'wrench');
    standAt(ctx, 'p1', 3, 47, 42, [48, 5, 49]); // gallery, facing the hall void
    match.handleDrop('p1');
    const w = match.items.get('wrench')!;
    expect(w.place).toBe('world');
    expect(w.pos[1]).toBeCloseTo(4, 3);
    expect(Math.floor(w.pos[2])).toBeLessThanOrEqual(44);
    match.tick(0.05);
    expect(ctx.events.some((e) => e.k === 'sound' && e.s === 'drop')).toBe(true);
  });

  it('a disconnecting player drops their critical item', () => {
    const ctx = makeMatch(2);
    const { match } = ctx;
    give(ctx, 'p1', 'car_key');
    standAt(ctx, 'p1', 2, 48, 50);
    match.handleDisconnect('p1');
    const k = match.items.get('car_key')!;
    expect(k.place).toBe('world');
    expect(k.holder).toBeNull();
    standNear(ctx, 'p2', 'item:car_key');
    expect(match.handleAct('p2', 'item:car_key').ok).toBe(true);
  });

  it('locked doors require their key; prompts match server rules', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    const d = doorIdx('library_trophy');
    standAt(ctx, 'p1', 2, 27, 30, [27.5, 1, 29.5]);
    const inter = resolveInteraction(match, 'p1', `door:${d}`, level.roomById.get('trophy')!);
    expect(inter?.enabled).toBe(false);
    expect(match.handleAct('p1', `door:${d}`).ok).toBe(false);
    give(ctx, 'p1', 'library_key');
    act(ctx, 'p1', `door:${d}`);
    expect(match.doors[d].locked).toBe(false);
    expect(match.items.get('library_key')!.place).toBe('used');
  });

  it('the one-way bookcase opens only from inside the library', () => {
    const ctx = makeMatch(1);
    const { match } = ctx;
    const d = doorIdx('library_study');
    standAt(ctx, 'p1', 2, 34, 19, [33.5, 1, 19.5]);
    expect(match.handleAct('p1', `door:${d}`).ok).toBe(false);
    standAt(ctx, 'p1', 2, 32, 19, [33.5, 1, 19.5]);
    act(ctx, 'p1', `door:${d}`);
    expect(match.doors[d].open).toBe(true);
  });
});
