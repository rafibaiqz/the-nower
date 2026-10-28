/** Objective panel content. Steps unlock as players discover things; hints scale with difficulty. */
import { DIFFICULTY } from '@nower/shared';
import type { Objective } from '../state/store';
import type { ClientWorld } from './ClientWorld';

export function computeObjectives(w: ClientWorld): Objective[] {
  const hints = DIFFICULTY[w.difficulty].hintLevel;
  const m = w.mechs;
  const fr = m.front;
  const c = w.car;
  const seen = (type: string) => [...w.players.values()].some((p) => p.held && w.items.get(p.held)?.type === type) || w.items.get(type)?.place === 'used';
  const read = (id: string) => w.journal.includes(id);
  const detail = (cond: boolean, vague: string, specific: string) => (hints >= 3 || cond ? specific : vague);

  const front: Objective = {
    route: 'front',
    title: 'MAIN ENTRANCE',
    ready: fr.keyLock && fr.padlock && fr.maglock && fr.bar,
    steps: [
      { text: detail(read('locksmith') || seen('entrance_key'), 'Find a way to open the old key lock', 'Turn the Rusted Entrance Key in the lock'), done: fr.keyLock },
      { text: detail(read('locksmith') || seen('lock_pick'), 'Get rid of the chained padlock', 'Pick the padlock with a Brass Lock Pick'), done: fr.padlock },
      { text: detail(read('locksmith') || m.fuse, 'Restore power to the security system', 'Seat the fuse module in the basement fuse board'), done: m.fuse },
      { text: detail(read('cipher_hint') || seen('cipher_plate'), 'Disable the electric bolt', 'Decode the panel symbols with the Engraved Cipher Plate'), done: fr.maglock },
      { text: detail(read('locksmith') || seen('gear_handle'), 'Lift the iron bar', 'Fit the Gear Handle and crank the winch'), done: fr.bar },
      { text: 'Open the main entrance and run for the gate', done: fr.open },
    ],
  };
  const unlocked = !w.doors[w.level.doorById.get('utility_garage')!].locked;
  const garage: Objective = {
    route: 'garage',
    title: 'GARAGE',
    ready: c.running,
    steps: [
      { text: detail(seen('garage_key'), 'Get into the garage', 'Unlock the garage with the Garage Access Key'), done: unlocked },
      { text: detail(read('car_notes') || c.battery, 'Find vehicle components', 'Install the battery'), done: c.battery },
      ...(hints >= 3 || read('car_notes')
        ? [
            { text: 'Fit the ignition coil', done: c.coil },
            { text: 'Plug in the starter relay', done: c.relay },
            { text: 'Fill the tank from a fuel canister', done: c.fuel >= 1 },
            { text: 'Put the ignition key in', done: c.key },
          ]
        : [{ text: 'Repair the car', done: c.coil && c.relay && c.fuel >= 1 && c.key }]),
      { text: detail(read('car_notes') || m.shutter.bolts, 'Open the garage shutter', 'Loosen the shutter bolts (wrench) and haul it up'), done: m.shutter.open },
      { text: 'Start the engine (F) and drive through the gate', done: c.escaped },
    ],
  };
  const tunnel = !w.doors[w.level.doorById.get('pump_tunnel')!].locked;
  const sewer: Objective = {
    route: 'sewer',
    title: 'SEWER',
    ready: m.finalGrate.open,
    steps: [
      { text: detail(read('drainage') || tunnel, 'Find the way underground', 'Unlock the tunnel gate in the water pump room'), done: tunnel },
      { text: detail(read('drainage') || m.pump.fuse, 'Restore the drainage pump', 'Fit the pump fuse and start the pump'), done: m.pump.running || m.pump.drained },
      { text: 'Wait for the cistern to drain', done: m.pump.drained },
      { text: detail(read('valve_note') || m.manifold.gauge, 'Equalise the line pressure', `Mount the gauge, fit the handle and set the valves to ${w.valveTarget} bar`), done: m.manifold.equalized },
      { text: detail(read('drainage') || m.floodgate.key, 'Unlock the floodgate', 'Insert the floodgate key and raise the gate'), done: m.floodgate.open },
      { text: detail(read('drainage') || m.finalGrate.wheel, 'Open the final drainage exit', 'Fit the access wheel to the outfall grate and turn it'), done: m.finalGrate.open },
    ],
  };
  if (hints === 0) for (const o of [front, garage, sewer]) o.steps = o.steps.map((s) => ({ ...s, text: s.done ? s.text : s.text.replace(/ with .*| \(.*\)/, '') }));
  return [front, garage, sewer];
}
