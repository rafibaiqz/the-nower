# THE NOWER

**A cooperative 3D multiplayer survival horror game — created by Raff & Noer.**

*Escape before he finds you.*

Up to four players wake inside an enormous abandoned mansion. Its owner, the Nower, is still in the house, and he hunts mostly by ear. Search five floors (sewer, basement, ground, upper floor, attic) for keys, tools and parts, solve interconnected puzzles, and escape through one of three routes: the main entrance, the repaired car in the garage, or the sewers.

Everything runs in a desktop web browser. A Node.js server is authoritative for the whole match: lobbies, items, doors, puzzles, the enemy AI, captures and escapes.

---

## Quick start

Requirements: **Node.js 20+** (22 recommended) and npm.

```bash
npm install          # .npmrc sets legacy-peer-deps (works around an npm peer-dependency bug)
npm run dev          # game server on :3001 (watch mode) + Vite client on :5173
```

Open http://localhost:5173 in two browser windows, **CREATE LOBBY** in one, then **JOIN LOBBY** with the 5-character code in the other. **PLAY** starts an instant solo match.

Production, as a single service (the server also serves the built client):

```bash
npm run build        # client -> client/dist, server -> server/dist/index.js
STATIC_DIR=client/dist npm start      # open http://localhost:3001
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (tsx watch) and client (Vite) together |
| `npm run dev:server` / `npm run dev:client` | Run either side on its own |
| `npm run build` | Production build of client and server |
| `npm start` | Start the built server (`server/dist/index.js`) |
| `npm run typecheck` | TypeScript checks for `shared`, `server` and `client` |
| `npm test` | Unit and integration tests (Vitest): level, placement, sound, AI, routes, live Socket.IO multiplayer |
| `npm run e2e` | Two-player browser test in real Chrome against the production build (run `npm run build` first) |
| `npm run photos` | Visual tour: screenshots of key areas into `test-results/tour/` |
| `npm run map [floor]` | Prints ASCII maps of the estate (0 sewer … 4 attic) |
| `npm run test:all` | typecheck, unit tests, build, e2e |

`npm run e2e` opens Chrome in an off-screen window so WebGL uses the GPU. Pass `--software` for headless SwiftShader (CI-friendly, but only a few frames per second), or `--url=https://your-deployment` to test a running deployment.

## Environment variables

See [`.env.example`](.env.example).

| Variable | Side | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `3001` | HTTP and WebSocket port |
| `HOST` | server | `0.0.0.0` | Bind address |
| `CLIENT_ORIGIN` | server | `*` | Comma-separated allowed browser origins (CORS). Set real origins in production. |
| `MAX_PLAYERS` | server | `4` | Players per lobby (cap 8) |
| `MAX_LOBBIES` | server | `200` | Simultaneous lobbies |
| `LOBBY_IDLE_MINUTES` | server | `30` | Idle waiting rooms close after this |
| `STATIC_DIR` | server | *(empty)* | Serve the built client from this directory (single-service deploy) |
| `LOG_LEVEL` | server | `info` | `debug`, `info`, `warn` or `error` |
| `VITE_SERVER_URL` | client (build time) | same origin; `http://<host>:3001` in dev | Public URL of the game server. Must be `https://` in production so the socket uses `wss://`. |

No secrets are needed. The client never embeds anything beyond the public server URL.

## Deployment

The game needs a **persistent Node.js process** for WebSockets. Static hosts (Netlify, Cloudflare Pages, GitHub Pages) can serve the client but cannot run the game server.

### Option A: one container (recommended)

```bash
docker build -t the-nower .
docker run -p 3001:3001 the-nower        # http://localhost:3001
```

The image builds both packages and runs the server with `STATIC_DIR` set, so the client connects to its own origin and HTTPS gives `wss://` automatically. It has a `/health` check. Deploy the same Dockerfile to any host that runs long-lived containers with WebSocket support (Render web service, Railway, Fly.io, a VPS behind Caddy or nginx). Settings for such a host:

- Port: the platform's `PORT` (the server reads it).
- Health check path: `/health`.
- Run a **single instance**. Matches live in that process's memory, so horizontal scaling would need sticky sessions plus a shared adapter, which isn't implemented.
- Terminate TLS at the platform or your proxy.

### Option B: static client and separate server

1. Deploy the server (Docker image, or `npm ci && npm run build -w server && node server/dist/index.js`) and note its public URL, e.g. `https://nower-server.example.com`.
2. On the server, set `CLIENT_ORIGIN=https://your-client-domain`.
3. Build the client with `VITE_SERVER_URL=https://nower-server.example.com npm run build -w client`, then upload `client/dist/` to the static host (a single-page app; no rewrites needed).

### Verifying an internet deployment

