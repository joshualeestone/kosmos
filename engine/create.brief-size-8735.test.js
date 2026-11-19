'use strict';
/**
 * kosmos#8735: Claude Code warns above every new agent's prompt when its CLAUDE.md is over 40,000 characters ("CLAUDE.md is
 * over the 40.0k-char limit ... /memory to free up context"). On a person's first agent that warning is the first thing
 * they see. This makes a REAL agent of every built-in role (dry-run off, every root in this file's sandbox, the community
 * section on as it is by default) and fails when any brief is at or over CEILING (below), so no addition to the
 * working rules can make a brief bigger unnoticed.
 *
 * Counted in characters (code points), as Claude Code counts them, not bytes.
 *
 * HEADROOM: a brief grows after birth (each project an agent joins adds a line block), so the GOAL is below the limit,
 * not at it: NEW_AGENT_GOAL. Until #8735 reaches it, the guard is a RATCHET: CEILING is the largest brief measured after
 * the last slice (rounded up), so no change can make a brief bigger, and each slice lowers it. Never raise CEILING.
 * Measured: pm 58,458 on main before #8735; 51,105 after slice 1 (the community routine moved to `kosmos community --how`).
 *
 *   node --test engine/create.brief-size-8735.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'brief-size-8735-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'systemd-user');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const roles = require('./roles');
const status = require('./status');
require('../test-support/catalogue-fixture').install(SANDBOX);

const winBin = (posix, exe) => (process.platform === 'win32'
  ? nodePath.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe) : posix);
const BINS = { claudeBin: winBin('/bin/echo', 'where.exe'), tmuxBin: winBin('/bin/echo', 'where.exe') };

const CLAUDE_CODE_LIMIT = 40000;
const NEW_AGENT_GOAL = 36000;   // headroom under the limit for the blocks a brief gains after birth (projects, team)
const CEILING = 51200;          // the ratchet (see above): lowered by each slice of #8735 until it reaches NEW_AGENT_GOAL
const chars = (s) => [...s].length;

test.beforeEach(() => { status.setPaneSource(() => ''); create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false); });
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

test('#8735: every built-in role makes an agent whose brief is under the size guard, community section included', () => {
  const sizes = [];
  let made = 0;
  for (const [i, role] of roles.ROLES.entries()) {
    if (!role || typeof role.key !== 'string' || role.menu === false) continue;
    const name = 'size-' + i;
    const out = create.createAgent({ ...BINS, name, role: role.key });
    assert.equal(out.outcome, create.OUTCOME.CREATED, role.key + ': ' + out.because);
    sizes.push([role.key, chars(fs.readFileSync(create.instructionFile(name), 'utf8'))]);
    made++;
  }
  assert.ok(made > 100, 'only ' + made + ' roles were made, so this guard covered almost nothing');
  sizes.sort((a, b) => b[1] - a[1]);
  assert.ok(CEILING >= NEW_AGENT_GOAL && CEILING < 58458, 'the ceiling may only come down toward the goal');
  const over = sizes.filter(([, n]) => n >= CEILING);
  assert.deepEqual(over, [], 'new agents\' briefs at or over ' + CEILING + ' characters (the goal is ' + NEW_AGENT_GOAL + '; Claude Code warns at '
    + CLAUDE_CODE_LIMIT + '); largest five: ' + JSON.stringify(sizes.slice(0, 5)));
});
