/** Prints ASCII maps of every floor: `npm run map [floor]`. */
import { CT, F, FLOOR_NAMES, getLevel } from '../shared/src/index';

const level = getLevel();
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : -1;
for (const g of level.floors) {
  if (only >= 0 && g.index !== only) continue;
  console.log(`\n=== Floor ${g.index}: ${FLOOR_NAMES[g.index]} (base ${g.base}) ===`);
  let header = '    ';
  for (let x = 0; x < level.W; x++) header += x % 10 === 0 ? String((x / 10) % 10) : ' ';
  console.log(header);
  for (let z = 0; z < level.D; z++) {
    let row = String(z).padStart(3, ' ') + ' ';
    for (let x = 0; x < level.W; x++) {
      const k = z * level.W + x;
      const t = g.type[k];
      const fl = g.flags[k];
      let c = '?';
      if (t === CT.SOLID) c = fl & F.WINDOW ? 'w' : '#';
      else if (t === CT.VOID) c = ' ';
      else if (t === CT.DOOR) c = 'D';
      else if (t === CT.STAIR) c = 'S';
      else if (t === CT.RAIL) c = '|';
      else if (t === CT.WATER) c = '~';
      else if (fl & F.FURN) c = 'f';
      else if (t === CT.OUTDOOR) c = ',';
      else c = fl & F.SHALLOW ? '=' : '.';
      row += c;
    }
    console.log(row);
  }
}
console.log(`\nrooms ${level.rooms.length} doors ${level.doors.length} furniture ${level.furniture.length} hides ${level.hides.length} containers ${level.containers.length} spawns ${level.spawns.length} lights ${level.lights.length} notes ${level.notes.length} traps ${level.trapCandidates.length} patrol ${level.patrolPoints.length}`);
