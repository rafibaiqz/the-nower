/**
 * Interaction rules. Given the replicated world state, an actor and a target reference, this
 * returns the one contextual action available (or a disabled hint). The client uses it to draw
 * prompts; the server uses the very same function to validate requests before executing them,
 * so prompts and authority can never drift apart.
 */
import { DIFFICULTY, type Difficulty } from './difficulty';
import { itemDef } from './items';
import { floorOfY } from './constants';
import { forwardFromYaw } from './level/grid';
import { CT, type Level } from './level/types';
import type { CarState, DoorState, ItemState, MechStates, PlayerPublic, TrapState } from './protocol';

export interface WorldView {
  level: Level;
  difficulty: Difficulty;
  now: number;
  doors: DoorState[];
  items: Map<string, ItemState>;
  containers: boolean[];
  hides: (string | null)[];
  ladders: boolean[];
  water: { drained: boolean; level: number }[];
  mechs: MechStates;
  car: CarState;
  traps: TrapState[];
  players: Map<string, PlayerPublic>;
  valveWeights: number[];
  valveTarget: number;
}

export interface Interaction {
  target: string;
  action: string;
  label: string;
  hold: number;
  enabled: boolean;
}

export const HOLD = {
  pick: 5,
  crank: 4,
  install: 2,
  fuel: 4,
  bolts: 5,
  shutter: 2.5,
  rescue: 3,
  latch: 6,
  trap: 1.5,
  grate: 4,
  valve: 1.2,
  pump: 1.5,
  wheel: 6,
  generator: 2,
  open: 1.5,
} as const;

const ROMAN = ['I', 'II', 'III'];

export function carPoint(car: CarState, lx: number, ly: number, lz: number): [number, number, number] {
  const f = forwardFromYaw(car.yaw);
  const rx = -f.z;
  const rz = f.x;
  return [car.x + rx * lx + f.x * lz, ly, car.z + rz * lx + f.z * lz];
}

export const CAR_POINTS: Record<string, [number, number, number]> = {
  driver: [-1.0, 1.0, 0.25],
  passenger: [1.0, 1.0, 0.25],
  hood: [0, 1.0, 2.45],
  fuel: [1.0, 0.9, -1.55],
};

/** World position of an interaction target (for range checks and prompts). */
export function targetPos(view: WorldView, ref: string, actor?: { x: number; y: number; z: number }): [number, number, number] | null {
  const [kind, a, b] = ref.split(':');
  const L = view.level;
  switch (kind) {
    case 'door': {
      const d = L.doors[Number(a)];
      return d ? [d.center[0], d.center[1] + 1.2, d.center[2]] : null;
    }
    case 'item': {
      const it = view.items.get(a);
      return it ? [it.pos[0], it.pos[1] + 0.1, it.pos[2]] : null;
    }
    case 'cont': {
      const c = L.containers[Number(a)];
      return c ? c.pos : null;
    }
    case 'hide': {
      const h = L.hides[Number(a)];
      if (!h) return null;
      const fu = L.furniture[h.furn];
      return [fu.center[0], h.inside[1] + (h.kind === 'bed' ? 0.4 : 1.1), fu.center[2]];
    }
    case 'ladder': {
      const l = L.ladders[Number(a)];
      if (!l) return null;
      const p = b === 'b' ? l.pb : l.pa;
      return [p[0], p[1] + 1.0, p[2]];
    }
    case 'note': {
      const n = L.notes[Number(a)];
      return n ? n.pos : null;
    }
    case 'mech': {
      const i = L.mechById.get(a);
      return i === undefined ? null : L.mechs[i].spec.pos;
    }
    case 'car': {
      const p = CAR_POINTS[a];
      return p ? carPoint(view.car, p[0], p[1], p[2]) : null;
    }
    case 'player': {
      void actor;
      return null; // resolved by caller from live positions
    }
    default:
      return null;
  }
}

function itemName(type: string) {
  return itemDef(type).name.toUpperCase();
}

