'use strict';
/**
 * kosmos#8048 item 3: GET /api/agents/account-plan, through the real board. What moving one agent to one Claude account
 * would lose (engine/accountcarry.js does the reading; engine/accountcarry-8048.test.js covers it). Here: the route
 * answers only for this board's own Claude accounts and a known agent, uses real folders on both sides (the default
 * account's own folder, not this process's home), and passes "cannot tell" through rather than reading it as safe.
 *
 *   node --test server.accountplan-8048.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-acctplan-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
delete process.env.TMUX;
delete process.env.TMUX_PANE;
const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

/* Two account folders, shaped as Mortals' were on 2026-11-05: the main one has a skill and a gate the other lacks. */
function folder(dir, skills, hooks) {
  for (const s of skills) fs.mkdirSync(nodePath.join(dir, 'skills', s), { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: hooks.map((c) => ({ type: 'command', command: c })) }] } }));
}
const MAIN = nodePath.join(HOME, '.claude');
const SPARE = nodePath.join(HOME, '.claude-spare');
const BROKEN = nodePath.join(HOME, '.claude-broken');
/* The gates' scripts, in the sandbox home: a hook's ~ resolves against the board's own home (AGENT_WORKFORCE_HOME),
   never the runner's, so this cannot pass only because the runner's machine has the real gates. */
fs.mkdirSync(nodePath.join(HOME, '.claude', 'hooks', 'user'), { recursive: true });
for (const g of ['pre-challenge-gate.sh', 'destructive-cmd-gate.sh']) fs.writeFileSync(nodePath.join(HOME, '.claude', 'hooks', 'user', g), '#!/bin/sh\n# ' + g + '\n');
folder(MAIN, ['pick-up', 'design-shots'], ['bash ~/.claude/hooks/user/pre-challenge-gate.sh', 'bash ~/.claude/hooks/user/destructive-cmd-gate.sh']);
folder(SPARE, ['pick-up'], ['bash $HOME/.claude/hooks/user/pre-challenge-gate.sh']);
fs.mkdirSync(BROKEN, { recursive: true });
fs.writeFileSync(nodePath.join(BROKEN, 'settings.json'), '{ not json');

const accounts = require('./engine/accounts');
const create = require('./engine/create');
const REAL = { list: accounts.list, readJob: create.readJob };
const ROWS = [
  { dir: MAIN, isDefault: true, label: null, apiKey: false },
  { dir: SPARE, isDefault: false, label: 'spare', email: 'spare@example.test', apiKey: false },
  { dir: nodePath.join(HOME, '.claude-Twin'), isDefault: false, label: 'Twin', apiKey: false },
  { dir: nodePath.join(HOME, '.claude-twin'), isDefault: false, label: 'twin', apiKey: false },
  { dir: BROKEN, isDefault: false, label: 'broken', apiKey: false },
  { dir: nodePath.join(HOME, '.claude-key'), isDefault: false, label: 'key', apiKey: true },
];
const JOBS = { ada: { configDir: null, runner: 'claude' }, bo: { configDir: SPARE, runner: 'claude' }, cody: { configDir: null, runner: 'codex' }, cy: { configDir: SPARE + '/', runner: 'claude' } };
accounts.list = () => ROWS;
create.readJob = (n) => JOBS[n] || null;

const { start, server } = require('./server');
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  accounts.list = REAL.list; create.readJob = REAL.readJob;
  server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const plan = async (q) => { const r = await fetch(`${base}/api/agents/account-plan?${new URLSearchParams(q)}`); return { code: r.status, j: await r.json() }; };

test('kosmos#8048: an agent on the main account, moving to a drifted copy, is told what it would lose', async () => {
  const { code, j } = await plan({ name: 'ada', dir: SPARE });
  assert.equal(code, 200);
  assert.deepEqual([j.ok, j.skills, j.hooks], [true, ['design-shots'], ['destructive-cmd-gate.sh']], JSON.stringify(j));
  assert.equal(j.sentence, 'On that account it would not have the skill design-shots, or the hook destructive-cmd-gate.sh it has now.');
  // CONTROL: the other way, nothing is lost.
  const back = await plan({ name: 'bo', account: 'main' });
  assert.deepEqual([back.j.ok, back.j.skills, back.j.hooks, back.j.sentence], [true, [], [], null], JSON.stringify(back.j));
});

