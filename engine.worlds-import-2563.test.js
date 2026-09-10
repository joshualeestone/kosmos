'use strict';
/*
 * #2563 (add-agents-from-an-existing-Kosmos, engine slice): agentCount + importAgents.
 * Verifies the read (per-world profile count) and the copy (profiles carried into a new
 * world, sources UNCHANGED, first-wins on collision, unknown sources skipped-not-fatal).
 *
 *   node --test engine.worlds-import-2563.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const worlds = require('./engine/worlds');

function sandbox() { return fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-import-2563-')); }

// Seed a profile JSON into a world's profiles dir (what createAgent's store write lands).
function seedAgent(base, world, name, body) {
  const dir = worlds.worldProfilesDir(base, world);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(body || { name }));
}
function profileBytes(base, world, name) {
  return fs.readFileSync(path.join(worlds.worldProfilesDir(base, world), name + '.json'), 'utf8');
}
function profileExists(base, world, name) {
  return fs.existsSync(path.join(worlds.worldProfilesDir(base, world), name + '.json'));
}

test('#2563 agentCount: 0 for a world with no profiles, N after seeding, and a .tmp is not counted', () => {
  const base = sandbox();
  const a = worlds.createWorld(base, 'Acme');
  assert.equal(worlds.agentCount(base, a), 0, 'a fresh world holds no agents (no profiles dir yet)');
  seedAgent(base, a, 'alice', { name: 'alice', role: 'analyst' });
  seedAgent(base, a, 'bob', { name: 'bob' });
  assert.equal(worlds.agentCount(base, a), 2, 'two profiles -> two agents');
  // control: a mid-write temp file must NOT inflate the count (it ends in .tmp, not .json)
  fs.writeFileSync(path.join(worlds.worldProfilesDir(base, a), 'carol.json.tmp'), '{}');
  assert.equal(worlds.agentCount(base, a), 2, 'a <name>.json.tmp is not a real profile and is not counted');
  // the DEFAULT world counts from base/profiles (its store root is base)
  seedAgent(base, worlds.defaultWorld(), 'dave', { name: 'dave' });
  assert.equal(worlds.agentCount(base, worlds.defaultWorld()), 1, 'the default world counts its own profiles');
});

test('#2563 import copies profiles into the target and leaves the SOURCE untouched (copy-not-move)', () => {
  const base = sandbox();
  const src = worlds.createWorld(base, 'Source');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, src, 'alice', { name: 'alice', role: 'analyst', reportsTo: 'you' });
  seedAgent(base, src, 'bob', { name: 'bob', role: 'writer' });
  const before = { alice: profileBytes(base, src, 'alice'), bob: profileBytes(base, src, 'bob') };

  const r = worlds.importAgents(base, dst, [src.id]);
  assert.deepEqual(r, { copied: 2, skipped: 0, unknownSources: 0 });

  // target now holds both, byte-identical
  assert.equal(worlds.agentCount(base, dst), 2, 'both agents landed in the new world');
  assert.equal(profileBytes(base, dst, 'alice'), before.alice, 'alice copied verbatim');
  assert.equal(profileBytes(base, dst, 'bob'), before.bob, 'bob copied verbatim');
  // CONTROL: the source is UNCHANGED -- copy, never move
  assert.ok(profileExists(base, src, 'alice') && profileExists(base, src, 'bob'), 'source keeps its agents');
  assert.equal(profileBytes(base, src, 'alice'), before.alice, 'source alice byte-for-byte unchanged');
  assert.equal(profileBytes(base, src, 'bob'), before.bob, 'source bob byte-for-byte unchanged');
});

test('#2563 collision is FIRST-WINS: an earlier source and a pre-existing target agent are not overwritten', () => {
  const base = sandbox();
  const s1 = worlds.createWorld(base, 'S1');
  const s2 = worlds.createWorld(base, 'S2');
  const dst = worlds.createWorld(base, 'D');
  seedAgent(base, s1, 'alice', { name: 'alice', from: 'S1' });
  seedAgent(base, s2, 'alice', { name: 'alice', from: 'S2' });
  seedAgent(base, s2, 'bob', { name: 'bob', from: 'S2' });

  // s1 listed first, so its alice wins; s2's alice is skipped; s2's bob is new.
  const r = worlds.importAgents(base, dst, [s1.id, s2.id]);
  assert.deepEqual(r, { copied: 2, skipped: 1, unknownSources: 0 });
  assert.equal(JSON.parse(profileBytes(base, dst, 'alice')).from, 'S1',
    'first source wins the collision -- s2 did NOT overwrite it');
  assert.equal(JSON.parse(profileBytes(base, dst, 'bob')).from, 'S2', 'the non-colliding agent copied');

  // and a name ALREADY in the target is left untouched
  const dst2 = worlds.createWorld(base, 'D2');
  seedAgent(base, dst2, 'alice', { name: 'alice', from: 'D2-original' });
  const r2 = worlds.importAgents(base, dst2, [s1.id]);
  assert.deepEqual(r2, { copied: 0, skipped: 1, unknownSources: 0 });
  assert.equal(JSON.parse(profileBytes(base, dst2, 'alice')).from, 'D2-original',
    'a pre-existing target agent is not clobbered by an import');
});

test('#2563 an unknown or traversing source id is skipped, not fatal', () => {
  const base = sandbox();
  const dst = worlds.createWorld(base, 'D');
  const real = worlds.createWorld(base, 'Real');
  seedAgent(base, real, 'alice', { name: 'alice' });
  // two bad ids (nonexistent + a traversal attempt) plus one real
  const r = worlds.importAgents(base, dst, ['no-such-world', '../../evil', real.id]);
  assert.equal(r.unknownSources, 2, 'both bad ids counted as unknown');
  assert.equal(r.copied, 1, 'the one real source still imported');
  assert.equal(worlds.agentCount(base, dst), 1);
});

test('#2563 empty or absent importAgentsFrom copies nothing (backward compatible create)', () => {
  const base = sandbox();
  const src = worlds.createWorld(base, 'Source');
  const dst = worlds.createWorld(base, 'Dest');
  seedAgent(base, src, 'alice', { name: 'alice' });
  assert.deepEqual(worlds.importAgents(base, dst, []), { copied: 0, skipped: 0, unknownSources: 0 });
  assert.deepEqual(worlds.importAgents(base, dst, undefined), { copied: 0, skipped: 0, unknownSources: 0 });
  assert.equal(worlds.agentCount(base, dst), 0, 'nothing was copied');
});