/** Resolves the contextual action for an actor and a target. */
export function resolveInteraction(view: WorldView, actorId: string, ref: string, actorRoom = -1): Interaction | null {
  const actor = view.players.get(actorId);
  if (!actor) return null;
  const held = actor.held ? view.items.get(actor.held)?.type ?? null : null;
  const hints = DIFFICULTY[view.difficulty].hintLevel;
  const make = (action: string, label: string, hold = 0, enabled = true): Interaction => ({ target: ref, action, label, hold, enabled });
  const need = (what: string) => (hints >= 2 ? ` — NEEDS ${what}` : '');
  const [kind, a, b] = ref.split(':');
  const L = view.level;

  if (actor.status === 'hidden') return make('unhide', 'E — LEAVE HIDING');
  if (actor.status === 'driving' || actor.status === 'passenger') return make('car_exit', 'E — GET OUT');
  if (actor.status !== 'free' && actor.status !== 'caged') return null;

  if (actor.status === 'caged') {
    if (kind !== 'door' || Number(a) !== L.cageDoor) return null;
    const sr = DIFFICULTY[view.difficulty].selfReleaseSeconds;
    if (sr === null) return make('none', 'THE LATCH IS OUT OF REACH — WAIT FOR RESCUE', 0, false);
    const ready = actor.cagedAt + sr * 1000;
    if (view.now < ready) return make('none', `THE LATCH WON'T GIVE YET (${Math.ceil((ready - view.now) / 1000)}s)`, 0, false);
    return make('cage_latch', 'HOLD E — WORK THE LATCH LOOSE', HOLD.latch);
  }

  switch (kind) {
    case 'door': {
      const i = Number(a);
      const d = L.doors[i];
      const s = view.doors[i];
      if (!d || !s) return null;
      const lock = d.spec.lock;
      if (d.spec.kind === 'cage') {
        if (s.locked) return make('cage_rescue', 'HOLD E — FORCE THE CAGE DOOR', HOLD.rescue);
        return make('door_toggle', s.open ? 'E — CLOSE CAGE' : 'E — OPEN CAGE');
      }
      if (lock?.kind === 'mech') return null;
      if (s.locked) {
        if (lock?.kind === 'item') {
          if (held === lock.item) return make('door_unlock', `E — UNLOCK (${itemName(lock.item)})`);
          return make('none', `LOCKED${need(itemName(lock.item))}`, 0, false);
        }
        if (lock?.kind === 'bolt') {
          const boltRoom = L.roomById.get(lock.room);
          if (actorRoom === boltRoom) return make('door_unbolt', d.spec.kind === 'bookcase' ? 'E — PULL THE HIDDEN LEVER' : 'E — DRAW THE BOLT');
          return make('none', d.spec.kind === 'bookcase' ? 'A HEAVY BOOKCASE. SOMETHING CLICKS BEHIND IT.' : 'BOLTED FROM THE OTHER SIDE', 0, false);
        }
        return make('none', 'LOCKED', 0, false);
      }
      if (d.spec.secret && !s.open) return make('door_toggle', d.spec.kind === 'brickwall' ? 'E — PUSH THE LOOSE BRICKS' : 'E — PUSH THE LOOSE PANEL');
      return make('door_toggle', s.open ? 'E — CLOSE' : 'E — OPEN');
    }
    case 'item': {
      const it = view.items.get(a);
      if (!it || it.place !== 'world') return null;
      if (it.container >= 0 && !view.containers[it.container]) return null;
      const def = itemDef(it.type);
      if (def.battery) return make('pickup', 'E — TAKE BATTERY');
      return make('pickup', held ? `E — SWAP FOR ${def.name.toUpperCase()}` : `E — PICK UP ${def.name.toUpperCase()}`);
    }
    case 'cont': {
      const i = Number(a);
      const c = L.containers[i];
      if (!c) return null;
      const noun = c.kind === 'drawer' ? 'DRAWER' : c.kind === 'fridge' ? 'FRIDGE' : c.kind === 'chest' ? 'CHEST' : 'CUPBOARD';
      return make('cont_toggle', view.containers[i] ? `E — CLOSE ${noun}` : `E — OPEN ${noun}`);
    }
    case 'hide': {
      const i = Number(a);
      const h = L.hides[i];
      if (!h) return null;
      const occ = view.hides[i];
      if (occ && occ !== actorId) return make('none', 'OCCUPIED', 0, false);
      if (held && itemDef(held).heavy) return make('none', 'TOO BULKY TO HIDE WITH — DROP IT (G)', 0, false);
      const label = h.kind === 'bed' ? 'E — HIDE UNDER BED' : h.kind === 'wardrobe' ? 'E — HIDE IN WARDROBE' : h.kind === 'locker' ? 'E — HIDE IN CUPBOARD' : 'E — SQUEEZE INTO NICHE';
      return make('hide', label);
    }
    case 'ladder': {
      const i = Number(a);
      const l = L.ladders[i];
      if (!l) return null;
      const open = view.ladders[i];
      const end = b === 'b' ? l.spec.b : l.spec.a;
      const other = b === 'b' ? l.spec.a : l.spec.b;
      if (!open) {
        if (held === 'hydraulic_tool') return make('grate_force', 'HOLD E — FORCE THE GRATE OPEN', HOLD.grate);
        return make('none', `RUSTED SHUT${need('A HYDRAULIC SPREADER')}`, 0, false);
      }
      if (held && itemDef(held).heavy) return make('none', 'TOO HEAVY TO CLIMB WITH', 0, false);
      return make('climb', other.f > end.f ? 'E — CLIMB UP' : 'E — CLIMB DOWN');
    }
    case 'note':
      return L.notes[Number(a)] ? make('read', 'E — READ') : null;
    case 'mech':
      return resolveMech(view, a, held, make, need);
    case 'car': {
      const car = view.car;
      if (car.escaped) return null;
      switch (a) {
        case 'hood':
          if (!car.hood) return make('car_hood', 'E — OPEN THE HOOD');
          if (held === 'car_battery' && !car.battery) return make('car_battery', 'HOLD E — INSTALL THE BATTERY', HOLD.install);
          if (held === 'ignition_coil' && !car.coil) return make('car_coil', 'HOLD E — FIT THE IGNITION COIL', HOLD.install);
          if (held === 'starter_relay' && !car.relay) return make('car_relay', 'HOLD E — PLUG IN THE STARTER RELAY', HOLD.install);
          return make('car_hood', `E — CLOSE HOOD  [${car.battery ? 'BATTERY ✓' : 'BATTERY ✗'}  ${car.coil ? 'COIL ✓' : 'COIL ✗'}  ${car.relay ? 'RELAY ✓' : 'RELAY ✗'}]`);
        case 'fuel':
          if (car.fuel >= 1) return make('none', 'FUEL TANK: FULL', 0, false);
          if (held === 'fuel_canister') return make('car_fuel', 'HOLD E — POUR THE FUEL', HOLD.fuel);
          return make('none', `FUEL TANK: EMPTY${need('A FUEL CANISTER')}`, 0, false);
        case 'driver':
          if (held === 'car_key' && !car.key) return make('car_key', 'E — PUT THE KEY IN THE IGNITION');
          if (car.driver) return make('none', 'SOMEONE IS DRIVING', 0, false);
          if (held && itemDef(held).heavy) return make('none', 'DROP WHAT YOU ARE CARRYING FIRST', 0, false);
          return make('car_driver', 'E — GET IN (DRIVER)');
        case 'passenger':
          if (car.passenger) return make('none', 'SEAT TAKEN', 0, false);
          if (held && itemDef(held).heavy) return make('none', 'DROP WHAT YOU ARE CARRYING FIRST', 0, false);
          return make('car_passenger', 'E — GET IN (PASSENGER)');
      }
      return null;
    }
    case 'player': {
      const p = view.players.get(a);
      if (!p || p.id === actorId) return null;
      if (p.status === 'trapped') return make('free_trap', `HOLD E — PRY ${p.name.toUpperCase()} FREE`, HOLD.trap);
      return null;
    }
  }
  return null;
}

