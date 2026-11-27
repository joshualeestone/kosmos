'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9187: the re-read detector (projects.js rulesChangedIn, through holdsOf) read only the plain hold mark
 * "[on hold: ...]". blockBody's held() also prints "[on hold until <what it waits for>: ...]" (#7180) and
 * "[on hold, waiting on your person: ...]" (#7788), so setting or lifting either on a task an agent holds owed it no
 * re-read of its projects section, and it kept working from the copy it read at its start. Drives the real
 * syncAgent and the real re-read debt (engine/instructionreread.js), as server.reread-e2e-8989.test.js does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holdsof-9187-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const projects = require('./projects');
const tasks = require('./tasks');
const ir = require('./instructionreread');
const fleet = require('../test-support/fleet');
let board;
test.before(() => { board = fleet.install([fleet.agent('otto', { state: 'idle' })]); });
test.after(() => { board.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
function setup() {
  const label = 'H' + (++seq);
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'otto');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(file, '# otto\n\nYou work here.\n');
  const folder = path.join(SANDBOX, 'work', label);
  fs.mkdirSync(folder, { recursive: true });
  const p = projects.create({ name: label, folder, agents: ['otto'] });
  const k = tasks.create(p.id, { sentence: 'draft the letter', made: { via: 'screen', by: null } });
  const other = tasks.create(p.id, { sentence: 'file the lease', made: { via: 'screen', by: null } });
  assert.equal(tasks.assignPart(p.id, k.number, 1, 'otto', { via: 'screen' }).ok, true);
  projects.syncAgent('otto', board.roster);
  return { p, k, other, file };
}
const clear = () => { try { fs.rmSync(ir.file()); } catch { /* none owed */ } };
const owed = () => (ir.readOwed().otto || {}).sections;
const lineOf = (file, k, p) => fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('  - task ' + k.number + ' of ' + p.name + ': ')) || '';

const FORMS = [
  ['a plain hold (CONTROL: read before this card)', () => ({}), /\[on hold: do not start it/],
  ['a hold that waits for another task (#7180)', (s) => ({ until: { task: s.other.number } }), /\[on hold until task #?\d+ is closed: /],
  ['a hold waiting on the person (#7788)', () => ({ forPerson: true }), /\[on hold, waiting on your person: /],
];

for (const [name, opts, shape] of FORMS) {
  test('setting and lifting ' + name + ' owes the holder a re-read', () => {
    const s = setup();
    clear();
    assert.notEqual(tasks.setOnHold(s.p.id, s.k.number, true, opts(s)).ok, false, 'fixture: the hold was set');
    projects.syncAgent('otto', board.roster);
    assert.match(lineOf(s.file, s.k, s.p), shape, 'fixture: the section shows this form: ' + lineOf(s.file, s.k, s.p));
    assert.deepEqual(owed(), ['projects'], 'setting ' + name + ' owed no re-read');
    clear();
    assert.notEqual(tasks.setOnHold(s.p.id, s.k.number, false).ok, false, 'fixture: the hold was lifted');
    projects.syncAgent('otto', board.roster);
    assert.doesNotMatch(lineOf(s.file, s.k, s.p), /\[on hold/, 'fixture: the hold left the section');
    assert.deepEqual(owed(), ['projects'], 'lifting ' + name + ' owed no re-read');
  });
}

test('CONTROL: a sync that changes nothing about a hold owes no re-read', () => {
  const s = setup();
  assert.notEqual(tasks.setOnHold(s.p.id, s.k.number, true, { until: { task: s.other.number } }).ok, false);
  projects.syncAgent('otto', board.roster);
  clear();
  projects.syncAgent('otto', board.roster);
  assert.equal(owed(), undefined, 'a sync with no change owed a re-read');
});
