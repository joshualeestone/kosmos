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
const taskchat = require('../engine/taskchat');

function fresh(name) {
  const p = projects.create({ name });
  const t = tasks.create(p.id, { sentence: 'a held task', made: { via: 'screen' } }, []);
  return { id: p.id, n: t.number };
}

test('kosmos#8271: a hold records when it was last confirmed, a repeat moves it, taking it off clears it', async () => {
  const { id, n } = fresh('confirmed');
  const first = tasks.setOnHold(id, n, true, { because: 'waiting' });
  assert.ok(Number.isFinite(Date.parse(first.onHoldConfirmedAt)), 'premise: recorded on a new hold');
  await new Promise((r) => setTimeout(r, 5));
  const again = tasks.setOnHold(id, n, true);
  assert.ok(Date.parse(again.onHoldConfirmedAt) > Date.parse(first.onHoldConfirmedAt), 'a repeat is a fresh confirmation');
  assert.equal('onHoldConfirmedAt' in tasks.setOnHold(id, n, false), false, 'gone with the hold');
  const m = fresh('confirmed-mark');
  const before = tasks.setOnHold(m.id, m.n, true, { forPerson: true }).onHoldConfirmedAt;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(tasks.setOnHold(m.id, m.n, true, { forPerson: false }).onHoldConfirmedAt, before, 'only moving the mark confirms nothing');
  const a = fresh('confirmed-agent-on-person');
  const pers = tasks.setOnHold(a.id, a.n, true, { viaScreen: true }).onHoldConfirmedAt;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(tasks.setOnHold(a.id, a.n, true).onHoldConfirmedAt, pers, "an agent's repeat of the person's hold confirms nothing");
  assert.ok(Date.parse(tasks.setOnHold(a.id, a.n, true, { viaScreen: true }).onHoldConfirmedAt) > Date.parse(pers), 'CONTROL: the person repeating it does');
  const r = fresh('confirmed-reason-with-mark');
  const r0 = tasks.setOnHold(r.id, r.n, true, { because: 'one' }).onHoldConfirmedAt;
  await new Promise((res) => setTimeout(res, 5));
  assert.ok(Date.parse(tasks.setOnHold(r.id, r.n, true, { because: 'two', forPerson: true }).onHoldConfirmedAt) > Date.parse(r0), 'a mark moved along with a new reason is a confirmation');
  const c = fresh('confirmed-closed');
  assert.ok(tasks.setOnHold(c.id, c.n, true).onHoldConfirmedAt, 'premise: held');
  tasks.close(c.id, c.n);
  const closed = (projects.get(c.id).tasks || []).find((x) => x.number === c.n);
  assert.equal('onHoldConfirmedAt' in closed, false, 'closing a held task drops it with the other hold fields');
});

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

test('a changed reason alone records no new hold, so the stale-hold clock is not restarted', () => {
  const { id, n } = fresh('hb seven');
  tasks.setOnHold(id, n, true, { because: 'first' });
  const count = () => taskchat.read(id, n).filter((e) => e.kind === 'hold-set').length;
  const before = count();
  assert.equal(tasks.setOnHold(id, n, true, { because: 'second' }).onHoldBecause, 'second');
  assert.equal(before, 1);
  assert.equal(count(), before);
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
  assert.match(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), /tasks\.setOnHold\(id, taskHold\[2\], body\.onHold, \{[^}]*because: body\.because[,\s][^}]*\}/);
  assert.match(fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8'), /Why: ' \+ esc\(t\.onHoldBecause\)/);
});
