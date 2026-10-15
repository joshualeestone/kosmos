'use strict';
/**
 * kosmos#6239 (first Kosmos+Kids slice): what `quiet_hours` stops on the board, through the policy as orgpolicy applies
 * it (a signed bundle). In the window nothing new is typed at any agent (chat.deliverWithGap, the one place every sender
 * goes through), except the commands that look after an agent; the person's Start and Restart are refused and
 * reported; no agent is made. The window is set around the real clock, so each arm is quiet or not by construction.
 * chat.menuhold-5743.test.js's harness: the cards come from test-support/fleet, and "typed" is measured on the argv
 * handed to tmux.
 *
 *   node --test engine/familyquiet-6239.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-familyquiet-6239-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const orgpolicy = require('./orgpolicy');
const removal = require('./remove');
const create = require('./create');
const fleet = require('../test-support/fleet');

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
let version = 0;
function apply(policy) {
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
  const r = orgpolicy.refresh({ now, pinned: PINNED });
  assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
}
/* A UTC window from `a` to `b` minutes from now, every night. */
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
const windowFrom = (a, b) => ({ quiet_hours: { tz: 'UTC', school_nights: false, from: hhmm(Date.now() + a * 60e3), to: hhmm(Date.now() + b * 60e3) } });
const QUIET = () => windowFrom(-60, 60);
const LATER = () => windowFrom(120, 180);

function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.typed = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys');
  return calls;
}
async function idleCasey(fn) {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try { return await fn(board, arm()); } finally { chat.resetForTests(); board.restore(); }
}

test('#6239: in quiet hours nothing new is typed at an agent, with the policy\'s words; outside them it is', async () => {
  apply(QUIET());
  assert.equal(orgpolicy.quietAt().quiet, true, 'CONTROL: the window covers now');
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'Can you check my homework?', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.equal(v.quiet, true);
    assert.match(v.because, /^nothing new is sent to agents now: it is quiet hours until \d\d:\d\d \(UTC time\), under the policy set for this Kosmos$/);
    assert.equal(calls.typed().length, 0, 'something was typed in quiet hours');
    const s = chat.deliver('casey', 'A room post for Casey.', board.agents);
    assert.equal(s.quiet, true, 'the synchronous sender too');
  });
  apply(LATER());
  assert.equal(orgpolicy.quietAt().quiet, false, 'CONTROL: the window is later');
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'Can you check my homework?', board.agents);
    assert.notEqual(v.quiet, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'CONTROL: outside the window the message is typed');
  });
});

test('#6239: the commands that look after an agent still go in quiet hours', async () => {
  apply(QUIET());
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', '/compact', board.agents);
    assert.notEqual(v.quiet, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, '/compact was not typed');
  });
  await idleCasey(async (board) => {
    const v = await chat.deliverAsync('casey', '/pplan homework', board.agents);
    assert.equal(v.quiet, true, 'CONTROL: a skill is work, and is held back');
  });
});

test('#6239: the person\'s Start and Restart are refused in quiet hours; the board\'s own restarts are not', () => {
  apply(QUIET());
  const r = removal.restart('nobody-here', 'restart', { startIfDead: true, quiet: true });
  assert.equal(r.outcome, removal.OUTCOME.REFUSED);
  assert.equal(r.quiet, true);
  assert.match(r.because, /^it was not started: it is quiet hours until/);
  const own = removal.restart('nobody-here', 'provider', {});
  assert.notEqual(own.quiet, true, 'a restart the board makes to finish a change was refused for quiet hours');
  apply(LATER());
  const later = removal.restart('nobody-here', 'restart', { startIfDead: true, quiet: true });
  assert.notEqual(later.quiet, true, 'CONTROL: outside the window');
});

test('#6239: no agent is made in quiet hours; a provider the policy refuses keeps its own sentence', () => {
  create.setRunner(null);   // dry-run: nothing reaches launchd
  apply({ ...QUIET(), providers_allowed: ['anthropic'] });
  const r = create.createAgent({ claudeBin: '/bin/echo', tmuxBin: '/bin/echo', name: 'Homework Helper', role: 'helper' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, JSON.stringify(r));
  assert.match(r.because, /^no agent is made now: it is quiet hours until/);
  assert.ok(!fs.existsSync(create.workerDir('homework-helper')), 'a folder was made');
  apply({ ...LATER(), providers_allowed: ['openai'] });
  const p = create.createAgent({ claudeBin: '/bin/echo', tmuxBin: '/bin/echo', name: 'Homework Helper', role: 'helper' });
  assert.equal(p.outcome, create.OUTCOME.REFUSED);
  assert.doesNotMatch(p.because, /quiet hours/, 'CONTROL: outside the window the provider refusal is what is said');
});
