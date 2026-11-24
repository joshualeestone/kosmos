'use strict';

/**
 * kosmos#8989, end to end with nothing stubbed: a real project, real tasks, real instructions files and the real re-read
 * debt (engine/instructionreread.js). A task the holder closes itself owes nothing; one a manager agent closes owes the
 * holder a re-read of "Your projects", and the changes it will be pointed at name the closed task.
 * Same sandboxed board as server.agent-writes-4491.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rereade2e-8989-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const tasksEngine = require('./engine/tasks');

const BOARD = 'BOARDTOKEN_test_8989_e2e_0123456789abcdef01';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { code: res.status, text };
}
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const withBoard = (h = {}) => ({ 'x-kosmos-board-token': BOARD, ...h });

const ir = require('./engine/instructionreread');

function instructions(name) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# ' + name + '\n\nYou work here.\n');
}

test('a manager closing the holder\'s task owes it a re-read; its own close does not', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  t.after(() => board.restore());
  instructions('mara'); instructions('otto');
  const folder = path.join(SANDBOX, 'work', 'lease');
  fs.mkdirSync(folder, { recursive: true });
  const p = projectsEngine.create({ name: 'Lease', folder, agents: ['mara', 'otto'] });
  const mine = tasksEngine.create(p.id, { sentence: 'draft the letter', made: { via: 'screen', by: null } });
  const theirs = tasksEngine.create(p.id, { sentence: 'file the lease', made: { via: 'screen', by: null } });
  for (const k of [mine, theirs]) assert.equal(tasksEngine.assignPart(p.id, k.number, 1, 'otto', { via: 'screen' }).ok, true);
  projectsEngine.syncAgent('otto', board.roster);
  const file = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'otto', 'CLAUDE.md');
  assert.match(fs.readFileSync(file, 'utf8'), /task \d+ of Lease: file the lease/, 'fixture: otto\'s section lists its task');
  const clear = () => { try { fs.rmSync(ir.file()); } catch { /* none owed */ } };
  const owed = () => (ir.readOwed().otto || {}).sections;
  const mara = sendertoken.mint('mara').token, otto = sendertoken.mint('otto').token;

  // CONTROL: otto closes its own task. Its section changes, and nothing is owed.
  clear();
  const own = await call('POST', `/api/project/${p.id}/task/${mine.number}/close`, { headers: asAgent(otto) });
  assert.equal(own.code, 200, own.text.slice(0, 200));
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /draft the letter/, 'fixture: the own close must change the section');
  assert.equal(owed(), undefined, 'the agent closing its own task was owed a re-read');

  // The board's own delivery pass (a long timer) could settle this debt between the close and the read; the read comes
  // milliseconds after the close, so it never has.
  // The report: mara (a manager) closes the task otto holds. otto's section changes and otto is owed the re-read.
  clear();
  const other = await call('POST', `/api/project/${p.id}/task/${theirs.number}/close`, { headers: asAgent(mara) });
  assert.equal(other.code, 200, other.text.slice(0, 200));
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /file the lease/, 'fixture: the close must change otto\'s section');
  assert.deepEqual(owed(), ['projects'], 'a task a manager closed was not owed to its holder');
});