Open the site on two different machines and networks, create a lobby on one, and join with the code on the other. You can also run `npm run e2e -- --url=https://your-deployment`. **Tested so far:** two browser clients on one machine against the production build, both direct and inside the Docker image. Internet play across separate networks hasn't been tested yet because no hosting account was available.

## How to play

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the game to capture the mouse) |
| Shift | Sprint (uses stamina; loud) |
| Ctrl or C | Crouch (nearly silent) |
| E | Interact. Hold E for long actions such as picking a lock, cranking or repairing. |
| G | Drop the carried item |
| F | Use the item: throw a bottle, wind a decoy, fire the flash camera. Starts the engine while driving. |
| L or right mouse | Flashlight |
| I | Inspect the carried item (the cipher plate shows its symbol key) |
| Tab or J | Shared journal and objectives |
| O | Toggle the objective panel |
| Space | Hold your breath while hiding; skip the intro |
| Esc | Pause menu (settings, how to play, leave) |

- **Sound is everything.** Crouching is nearly silent, walking is heard nearby, sprinting carries. Creaking boards, slammed doors, dropped tools, machines and the car engine are loud. Walls and closed doors muffle sound.
- **Hiding.** Wardrobes, cupboards, beds and sewer niches hide you. If he saw you go in, he will search that spot. Hold your breath if you've been running.
- **Caught.** You wake in the basement cage. Teammates can force it open. On Easy, Normal and Hard you can work the latch loose yourself after a delay; on Extreme you can't. Each difficulty allows a limited number of captures.

### The three escape routes

| Route | What it takes |
| --- | --- |
| **Main entrance** | Old key lock (Rusted Entrance Key); chained padlock (Brass Lock Pick); electric bolt (Ceramic Fuse Module in the basement fuse board, then a keypad code decoded with the Engraved Cipher Plate); iron bar (fit the Mechanical Gear Handle to the winch and crank it). Then open the door and run out of the front gate. |
| **Garage car** | Garage Access Key to get in. Install the Vehicle Battery, Ignition Coil and Starter Relay under the hood, pour the Fuel Canister, insert the Ignition Key, loosen the shutter bolts (Wrench) and haul the shutter up. Start the engine (very loud) and drive through the chained driveway gate. |
| **Sewer** | Maintenance Key opens the tunnel gate. Fit the Pump Fuse and start the drainage pump; the flooded cistern drains in about 25 s. Mount the Pressure Gauge and fit the Valve Handle, then set the three valves so their stamped pressures add up to the red target. Insert the Floodgate Control Key and raise the gate. Fit the Sewer Access Wheel to the outfall grate, turn it, and climb out. Optional shortcut: force the garden drainage grate with the Hydraulic Spreader. |