function resolveMech(
  view: WorldView,
  id: string,
  held: string | null,
  make: (action: string, label: string, hold?: number, enabled?: boolean) => Interaction,
  need: (w: string) => string,
): Interaction | null {
  const m = view.mechs;
  const fr = m.front;
  switch (id) {
    case 'front_door': {
      if (fr.open) return null;
      if (held === 'entrance_key' && !fr.keyLock) return make('front_key', 'E — TURN THE RUSTED KEY');
      if (held === 'lock_pick' && !fr.padlock) return make('front_pick', 'HOLD E — PICK THE PADLOCK', HOLD.pick);
      const n = Number(fr.keyLock) + Number(fr.padlock) + Number(fr.maglock) + Number(fr.bar);
      if (n === 4) return make('front_open', 'HOLD E — OPEN THE MAIN ENTRANCE', HOLD.open);
      const parts = [
        fr.keyLock ? null : `KEY LOCK${need('RUSTED ENTRANCE KEY')}`,
        fr.padlock ? null : `PADLOCK${need('BRASS LOCK PICK')}`,
        fr.maglock ? null : 'ELECTRIC BOLT',
        fr.bar ? null : 'IRON BAR',
      ].filter(Boolean);
      return make('none', `MAIN ENTRANCE — ${n}/4 LOCKS OPEN · ${parts[0]}`, 0, false);
    }
    case 'security_panel':
      if (fr.maglock) return make('none', 'ELECTRIC BOLT RELEASED', 0, false);
      if (!m.fuse) return make('none', `THE PANEL IS DEAD${need('POWER FROM THE BASEMENT FUSE BOARD')}`, 0, false);
      if (fr.lockedUntil > view.now) return make('none', `PANEL LOCKED OUT (${Math.ceil((fr.lockedUntil - view.now) / 1000)}s)`, 0, false);
      return make('panel', 'E — USE THE KEYPAD');
    case 'winch':
      if (fr.bar) return make('none', 'THE IRON BAR IS RAISED', 0, false);
      if (!fr.handle) {
        if (held === 'gear_handle') return make('winch_fit', 'E — FIT THE GEAR HANDLE');
        return make('none', `THE WINCH HAS NO HANDLE${need('MECHANICAL GEAR HANDLE')}`, 0, false);
      }
      return make('winch_crank', 'HOLD E — CRANK THE WINCH', HOLD.crank);
    case 'fuse_box':
      if (m.fuse) return make('none', 'SECURITY CIRCUIT LIVE', 0, false);
      if (held === 'fuse_module') return make('fuse_install', 'HOLD E — SEAT THE FUSE MODULE', HOLD.install);
      return make('none', `EMPTY SLOT MARKED "SECURITY"${need('CERAMIC FUSE MODULE')}`, 0, false);
    case 'generator':
      if (m.generator.running) return make('none', 'THE GENERATOR IS ROARING', 0, false);
      return make('gen_start', 'HOLD E — PULL THE STARTER CORD (LOUD)', HOLD.generator);
    case 'shutter':
      if (m.shutter.open) return make('none', 'THE SHUTTER IS OPEN', 0, false);
      if (!m.shutter.bolts) {
        if (held === 'wrench') return make('shutter_bolts', 'HOLD E — LOOSEN THE SEIZED BOLTS', HOLD.bolts);
        return make('none', `SHUTTER BOLTS RUSTED SOLID${need('A WRENCH')}`, 0, false);
      }
      return make('shutter_raise', 'HOLD E — HAUL THE SHUTTER UP (LOUD)', HOLD.shutter);
    case 'pump_panel': {
      const p = m.pump;
      if (p.drained) return make('none', 'CISTERN DRAINED', 0, false);
      if (p.running) return make('none', `PUMP RUNNING — DRAINING ${Math.round(p.progress * 100)}%`, 0, false);
      if (!p.fuse) {
        if (held === 'pump_fuse') return make('pump_fuse', 'HOLD E — INSERT THE PUMP FUSE', HOLD.install);
        return make('none', `PUMP FUSE MISSING${need('PUMP FUSE')}`, 0, false);
      }
      return make('pump_start', 'HOLD E — START THE DRAINAGE PUMP (LOUD)', HOLD.pump);
    }
    case 'valve_1':
    case 'valve_2':
    case 'valve_3': {
      const v = Number(id.slice(-1)) - 1;
      if (m.floodgate.open) return make('none', 'THE LINES ARE LOCKED', 0, false);
      if (!m.manifold.handle) return make('none', `LINE ${ROMAN[v]} (${view.valveWeights[v]} BAR) — NO VALVE HANDLE FITTED`, 0, false);
      return make('valve_turn', `HOLD E — ${m.manifold.valves[v] ? 'CLOSE' : 'OPEN'} LINE ${ROMAN[v]} (${view.valveWeights[v]} BAR)`, HOLD.valve);
    }
    case 'manifold': {
      const mf = m.manifold;
      if (!mf.gauge) {
        if (held === 'pressure_gauge') return make('manifold_gauge', 'HOLD E — MOUNT THE PRESSURE GAUGE', HOLD.install);
        return make('none', `THE GAUGE SOCKET IS EMPTY${need('PRESSURE GAUGE')}`, 0, false);
      }
      if (!mf.handle) {
        if (held === 'valve_handle') return make('manifold_handle', 'HOLD E — FIT THE VALVE HANDLE', HOLD.install);
        return make('none', `PRESSURE ${pressureOf(view)} / TARGET ${view.valveTarget}${need('VALVE HANDLE')}`, 0, false);
      }
      return make('none', `PRESSURE ${pressureOf(view)} BAR / TARGET ${view.valveTarget} BAR${mf.equalized ? ' — EQUALISED' : ''}`, 0, false);
    }
    case 'floodgate_box': {
      const fg = m.floodgate;
      if (fg.open) return make('none', 'THE FLOODGATE IS OPEN', 0, false);
      if (!fg.key) {
        if (held === 'floodgate_key') return make('flood_key', 'E — INSERT THE CONTROL KEY');
        return make('none', `NO CONTROL KEY${need('FLOODGATE CONTROL KEY')}`, 0, false);
      }
      if (!m.manifold.equalized) return make('none', 'LINE PRESSURE NOT EQUALISED', 0, false);
      return make('flood_raise', 'HOLD E — RAISE THE FLOODGATE (LOUD)', HOLD.pump);
    }
    case 'final_wheel': {
      const g = m.finalGrate;
      if (g.open) return null;
      if (!g.wheel) {
        if (held === 'access_wheel') return make('wheel_fit', 'HOLD E — FIT THE ACCESS WHEEL', HOLD.install);
        return make('none', `THE GRATE HUB IS BARE${need('SEWER ACCESS WHEEL')}`, 0, false);
      }
      return make('wheel_turn', 'HOLD E — TURN THE WHEEL', HOLD.wheel);
    }
  }
  return null;
}

