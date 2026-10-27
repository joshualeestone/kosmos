'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7386: a secret split by an invisible character (a C1 control or a bidi mark) gets past the mask on the Windows
 * step text, which reaches the agent card and the board log. The step is read here the way the card reads it: through
 * the publisher's own write (as deliverystreak.turn-7368.test.js does).
 *
 *   node --test engine/win32streamstate.stepmask-7386.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stepmask-7386-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const ss = require('./win32streamstate');
const { MASK } = require('./secretmask');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

let nextId = 0;
function stepVia(name, input) {
  const wrote = [];
  const pub = ss.publisher('agent-a', { write: (rec) => { wrote.push(rec); return { ok: true }; }, clear: () => {}, setTimer: () => {}, now: () => Date.parse('2026-10-27T12:00:00Z') });
  pub.started(4242, 'sid-1');
  pub.wrote(); pub.event({ type: 'system', subtype: 'init' });
  pub.event({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_' + (++nextId), name, input }] } });
  pub.wrote();   // something queued, so the step is written
  return wrote[wrote.length - 1].step;
}

const ANT = 'sk-ant-api03-' + 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0fGh';
const LIVE = 'sk_live_' + '51Hq8bTz9Kp2Wm4Xn7Rv3Yc6';
const split = (s, at, ch) => s.slice(0, at) + ch + s.slice(at);
/* No part of the secret past its well-known prefix may show: any 6 characters of its body in a row count as a leak. */
const leaks = (step, secret, keep) => {
  const body = secret.slice(keep);
  for (let i = 0; i + 6 <= body.length; i++) if (step.includes(body.slice(i, i + 6))) return true;
  return false;
};

test('#7386: a key split by a bidi mark in a command is masked (main showed it whole)', () => {
  for (const ch of ['\u202e', '\u202a', '\u2066', '\u2069', '\u200f', '\u061c']) {
    const step = stepVia('Bash', { command: 'export K=' + split(LIVE, 11, ch) + ' && run' });
    assert.ok(!leaks(step, LIVE, 11), 'U+' + ch.codePointAt(0).toString(16) + ' let the key show: ' + JSON.stringify(step));
    assert.ok(step.includes(MASK), JSON.stringify(step));
  }
  // Control: the same key with no invisible character is masked, as on main.
  assert.ok(!stepVia('Bash', { command: 'export K=' + LIVE }).includes(LIVE.slice(8)));
});

test('#7386: a key split by a C1 control in a tool name is masked, wherever the split falls', () => {
  // Measured on main: a split late in the key showed its tail (at 30 and 40) or part of its body (at 20).
  for (const ch of ['\u0085', '\u0080', '\u009f']) {
    for (const at of [20, 30, 40]) {
      const step = stepVia('mcp__s__' + split(ANT, at, ch), {});
      assert.ok(!leaks(step, ANT, 13), 'U+' + ch.codePointAt(0).toString(16) + ' at ' + at + ' let the key show: ' + JSON.stringify(step));
    }
  }
});

test('#7386: a password spelled with C1 controls where the mask expects spaces is masked', () => {
  const step = stepVia('Bash', { command: 'echo password\u0085is\u0085Abc123!xyz9' });
  assert.ok(!step.includes('Abc123!xyz9'), JSON.stringify(step));
  // Controls: the spaced form and DEL (folded to a space before masking, the case #7368 review measured) stay masked.
  assert.ok(!stepVia('Bash', { command: 'echo password is Abc123!xyz9' }).includes('Abc123!xyz9'));
  assert.ok(!stepVia('Bash', { command: 'echo password\u007fis\u007fAbc123!xyz9' }).includes('Abc123!xyz9'));
});

test('#7386: a target split by an invisible character is masked too, and the step still says what it uses', () => {
  const step = stepVia('WebFetch', { url: 'https://x.example/?k=' + split(LIVE, 11, '\u202e') });
  assert.ok(!leaks(step, LIVE, 11), JSON.stringify(step));
  assert.ok(step.startsWith('using WebFetch on '), JSON.stringify(step));
});

test('#7386: CONTROL: an invisible character with no secret behind it masks nothing', () => {
  assert.equal(stepVia('Bash', { command: 'npm \u202einstall' }), 'running "npm \u202einstall"');
  assert.equal(stepVia('Read', { file_path: 'C:\\work\\a\u0085b.md' }), 'using Read on C:\\work\\a\u0085b.md');
  assert.equal(stepVia('Bash', { command: 'npm install' }), 'running "npm install"');
});
