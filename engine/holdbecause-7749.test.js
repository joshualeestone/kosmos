'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#7749: a hold can carry why, in the holder's words.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdbecause-7749.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');

function fresh(name) {
  const p = projects.create({ name });
  const t = tasks.create(p.id, { sentence: 'a held task', made: { via: 'screen' } }, []);
  return { id: p.id, n: t.number };
}

test('a hold keeps its reason, tidied to one line', () => {
  const { id, n } = fresh('hb one');
  const t = tasks.setOnHold(id, n, true, { because: '  waiting on\n the lawyer ' });
  assert.equal(t.onHold, true);
  assert.equal(t.onHoldBecause, 'waiting on the lawyer');
});

test('control: a hold with no reason carries none, as before', () => {
  const { id, n } = fresh('hb two');
  assert.equal('onHoldBecause' in tasks.setOnHold(id, n, true), false);
});

test('holding again with no reason keeps it, a blank clears it', () => {
  const { id, n } = fresh('hb three');
  tasks.setOnHold(id, n, true, { because: 'parked until spring' });
  assert.equal(tasks.setOnHold(id, n, true).onHoldBecause, 'parked until spring');
  assert.equal('onHoldBecause' in tasks.setOnHold(id, n, true, { because: '' }), false);
});

test('taking it off drops the reason, and the next hold starts without it', () => {
  const { id, n } = fresh('hb four');
  tasks.setOnHold(id, n, true, { because: 'old reason' });
  assert.equal('onHoldBecause' in tasks.setOnHold(id, n, false), false);
  assert.equal('onHoldBecause' in tasks.setOnHold(id, n, true), false);
});

test("an agent cannot reword the person's hold; the person can", () => {
  const { id, n } = fresh('hb five');
  tasks.setOnHold(id, n, true, { viaScreen: true, because: 'mine' });
  assert.throws(() => tasks.setOnHold(id, n, true, { because: 'not mine' }), (e) => e.status === 403);
  assert.equal(tasks.setOnHold(id, n, true).onHoldBecause, 'mine');
  assert.equal(tasks.setOnHold(id, n, true, { viaScreen: true, because: 'still mine' }).onHoldBecause, 'still mine');
});

test('a reason that is too long, not words, or sent with taking off is refused and changes nothing', () => {
  const { id, n } = fresh('hb six');
  assert.throws(() => tasks.setOnHold(id, n, true, { because: 'x'.repeat(201) }), (e) => e.status === 400);
  assert.throws(() => tasks.setOnHold(id, n, true, { because: 7 }), (e) => e.status === 400);
  assert.throws(() => tasks.setOnHold(id, n, false, { because: 'why' }), (e) => e.status === 400);
  assert.equal('onHold' in tasks.byNumber(projects.get(id), n), false);
});

test('the wiring: the route passes it, the page shows it escaped', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), /tasks\.setOnHold\(id, taskHold\[2\], body\.onHold, \{[^}]*because: body\.because \}/);
  assert.match(fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8'), /Why: ' \+ esc\(t\.onHoldBecause\)/);
});