export function pressureOf(view: { mechs: MechStates; valveWeights: number[] }): number {
  if (!view.mechs.manifold.gauge) return 0;
  return view.mechs.manifold.valves.reduce((s, on, i) => s + (on ? view.valveWeights[i] : 0), 0);
}

export interface TargetInfo {
  ref: string;
  pos: [number, number, number];
  f: number;
  /** Door cell to ignore in line-of-sight tests (the door itself). */
  ignoreDoor: number;
}

/** Every potentially interactive target, for client-side targeting. */
export function listTargets(view: WorldView): TargetInfo[] {
  const L = view.level;
  const out: TargetInfo[] = [];
  const push = (ref: string, pos: [number, number, number] | null, ignoreDoor = -1) => {
    if (pos) out.push({ ref, pos, f: floorOfY(pos[1] - 0.9), ignoreDoor });
  };
  L.doors.forEach((d, i) => {
    if (d.spec.lock?.kind === 'mech') return;
    push(`door:${i}`, targetPos(view, `door:${i}`), i);
  });
  for (const it of view.items.values()) {
    if (it.place !== 'world') continue;
    if (it.container >= 0 && !view.containers[it.container]) continue;
    push(`item:${it.id}`, targetPos(view, `item:${it.id}`));
  }
  L.containers.forEach((_, i) => push(`cont:${i}`, targetPos(view, `cont:${i}`)));
  L.hides.forEach((_, i) => push(`hide:${i}`, targetPos(view, `hide:${i}`)));
  L.ladders.forEach((_, i) => {
    push(`ladder:${i}:a`, targetPos(view, `ladder:${i}:a`));
    push(`ladder:${i}:b`, targetPos(view, `ladder:${i}:b`));
  });
  L.notes.forEach((_, i) => push(`note:${i}`, targetPos(view, `note:${i}`)));
  for (const m of L.mechs) if (m.spec.kind !== 'garden_grate') push(`mech:${m.spec.id}`, m.spec.pos);
  if (!view.car.escaped) for (const k of Object.keys(CAR_POINTS)) push(`car:${k}`, targetPos(view, `car:${k}`));
  return out;
}

/** True when a cell is the inside of the holding cage. */
export function isCageCell(level: Level, f: number, x: number, z: number): boolean {
  return level.cageCells.some((c) => c.f === f && c.x === Math.floor(x) && c.z === Math.floor(z));
}

export function isDoorCell(level: Level, f: number, x: number, z: number): boolean {
  return level.floors[f]?.type[Math.floor(z) * level.W + Math.floor(x)] === CT.DOOR;
}