test('kosmos#8048: an account this board does not have, an API key, or an unknown agent is refused; "already there" is said', async () => {
  assert.equal((await plan({ name: 'ada', dir: '/etc' })).code, 404, 'an arbitrary folder was read');
  assert.equal((await plan({ name: 'ada', dir: nodePath.join(HOME, '.claude-key') })).code, 200, 'an API key account, which Settings can move to, was refused');
  assert.equal((await plan({ name: 'nobody', dir: SPARE })).code, 404, 'an agent with no launch job was planned');
  assert.equal((await plan({ dir: SPARE })).code, 400);
  assert.equal((await plan({ name: 'ada' })).code, 400, 'no account and no folder silently meant the main account');
  const same = await plan({ name: 'bo', dir: SPARE });
  assert.deepEqual([same.j.ok, same.j.same], [true, true]);
});

test('kosmos#8048: a target that cannot be read answers "cannot tell" (ok: false), never a clean plan', async () => {
  const { code, j } = await plan({ name: 'ada', dir: BROKEN });
  assert.equal(code, 200);
  assert.equal(j.ok, false, 'an unreadable target read as nothing lost: ' + JSON.stringify(j));
  assert.match(j.because, /account it would move to/);
});

test('kosmos#8048: an account named by its label (any case) or "main" resolves to its folder, and says which', async () => {
  const byLabel = await plan({ name: 'ada', account: 'Spare' });
  assert.deepEqual([byLabel.code, byLabel.j.dir, byLabel.j.label, byLabel.j.skills], [200, SPARE, 'spare', ['design-shots']], JSON.stringify(byLabel.j));
  const main = await plan({ name: 'bo', account: 'main' });
  assert.deepEqual([main.j.dir, main.j.label], [MAIN, 'the main account']);
  assert.equal((await plan({ name: 'ada', account: 'nope' })).code, 404, 'an unknown label resolved');
  assert.equal((await plan({ name: 'ada', account: 'key' })).code, 200, 'an API key account, which Settings can move to, was not found by its label');
});

test('kosmos#8048 review 1: the account as kosmos accounts names it (its email, "the default account") resolves', async () => {
  const byEmail = await plan({ name: 'ada', account: 'spare@example.test' });
  assert.deepEqual([byEmail.code, byEmail.j.dir], [200, SPARE], 'the email kosmos accounts prints was refused: ' + JSON.stringify(byEmail.j));
  const def = await plan({ name: 'bo', account: 'the default account' });
  assert.deepEqual([def.code, def.j.dir], [200, MAIN], '"the default account", as kosmos accounts prints it, was refused');
});

test('kosmos#8048 review 1: a name matching two accounts is refused, never guessed; an exact match wins', async () => {
  assert.equal((await plan({ name: 'ada', account: 'TWIN' })).code, 409, 'a name two accounts share (by case) was guessed');
  const exact = await plan({ name: 'ada', account: 'twin' });
  assert.deepEqual([exact.code, exact.j.dir], [200, nodePath.join(HOME, '.claude-twin')], 'CONTROL: an exact name did not win');
});

test('kosmos#8048 review 1: an agent that does not run on Claude is refused, not told it is already there', async () => {
  const r = await plan({ name: 'cody', account: 'main' });
  assert.equal(r.code, 409, JSON.stringify(r.j));
  assert.match(r.j.because, /does not run on a Claude account/);
  assert.notEqual(r.j.same, true, 'a Codex agent was told it is already on the main account');
});

test('kosmos#8048 review 1: an agent whose job spells its folder with a trailing slash is still "already there"', async () => {
  const r = await plan({ name: 'cy', account: 'spare' });
  assert.deepEqual([r.code, r.j.same], [200, true], JSON.stringify(r.j));
});
