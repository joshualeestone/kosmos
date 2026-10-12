'use strict';
/**
 * kosmos#5535 E0.6 slice (d): engine/backuptick.js inputsHere, the real sources (profiles, the workers root, the
 * projects file, the config roots), in a sandboxed data root, workers root and projects root. Its own file because
 * store and create read their roots from the environment when first loaded.
 *   node --test engine/backuptick-inputs.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backuptick-in-')));
const mk = (...p) => { const d = path.join(BASE, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mk('claude');
process.env.AGENT_WORKFORCE_GEMINI_HOME = mk('gemini');
process.env.AGENT_WORKFORCE_CODEX_HOME = mk('codex');
const store = require('./store');
const tick = require('./backuptick');

test.after(() => fs.rmSync(BASE, { recursive: true, force: true }));

test('inputsHere reads profiles, workers folders and projects, and every root it yields is one the snapshot accepts', () => {
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(path.join(store.PROFILES, 'ann.json'), JSON.stringify({ displayName: 'Ann' }));
  mk('workers', 'ann');
  mk('workers', 'bob');                          // a folder with no profile is still an agent here
  mk('workers', '.hidden');                      // never an agent
  const far = mk('far', 'beta');
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), JSON.stringify([{ id: 'beta', folder: far }, { id: 'alpha', folder: mk('projects', 'alpha') }]));
  const input = tick.inputsHere();
  assert.equal(fs.realpathSync(input.workersDir), path.join(BASE, 'workers'));
  assert.deepEqual(input.agents.map((a) => a.id).sort(), ['ann', 'bob']);
  assert.deepEqual(input.projects.map((p) => p.slug).sort(), ['alpha', 'beta']);
  // Review 1: the data root and every provider config home are protected.
  for (const d of [store.ROOT, process.env.AGENT_WORKFORCE_CONFIG_ROOT, process.env.AGENT_WORKFORCE_GEMINI_HOME, process.env.AGENT_WORKFORCE_CODEX_HOME]) assert.ok(input.protect.includes(d), d);
  const { roots } = tick.rootsFor(input);
  assert.deepEqual(roots.map((r) => r.name), ['workers', 'projects', 'elsewhere/beta']);
  const snap = require('./backupsnapshot');
  for (const r of roots) assert.equal(snap.rootNameProblem(r.name), null, r.name);
});

test('inputsHere never throws on a projects file it cannot read; the workers root still comes back', () => {
  fs.writeFileSync(path.join(store.ROOT, 'projects.json'), 'not json');
  const input = tick.inputsHere();
  assert.deepEqual(input.projects, []);
  assert.deepEqual(tick.rootsFor(input).roots[0].name, 'workers');
});
