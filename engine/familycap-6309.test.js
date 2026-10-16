'use strict';
/**
 * kosmos#6309: what a family policy's monthly `usage_cap` stops on the board. At the cap nothing new is typed at any
 * agent (chat.deliverWithGap) and no question is answered (chat.answerQuestionMenu), with the policy's own sentence;
 * the bare look-after commands still go. This month's tokens come from fixture transcripts in a sandboxed config root.
 * familyquiet-6239.test.js's harness: "typed" is measured on the argv handed to tmux.
 *
 *   node --test engine/familycap-6309.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-familycap-6309-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'config');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const orgpolicy = require('./orgpolicy');
const usagecap = require('./usagecap');
const fleet = require('../test-support/fleet');

test.beforeEach(() => { chat.resetForTests(); usagecap.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* 150 tokens this month, in one transcript written a minute ago. */
{
  const dir = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'p1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), JSON.stringify({
    type: 'assistant', timestamp: new Date(Date.now() - 60e3).toISOString(),
    message: { id: 'm1', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } },
  }) + '\n');
}

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
const OVER = { usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'UTC' } };
const UNDER = { usage_cap: { monthly_tokens: 1000000, warn_pct: 80, tz: 'UTC' } };

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

test('#6309: at the cap nothing new is typed at an agent, with the policy\'s words; under it, it is', async () => {
  apply(OVER);
  assert.equal(usagecap.capInForce().used, 150, 'CONTROL: the fixture month is counted');
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'Can you check my homework?', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.equal(v.capped, true);
    assert.notEqual(v.quiet, true, 'a cap refusal is not a quiet-hours one');
    assert.match(v.because, /^nothing new is sent to agents now: this month's usage cap is reached \(150 of 100 tokens\), under the policy set for this Kosmos; it opens again on the 1st \(UTC time\)$/);
    assert.equal(calls.typed().length, 0, 'something was typed at the cap');
    assert.equal(chat.deliver('casey', 'A room post for Casey.', board.agents).capped, true, 'the synchronous sender too');
  });
  apply(UNDER);
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'Can you check my homework?', board.agents);
    assert.notEqual(v.capped, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'CONTROL: under the cap the message is typed');
  });
});

test('#6309: the bare look-after commands still go at the cap; one with words does not', async () => {
  apply(OVER);
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', '/compact', board.agents);
    assert.notEqual(v.capped, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, '/compact was not typed');
  });
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', '/compact do the homework for me', board.agents);
    assert.equal(v.capped, true, 'CONTROL: words ride on it: ' + JSON.stringify(v));
    assert.equal(calls.typed().length, 0);
  });
});

test('#6309: answering an agent\'s question at the cap is refused with nothing pressed', async () => {
  apply(OVER);
  await idleCasey(async (board, calls) => {
    const r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Proceed?', label: 'Yes' });
    assert.equal(r.ok, false);
    assert.equal(r.capped, true, JSON.stringify(r));
    assert.match(r.because, /^nothing was answered: this month's usage cap is reached/);
    assert.equal(calls.typed().length, 0, 'a key was pressed at the cap');
  });
  apply(UNDER);
  await idleCasey(async (board) => {
    const r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Proceed?', label: 'Yes' });
    assert.notEqual(r.capped, true, 'CONTROL: under the cap it is refused for another reason or none: ' + JSON.stringify(r));
  });
});

test('#6309: a damaged policy record does not shut every agent off (a fault reads as open)', async () => {
  fs.writeFileSync(orgpolicy.APPLIED(), '{ not json');
  assert.throws(() => usagecap.capAllows(), 'CONTROL: the record really is damaged');
  await idleCasey(async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'hello', board.agents);
    assert.notEqual(v.capped, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0);
  });
});
