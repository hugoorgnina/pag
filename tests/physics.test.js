import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Layers, PhysicsWorld, rayBox } from '../src/physics/physics.js';
import { Terrain } from '../src/world/terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flatGround = { waterLevel: -10, heightAt: () => 0, normalAt: (x, z, t = V()) => t.set(0, 1, 0) };

test('capsule is pushed out of a box wall horizontally', () => {
  const world = new PhysicsWorld(flatGround);
  world.addBox(V(0, 0, -5), V(2, 3, 5));
  const pos = V(-0.2, 0, 0); // radius 0.4 → overlapping by 0.2
  const res = world.resolveCapsule(pos, 0.4, 1.6);
  assert.ok(Math.abs(pos.x - -0.4) < 1e-6, `x=${pos.x}`);
  assert.equal(pos.y, 0);
  assert.equal(res.onTerrain, true);
});

test('capsule lands on top of a box and is grounded', () => {
  const world = new PhysicsWorld(flatGround);
  world.addBox(V(-1, 0, -1), V(1, 1.2, 1));
  const pos = V(0, 1.1, 0); // feet slightly sunk into the top
  const res = world.resolveCapsule(pos, 0.4, 1.6);
  assert.ok(Math.abs(pos.y - 1.2) < 1e-6, `y=${pos.y}`);
  assert.equal(res.grounded, true);
  assert.equal(res.onTerrain, false);
});

test('capsule slides around a sphere collider', () => {
  const world = new PhysicsWorld(flatGround);
  world.addSphere(V(0, 0.5, 0), 1);
  const pos = V(1.2, 0, 0);
  world.resolveCapsule(pos, 0.4, 1.6);
  assert.ok(Math.hypot(pos.x, pos.z) >= 1.4 - 1e-6, `pushed to ${pos.x}`);
  assert.equal(pos.y, 0);
});

test('layer masks filter queries', () => {
  const world = new PhysicsWorld(null);
  world.addBox(V(-1, 0, -1), V(1, 2, 1), { layer: Layers.TREE });
  assert.equal(world.queryArea(-2, -2, 2, 2, Layers.STATIC).length, 0);
  assert.equal(world.queryArea(-2, -2, 2, 2, Layers.TREE).length, 1);
  const pos = V(0.5, 0, 0);
  world.resolveCapsule(pos, 0.4, 1.6, Layers.STATIC);
  assert.equal(pos.x, 0.5, 'masked-out collider must not push');
});

test('raycast finds the nearest collider across hash cells', () => {
  const world = new PhysicsWorld(null, { cellSize: 4 });
  world.addBox(V(20, 0, -1), V(22, 2, 1));
  world.addBox(V(10, 0, -1), V(12, 2, 1));
  world.addSphere(V(30, 1, 0), 1);
  const hit = world.raycast(V(0, 1, 0), V(1, 0, 0), 100, Layers.ALL);
  assert.ok(hit);
  assert.ok(Math.abs(hit.distance - 10) < 1e-6);
  assert.deepEqual(hit.normal.toArray(), [-1, 0, 0]);
  const miss = world.raycast(V(0, 5, 0), V(1, 0, 0), 100, Layers.ALL);
  assert.equal(miss, null);
  const short = world.raycast(V(0, 1, 0), V(1, 0, 0), 5, Layers.ALL);
  assert.equal(short, null);
});

test('rayBox ignores boxes containing the origin', () => {
  assert.equal(rayBox(V(0, 0, 0), V(1, 0, 0), V(-1, -1, -1), V(1, 1, 1)), null);
});

test('lineOfSight is blocked by geometry', () => {
  const world = new PhysicsWorld(null);
  world.addBox(V(4, 0, -1), V(5, 3, 1));
  assert.equal(world.lineOfSight(V(0, 1, 0), V(10, 1, 0)), false);
  assert.equal(world.lineOfSight(V(0, 4, 0), V(10, 4, 0)), true);
});

test('terrain heightAt matches grid vertices and raycast hits the ground', () => {
  const terrain = new Terrain({ size: 64, segments: 32, seed: 5 });
  for (const [ix, iz] of [[3, 4], [10, 20], [31, 31]]) {
    const x = -terrain.half + ix * terrain.cell;
    const z = -terrain.half + iz * terrain.cell;
    assert.ok(Math.abs(terrain.heightAt(x, z) - terrain.gridHeight(ix, iz)) < 1e-4);
  }
  const world = new PhysicsWorld(terrain);
  const hit = world.raycast(V(0, 50, 0), V(0, -1, 0), 200);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.y - terrain.heightAt(0, 0)) < 0.01);
});
