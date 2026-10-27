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

test('#7386 review 1: the whole family of invisible characters is covered, by category, not a list', () => {
  // Each measured to let a key show with a list of only the bidi marks and C1.
  for (const ch of ['⁡', '⁣', '⁤', '⁪', '⁯', '᠎', '͏', '️', '\u{e0041}', 'ᅟ', 'ㅤ', '឴', '￹']) {
    const cmd = stepVia('Bash', { command: 'export K=' + split(LIVE, 11, ch) + ' && run' });
    assert.ok(!leaks(cmd, LIVE, 11), 'U+' + ch.codePointAt(0).toString(16) + ' let a key in a command show: ' + JSON.stringify(cmd));
    const tool = stepVia('mcp__s__' + split(ANT, 30, ch), {});
    assert.ok(!leaks(tool, ANT, 13), 'U+' + ch.codePointAt(0).toString(16) + ' let a key in a tool name show: ' + JSON.stringify(tool));
  }
});

test('#7386 review 1: a C0 control or a newline in a tool name is folded, so it cannot split a key or break the line', () => {
  for (const ch of ['\u0001', '\n', '\t', '\u007f']) {
    const step = stepVia('mcp__s__' + split(ANT, 30, ch), {});
    assert.ok(!leaks(step, ANT, 13), JSON.stringify(ch) + ' let the key show: ' + JSON.stringify(step));
    assert.ok(!/[\u0000-\u001f\u007f]/.test(step), 'a control character reached the one-line step: ' + JSON.stringify(step));
  }
  // Control: an ordinary tool name with a newline in it is shown on one line.
  assert.equal(stepVia('Grep\nx', {}), 'using Grep x');
});

test('#7386 review 2: a password spelled with Unicode spaces is masked, in a command and a target, as on main', () => {
  for (const sp of [' ', '　', ' ', ' ']) {
    const cmd = stepVia('Bash', { command: 'echo password' + sp + 'is' + sp + 'Abc123!xyz9' });
    assert.ok(!cmd.includes('Abc123!xyz9'), 'U+' + sp.codePointAt(0).toString(16) + ' in a command: ' + JSON.stringify(cmd));
    const q = stepVia('WebSearch', { query: 'password' + sp + 'is' + sp + 'Abc123!xyz9' });
    assert.ok(!q.includes('Abc123!xyz9'), 'U+' + sp.codePointAt(0).toString(16) + ' in a query: ' + JSON.stringify(q));
  }
});

test('#7386 review 2: padding cannot push half a key past the cut and into the step', () => {
  for (const pad of [200, 210, 222, 230, 234]) {
    const step = stepVia('Bash', { command: 'a' + ' '.repeat(pad) + LIVE + ' && run' });
    assert.ok(!leaks(step, LIVE, 8), pad + ' spaces let part of the key show: ' + JSON.stringify(step));
    const ant = stepVia('Bash', { command: 'a' + ' '.repeat(pad) + ANT });
    assert.ok(!ant.includes('sk-ant-api03') && !leaks(ant, ANT, 13), pad + ' spaces let part of the key show: ' + JSON.stringify(ant));
  }
});

test('#7386 review 3: a key past heavy padding is masked wherever the padding ends (no raw cap before the fold)', () => {
  const GHP = 'ghp_' + 'Ab3dEf5hIj7kLm9nOp1qRs3tUv5wXy7zAb9cDe1f';
  for (const [pad, n] of [[' ', 1900], ['\n', 1905], ['\t', 1915], [' ', 1925], ['\n', 4000]]) {
    const step = stepVia('Bash', { command: (pad === ' ' ? '' : 'x') + pad.repeat(n) + 'echo ' + GHP });
    assert.ok(!leaks(step, GHP, 4), JSON.stringify(pad) + ' x' + n + ' let part of the key show: ' + JSON.stringify(step));
  }
});

test('#7386 review 3: CONTROL: an ordinary multi-line command (a list of hashes) is shown, not masked whole', () => {
  const h1 = '3f2a9c1b7e4d6a8f0c2e4b6d8f1a3c5e7b9d0f2a';
  const h2 = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b';
  const step = stepVia('Bash', { command: 'git cherry-pick ' + h1 + '\ngit cherry-pick ' + h2 });
  assert.ok(step.startsWith('running "git cherry-pick 3f2a'), JSON.stringify(step));
});

test('#7386 review 3: a key split by a combining mark or the Braille blank is masked', () => {
  for (const ch of ['́', '̈', '⠀']) {
    const step = stepVia('Bash', { command: 'export K=' + split(LIVE, 11, ch) + ' && run' });
    assert.ok(!leaks(step, LIVE, 11), 'U+' + ch.codePointAt(0).toString(16) + ' let the key show: ' + JSON.stringify(step));
  }
  // Control: an accented word in an ordinary command is shown as it is.
  assert.equal(stepVia('Bash', { command: 'echo café' }), 'running "echo café"');
});

test('#7386 review 4: a key split by a private-use character is masked; real combining marks in ordinary text are not', () => {
  for (const ch of ['', '', '\u{f0000}']) {
    const step = stepVia('Bash', { command: 'export K=' + split(LIVE, 11, ch) + ' && run' });
    assert.ok(!leaks(step, LIVE, 11), 'U+' + ch.codePointAt(0).toString(16) + ' let the key show: ' + JSON.stringify(step));
  }
  // Controls that reach the guard (each holds a combining mark, Mn), shown exactly as main shows them.
  assert.equal(stepVia('Bash', { command: 'echo café' }), 'running "echo café"');
  assert.equal(stepVia('Bash', { command: 'git commit -m "फिक्स बिल्ड"' }),
    'running "git commit -m "फिक्स बिल्ड""');
});

test('#7386 review 4: a megabyte command is folded and masked within the bound, and still says what it runs', () => {
  const timed = (cmd) => { const t0 = process.hrtime.bigint(); const step = stepVia('Bash', { command: cmd }); return [step, Number(process.hrtime.bigint() - t0) / 1e6]; };
  // A multi-line command holding a secret shows the mask whole (the accepted trade-off); nothing of the key shows.
  const [masked, ms1] = timed('echo start' + '\n'.repeat(5 << 20) + 'echo ' + LIVE);
  assert.ok(!leaks(masked, LIVE, 8), JSON.stringify(masked));
  // The same size with no secret still says what it runs.
  const [plain, ms2] = timed('echo start' + '\n'.repeat(5 << 20) + 'echo done');
  assert.equal(plain, 'running "echo start echo done"');
  for (const ms of [ms1, ms2]) assert.ok(ms < 500, 'a 5 MB command took ' + ms.toFixed(0) + ' ms on the supervisor loop');
});

test('#7386 review 5: a key split by U+FEFF (a zero-width no-break space JS counts as whitespace) is masked', () => {
  const GHP = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const cmd = stepVia('Bash', { command: 'aws --key ' + split(GHP, 20, '﻿') });
  assert.ok(!leaks(cmd, GHP, 4), JSON.stringify(cmd));
  const tool = stepVia('mcp__s__' + split(ANT, 30, '﻿'), {});
  assert.ok(!leaks(tool, ANT, 13), JSON.stringify(tool));
  // Control: shown as a space, as main shows it, when nothing secret is around it.
  assert.equal(stepVia('Bash', { command: 'echo a﻿b' }), 'running "echo a b"');
});
