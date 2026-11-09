'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
/* kosmos#6255: the once-only share step. SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-is-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-is-proj-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const step = require('./invitestep');

const LINK = 'https://login.example.test/signup?invite=abc123';
const remote = (answer) => ({ read: () => ({ on: true }), enrolled: () => true, COORDINATOR: () => 'https://login.example.test', macRequest: async () => answer });
const DONE = [{ tasks: [{ closedAt: '2026-11-01T00:00:00Z' }] }];
const on = { KOSMOS_SHARE_STEP: '1' };
const ask = (o) => step.stepFor({ env: on, projects: DONE, roster: [], remote: remote({ ok: true, data: { code: 'abc123', link: LINK, reward: false } }), ...o });

test('off by default: no switch, no step', async () => {
  assert.deepEqual(await ask({ env: {}, roster: () => { throw new Error('read the roster while switched off'); }, projects: () => { throw new Error('read projects while switched off'); } }), { show: false });
  assert.equal((await ask({})).show, true, 'CONTROL: the same inputs with the switch on');
});
test('the reward words appear only on reward: true; missing or anything else gets the plain words', async () => {
  const plain = await ask({});
  assert.equal(plain.line, step.LINE_PLAIN);
  assert.doesNotMatch(JSON.stringify(plain), /month|free/i);
  for (const reward of [undefined, 'true', 1, null]) {
    const r = await ask({ remote: remote({ ok: true, data: { link: LINK, reward } }) });
    assert.equal(r.line, step.LINE_PLAIN, String(reward));
  }
  const paid = await ask({ remote: remote({ ok: true, data: { link: LINK, reward: true } }) });
  assert.equal(paid.line, step.LINE_REWARD, 'CONTROL: true says it');
});
test('no working link, no step: a refusal, an old coordinator, or a link that is not the sign-up door', async () => {
  for (const a of [{ ok: false }, null, { ok: true, data: {} }, { ok: true, data: { link: 'https://evil.test/signup?invite=abc' } }, { ok: true, data: { link: 'https://someone.example.test/signup?invite=abc' } },
    { ok: true, data: { link: 'http://login.example.test/signup?invite=abc' } }, { ok: true, data: { link: 'https://login.example.test/other?invite=abc' } },
    { ok: true, data: { link: 'https://login.example.test/signup' } }]) {
    assert.deepEqual(await ask({ remote: remote(a) }), { show: false }, JSON.stringify(a));
  }
});
test('waits for a first agent to do something: a closed or built task, or an agent speaking', async () => {
  assert.deepEqual(await ask({ projects: [{ tasks: [{}] }], roster: [] }), { show: false, wait: true }, 'asked again later');
  assert.equal(step.firstAgentDidSomething([], [{ tasks: [{ builtAt: 'x' }] }]), true);
  const chat = require('./chat');
  const orig = chat.readThread;
  chat.readThread = () => ({ messages: [{ from: 'ann' }] });
  try { assert.equal(step.firstAgentDidSomething(['ann'], []), true); } finally { chat.readThread = orig; }
  chat.readThread = () => ({ messages: [{ from: null }] });
  try { assert.equal(step.firstAgentDidSomething(['ann'], []), false, "the person's own message is not the agent doing something"); } finally { chat.readThread = orig; }
});
test('once: after it is answered it is never offered again', async () => {
  assert.equal((await ask({})).show, true, 'premise: due');
  assert.equal(step.markDone(), true);
  assert.deepEqual(await ask({}), { show: false });
  fs.unlinkSync(path.join(require('./store').ROOT, 'invite-step.json'));
});
test('a thrown read is no step, never a throw', async () => {
  assert.deepEqual(await ask({ remote: { read: () => { throw new Error('x'); } } }), { show: false });
});