Locked rooms (Library, Storage, Clock Room) and secret passages (the library bookcase, servants' quarters panel, boiler room bricks, attic hatch) connect the house. Tools include glass bottles (throw for a distraction), a clockwork decoy, a two-bulb flash camera that stuns him, and flashlight batteries.

## Architecture

```
shared/   TypeScript used by both sides (no runtime dependencies)
  level/layout.ts      the authored estate: 61 rooms on 5 floors, 63 doors, stairs, ladders, mechanisms, notes
  level/build.ts       rasterises the layout into 1 m cell grids; auto-furnishes rooms with path-safety checks;
                       derives hiding spots, containers, item spawns, lights, traps and patrol points
  level/grid.ts        collision (circle vs grid, stairs, step heights), 3D line of sight, ray casts
  level/nav.ts         A* across floors, stairs, ladders and doors (the enemy)
  level/sound.ts       sound propagation field and noise intensities
  progression.ts       area graph, dependency-validated randomised item placement, puzzle generation
  interactions.ts      contextual action rules, shared by client prompts and server validation
  protocol.ts          network messages and replicated state types
server/   Node + Socket.IO (authoritative)
  lobby/LobbyManager   codes, seats, reconnection tokens, host transfer, ready and start rules, cleanup
  match/Match          the simulation: players, items, doors, mechanisms, car, traps, capture/rescue, escapes, end
  match/EnemyAI        the Nower's state machine
  match/Car            car physics and collisions
  server.ts            HTTP (/health, static files) and validated, rate-limited socket handlers
client/   Vite + React (UI) + Three.js (renderer) + Web Audio
  game/Game.ts         frame loop, prediction, interpolation, targeting, camera states, events
  game/world/*         procedural textures, level geometry, furniture, props, sky, rain, light pool
  game/entities/*      enemy rig, teammates, doors, items, mechanisms, car, traps, water, ladders
  game/audio/*         synthesized sounds, mix buses, HRTF positional audio, ambience, dynamic music
  ui/*                 menus, lobby, HUD, modals, endings
```

**Why one shared cell grid instead of a physics engine.** Every system needs the same answers: where a body can stand, whether a wall is in the way, how far sound travels, which path the enemy takes. A single deterministic 1 m grid gives the server and every client identical results without shipping a WASM physics engine, and makes it cheap to validate player movement on the server.

### Multiplayer model

- **The server is authoritative.** Items, containers, doors, mechanisms, puzzle state, traps, the car, the enemy, captures, escapes and the match result change only through server rules. Clients send *intents* (`g:act` with a target reference, `g:drop`, `g:use`, `g:code`, car input) and the server re-runs the same interaction rules, checking distance, line of sight, held item and state.
- **Movement** is predicted on the client and validated on the server (maximum speed for the elapsed time, and a walkable path without crossing walls, closed doors or furniture). Illegal moves are answered with a correction. Footstep noise is derived from *validated* movement, so a client can't stay silent by lying about crouching.
- **Snapshots** are sent at 20 Hz for players, enemy and car; clients interpolate about 110 ms behind. Discrete events (doors, items, mechanisms, sounds, cues, notifications) are batched per tick.
- **Concurrency.** A single-threaded tick means two players grabbing the same unique item can't both get it (covered by tests).
- **Reconnection.** Each seat has a secret 48-hex-character token (kept in `sessionStorage`), so a refresh or network drop resumes the same identity without duplicates. A disconnecting player's carried item is dropped at a reachable spot immediately, and they leave hiding spots and the car. After a 90 s grace period they are removed from the match.
- **Lobbies.** Codes are 5 characters from a 32-character alphabet with no 0/O/1/I. Joins are rejected when the code is unknown or malformed, the lobby is full, or the game has started. The host role transfers on leave. Only the host changes settings or starts; changing settings un-readies everyone. Idle and empty lobbies are swept.
- **Hardening.** Every payload is validated, and per-socket token buckets rate-limit each message type.

### The Nower (AI)

A finite state machine: `DORMANT → PATROL ⇄ INVESTIGATE_SOUND / INVESTIGATE_VISUAL → SEARCH_AREA → SEARCH_HIDING_SPOT`, plus `CHASE → ATTACK_OR_CAPTURE`, `TEMPORARILY_DISABLED` and `RETURN_TO_PATROL`.

- **Hearing.** Each noise event has an intensity (its audible range in effective metres). A bounded Dijkstra flood from his position costs 1 per metre of open space, more for closed doors, much more for walls and floor slabs, and less in echoing sewers. He hears a sound when intensity × hearing multiplier exceeds that effective distance, then walks to an estimated position whose error grows as the sound gets fainter.
- **Vision.** Field of view, range scaled by room lighting, crouching and flashlight use, and a true 3D line of sight through the grid (including the open hall and stairwells). Sightings fill a per-player awareness meter; a full meter starts a chase. When he loses sight he heads for the last known position plus the target's heading, then searches the area.
- **Hiding.** If he watches a player enter a hiding spot, he opens it. Otherwise he checks nearby spots only with a difficulty-dependent probability, or when he hears breathing.
- **Movement.** A* paths through the house; he opens doors with a delay and a creak, and re-locks locked doors behind him. He uses ladders and never teleports. Patrols are weighted toward recent noise, escape mechanisms in progress, and the cage when someone is held there. Stuck detection re-paths or abandons the goal.

### Randomisation and solvability

Each match gets a server seed. Items go only on valid spawn points (surfaces, drawers, cupboards, floor spots) of the right size category and zone. Placement is validated by simulating a team that starts in the bedroom and collects everything it can reach through doors, the flooded cistern, ladders, one-way bolts and mechanism gates. Every layout must keep **all three routes** completable, and each locked room must hold something worth unlocking. 300 seeds are tested without a fallback. The keypad code, cipher mapping, valve pressures and target are seeded per match too.

### Difficulty

Easy, Normal, Hard and Extreme change real values in `shared/src/difficulty.ts`: enemy speeds, hearing multiplier, vision range and FOV, detection rate, search time, how often he checks hiding spots, chase persistence, trap count, hint level, captures allowed, self-release delay (none on Extreme), opening grace period, interaction noise, and how strongly he's drawn to escape mechanisms. Long actions also take longer on Hard and Extreme.

## Testing

`npm test` runs 48 tests:

- **Level:** deterministic build, required rooms, doors joining two rooms, every room reachable, collision against walls, stairs between floors, line of sight.
- **Placement:** 300 seeds fully solvable, no duplicate spawns, categories and zones respected, determinism, unsolvable layouts detected, every critical item has a purpose, puzzle consistency.
- **Sound:** crouch < walk < sprint, wall and door attenuation, dropped tools heard next door but not across the house, floor slabs.
- **Routes:** full playthroughs of the main entrance (including the wrong-code alarm), the garage car (including the shutter blocking the car and a two-player drive-out) and the sewer (including path blocking before and after each gate, and the optional grate). Also item and door rules: contested pickups, range and walls, drop safety, disconnect with an item, keys, the one-way bookcase.
- **AI:** patrols, investigates a dropped tool (and opens doors on the way) while ignoring crouch noise, sight starts a chase, walls block sight, lost sight leads to a local search, unseen hiding is safe, seen hiding gets searched and captured, cage capture and teammate rescue, self-release on Easy, game over on Extreme, flash stun, and a three-minute noisy soak with no NaNs or stuck states.
- **Multiplayer (real Socket.IO):** create/join, invalid, unknown and full lobbies, host transfer and closing, ready-gated start, identical seeds and item layouts, late-join refusal, movement sync, teleport-hack correction, contested pickup, door sync, disconnect drops the item, token reconnect without duplicates, bogus token refused, health check.

`npm run e2e` drives two real Chrome windows through the UI: create and join, ready and start, world load, walking, cross-client sync, the door interaction, audio running, enemy consistency, journal and pause menus, and no page errors. It was also run against the Docker image.

## Features implemented

- Main menu (Play, Create Lobby, Join Lobby, How to Play, Settings, Credits), atmospheric backdrop and menu ambience; a click-to-enter splash that unlocks browser audio.
- Lobby: shareable code with copy button, live player list (host, ready, connection), difficulty and max-player settings, start rules with a reason when blocked, leave, host transfer.
- First-person controller: sprint stamina, crouch, gentle optional head bob, surface-aware footsteps, slipping, weak attic boards, heavy items slowing you.
- An estate of 61 rooms on 5 floors (mansion, basement, attic, garage, shed, gardens, front yard, driveway, sewers), 373 procedurally placed furniture pieces, 46 hiding spots, 47 openable containers, secret passages, windows, a double-height hall with a gallery, six staircases and two ladders.
- 33 item instances (22 unique critical items plus 11 tools and batteries, all randomised): one item in the hand, swap on pickup, drop with material-based noise, inspect, first-person held model.
- Three complete escape routes with in-engine ending sequences, plus an opening sequence that can be skipped.
- Server-side Nower AI with hearing, vision, search, door handling, hiding-spot searches, capture, stuns and car collisions.
- Capture, cage, rescue and self-release; snare, tin-can and bell traps that teammates can free you from; bottle, decoy and flash-camera tools; flashlight batteries.
- Synthesized audio: surface-specific footsteps, doors, drawers, impacts, machines, the car, alarms, traps; the Nower's heavy dragging steps, wheezing, growls, muttering, screams and groans; HRTF positional audio with wall occlusion; zone-based ambience and reverb; random phantom sounds; layered dynamic music (drone, investigation, chase, hiding, escape, victory and defeat stingers); volume sliders per bus plus mute.
- Lighting: flashlight with shadows (Medium and High), a light pool for about 100 fixtures with flicker and power dips, a generator that powers the basement, moonlight, fog by zone, rain, post-processing (grain, vignette, danger aberration, capture pulse).
- HUD: reticle, prompts, hold ring, carried item, stamina and battery meters, teammate status, objective panel, "he heard that" and "he sees someone" cues, cage timer, breath meter, room name, optional FPS. Also a journal, pause menu, keypad, note reader, ending screens with credits, connection error screen and reconnection banner.
- Settings: audio volumes and mute, graphics quality (Low, Medium, High), brightness, FOV, mouse sensitivity, invert Y, head bob, FPS counter.

## Known limitations and temporary assets

- **All assets are procedural and original:** models built from primitives, canvas-generated textures, and audio synthesized at runtime. Nothing is borrowed or licensed, and no asset file can go missing. They are working *temporary production assets*. Hand-authored rigged models (especially the Nower), PBR texture sets and recorded or composed audio would raise the quality a lot. The Nower is a joint hierarchy animated procedurally, not a skinned mesh.
- Player movement is client-predicted with server validation (speed and walls), not a full server-side movement simulation. Interactions have no lag compensation.
- One server process holds all matches in memory; there's no persistence or horizontal scaling.
- Desktop keyboard and mouse only; mobile controls aren't implemented, though input is isolated in `client/src/game/player/Controller.ts`.
- Internet play across separate networks hasn't been tested (see Deployment).
- Under software WebGL (for example headless CI) the game runs at a few frames per second. On a GPU (tested on an Apple Silicon Mac in Chrome) a frame renders in about 4 ms at about 380 draw calls.

## Suggested next steps

1. Replace the Nower and the teammates with rigged, skinned models and authored animations.
2. Add recorded or composed sound effects and music (the `play()` recipes in `client/src/game/audio/sounds.ts` are the swap points).
3. Deploy the container and run `npm run e2e -- --url=…` from two networks.
4. Server-side movement reconciliation and lag-compensated interactions.
5. Mobile and touch controls.

---

**THE NOWER** — created by **Raff & Noer**.
