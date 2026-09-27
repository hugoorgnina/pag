# pag — Orb Runner

A small third-person 3D browser game built with [three.js](https://threejs.org) and Vite.
Recover 12 glowing orbs scattered across a procedurally generated island while
avoiding sentinel drones that hunt by line of sight.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (relative paths, host anywhere)
npm test         # physics / LOD / math unit tests (node --test)
```

## Controls

| Input | Action |
|-------|--------|
| `W A S D` / arrows | Move (camera-relative) |
| Mouse (click to lock) or drag | Orbit camera · wheel zooms |
| `Shift` | Sprint (FOV widens with speed) |
| `Space` | Jump (coyote time + input buffering) |
| `Q` | Toggle High / Low quality |
| `F3` or `` ` `` | Stats overlay: FPS, draw calls, triangles, LOD buckets |
| `H` | Show the simple collision shapes behind the visuals |
| `M` / `P` | Mute / pause |

Touch devices get a virtual stick, a look pad and jump/run buttons.
Force a preset with `?quality=low` or `?quality=high`.

## How the 3D principles map to code

| Principle | Where |
|-----------|-------|
| **Frustum culling + LOD + batching** in one pass: every tree LOD level is a single `InstancedMesh`; instances are frustum-tested on the CPU each frame, bucketed by distance (near ≈100 tris → mid ≈⅓ → far crossed-quad billboard), and anything past the last threshold is dropped under fog | `src/render/instancedLOD.js`, `src/world/trees.js` |
| **Batching** for all repeated props: ruins, crates, rocks and orbs each render in one draw call (~25 draw calls for the whole scene) | `src/world/level.js`, `src/entities/orbs.js` |
| **Custom shaders** where they earn their keep: Gerstner-style water with depth tint and shore foam from a terrain height texture, toon shading for characters, fresnel orb glow, gradient sky | `src/render/shaders/` |
| **Simple colliders, complex visuals**: boxes for ruins/crates/tree trunks, spheres for faceted rocks, a capsule for the player, a heightfield instead of a mesh collider for terrain | `src/physics/physics.js`, `src/world/terrain.js` |
| **Layer-based filtering**: `STATIC`, `TREE`, … bitmasks decide what the camera, characters and vision rays collide with | `Layers` in `src/physics/physics.js` |
| **Raycasting for line of sight**: rays walk the spatial hash with a 2D DDA, then march the heightfield; sentinels only chase what they can actually see | `PhysicsWorld.raycast`, `src/entities/sentinel.js` |
| **Third-person camera feel**: frame-rate independent damping, look-ahead, spring-arm collision (snap in, ease out), speed-based FOV, trauma shake | `src/camera/thirdPersonCamera.js` |
| **Lighting**: directional sun + hemisphere ambient, flickering point lights on braziers, one point light that follows the nearest orb, sentinel spot lights as readable vision cones | `src/game.js`, `src/world/level.js`, `src/entities/sentinel.js` |
| **Shadow budget**: a single tight shadow frustum follows the player (a one-cascade setup) and is snapped to shadow-map texels to stop shimmering; **Low** quality disables real-time shadows and switches to blob shadows, drops spot lights, pixel ratio and LOD distances | `Game._updateSun`, `Game._createBlobShadows`, `QUALITY` |

## Project layout

```
src/
  main.js, game.js          bootstrap, loop (fixed 60 Hz simulation), HUD, quality
  core/                     math & noise, input, WebAudio sound effects
  physics/physics.js        spatial hash, capsule resolution, raycasts
  camera/                   third-person spring-arm camera
  world/                    heightfield terrain, level layout, forest LOD
  entities/                 player controller, sentinel AI, orbs & particles
  render/                   instanced LOD system and GLSL shaders
tests/                      node:test unit tests
```
