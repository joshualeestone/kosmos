'use strict';
/**
 * kosmos#7640: board pages from Angel's 10-30 Kosmos Cloud walk (#4903 items 2 and 6).
 *   - A remote session (every session on a cloud machine) stops asking for /api/remote/waiting after its first 403:
 *     an open tab asked 720 times an hour, every answer a refusal by design.
 *   - "Your agents then run on your own subscription, on this computer." says "your cloud machine" there.
 *   - A create refusal from the engine reads as a sentence: a capital, and "your cloud machine" on a cloud machine.
 * Each is the page's own source, lifted and run, with a control that can fail.
 *   node --test web.cloudboard-7640.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const run = (names, body, env) => {
  const keys = Object.keys(env);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, page.liftAll(SCRIPT, names) + '\n' + body)(...keys.map((k) => env[k]));
};

function waitingEnv(status) {
  const calls = [];
  const WAIT = { v2: false, rows: [], error: '', note: '', noteAt: 0, said: {}, typed: {}, wrong: {}, ctAlarm: false, ctFinding: null, cw: null, paintedSig: '', refused: false };
  return {
    calls, WAIT,
    env: {
      WAIT, REMOVE_SAID_MS: 60000, PLUS_ADDRESS: '',
      fetch: async (url) => { calls.push(url); return { status, ok: status === 200, json: async () => ({ v2: false, waiting: [] }) }; },
      paintAsk: () => {}, plusWords: (s) => s,
    },
  };
}

test('kosmos#7640: a remote session asks for the waiting list once; after its 403 it asks no more', async () => {
  const w = waitingEnv(403);
  const poll = run(['pollWaiting', 'waitSig', 'waitForgetRows'], 'return pollWaiting;', w.env);
  await poll(); await poll(); await poll();
  assert.equal(w.calls.length, 1, 'asked ' + w.calls.length + ' times after a 403');
  assert.equal(w.WAIT.refused, true);
  assert.equal(w.WAIT.v2, false, 'nothing shows on a refused session');
});

test('kosmos#7640 CONTROL: the board on the computer itself (200) keeps asking', async () => {
  const w = waitingEnv(200);
  const poll = run(['pollWaiting', 'waitSig', 'waitForgetRows'], 'return pollWaiting;', w.env);
  await poll(); await poll(); await poll();
  assert.equal(w.calls.length, 3);
  assert.equal(w.WAIT.refused, false);
});

test('kosmos#7640: every "on your own subscription, on this computer" sentence names the machine through data-cloud-copy', () => {
  const plain = PAGE.split('on your own subscription, on this computer.').length - 1;
  const wrapped = PAGE.split('on your own subscription, on <span data-cloud-copy="thisMachine">this computer</span>.').length - 1;
  // The Model step lead, three sign-in panels, and the Windows copy table's (harmless there: a Windows board is never a
  // cloud machine, so the span keeps "this computer").
  assert.equal(wrapped, 5, 'the five sentences are not all wrapped');
  assert.equal(plain, 0, 'a sentence still says "this computer" plainly');
});

test('kosmos#7640: data-cloud-copy says "your cloud machine" on a cloud machine, and "this computer" elsewhere (CONTROL)', () => {
  const paint = (cloud) => {
    const span = { textContent: 'this computer', getAttribute: () => 'thisMachine' };
    const root = { querySelectorAll: (sel) => (sel === '[data-cloud-copy]' ? [span] : []) };
    const document = { documentElement: { setAttribute: () => {} } };
    run(['applyPlatformCopy', 'thisMachine'], 'applyPlatformCopy(root);',
      { root, document, window: {}, onCloudMachine: () => cloud, onLinux: () => cloud, onWindows: () => false, linuxCopy: (k) => k, windowsCopy: (k) => k });
    return span.textContent;
  };
  assert.equal(paint(true), 'your cloud machine');
  assert.equal(paint(false), 'this computer');
});

test('kosmos#7640: the engine\'s no-Claude refusal reads as a sentence, with the cloud machine named there', () => {
  const because = 'there is no Claude account signed in on this computer, so an agent created on Claude could not run. Connect a Claude account in Settings, AI Models.';
  const say = (cloud) => run(['asSentence', 'cloudWords'], 'return asSentence(s);', { s: because, onCloudMachine: () => cloud });
  assert.equal(say(true), 'There is no Claude account signed in on your cloud machine, so an agent created on Claude could not run. Connect a Claude account in Settings, AI Models.');
  assert.match(say(false), /^There is no Claude account signed in on this computer,/, 'CONTROL: a Mac keeps "this computer", capitalised');
  // And the create form's sinks use it (guarded, so a function lifted alone still runs).
  const CS = "(typeof asSentence === 'function' ? asSentence : (typeof cloudWords === 'function' ? cloudWords : (x) => x))(";
  assert.equal(PAGE.split(CS).length - 1, 3, 'the three create refusal sinks do not all say it as a sentence');
});
