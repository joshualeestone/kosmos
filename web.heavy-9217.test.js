'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9217: the board's heavy-job note. paintHeavyJobs fills #heavy-slot from /api/status's heavyJobs
   (engine/heavyjobs.js, which already dropped a record whose process or agent is gone). These arms drive the
   REAL function lifted from web/index.html against test-support/fake-dom, not a copy. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const { makeDom } = require('./test-support/fake-dom');
const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const BODY = page.liftAll(SCRIPT, ['paintHeavyJobs']);

function board() {
  const t = makeDom();
  const slot = t.add('heavy-slot');
  // eslint-disable-next-line no-new-func
  const paint = new Function('document', 'jobs', BODY + '\npaintHeavyJobs(jobs);');
  return { slot, paint: (jobs) => paint(t.document, jobs) };
}

// Local wall-clock times, so the HH:MM the page prints is known whatever zone the runner is in.
const at = (h, m) => new Date(2026, 10, 27, h, m).getTime();

test('nothing running (an empty list, null, absent, or not a list) leaves the slot empty, so CSS hides it', () => {
  for (const v of [[], null, undefined, 'x', { label: 'a' }]) {
    const b = board();
    b.paint(v);
    assert.equal(b.slot.children.length, 0, 'painted something for ' + JSON.stringify(v));
    assert.equal(b.slot.textContent, '');
  }
});

test('one job reads as one sentence naming the job, whose it is and since when, as a status line', () => {
  const b = board();
  b.paint([{ agent: 'Angel', label: 'cargo test (kosmos-relay)', since: at(9, 5) }]);
  assert.equal(b.slot.textContent, 'A heavy job is running on this computer: cargo test (kosmos-relay) (Angel, since 09:05).');
  const box = b.slot.children[0];
  assert.equal(box.getAttribute('role'), 'status');
  assert.equal(box.className, 'utoast heavy', 'the note should carry its neutral tone, not the bare attention red');
  assert.ok(!/this Mac/.test(b.slot.textContent), 'the copy says "this Mac"; it must say "this computer"');
});

test('two jobs read as one plural sentence, in the order the server gave', () => {
  const b = board();
  b.paint([
    { agent: 'Angel', label: 'cargo test', since: at(9, 5) },
    { agent: 'Mona Lisa', label: 'full suite', since: at(14, 30) },
  ]);
  assert.equal(b.slot.textContent, 'Heavy jobs are running on this computer: cargo test (Angel, since 09:05); full suite (Mona Lisa, since 14:30).');
});

test('the note names the agent by the display name the server adds, and by its session name when there is none', () => {
  const b = board();
  b.paint([{ agent: 'ada-discord', name: 'Ada', label: 'suite', since: at(9, 5) }, { agent: 'bo-discord', label: 'build', since: at(9, 6) }]);
  assert.equal(b.slot.textContent, 'Heavy jobs are running on this computer: suite (Ada, since 09:05); build (bo-discord, since 09:06).');
  b.paint([{ agent: 'ada-discord', name: 'Ada Lovelace', label: 'suite', since: at(9, 5) }, { agent: 'bo-discord', label: 'build', since: at(9, 6) }]);
  assert.match(b.slot.textContent, /suite \(Ada Lovelace, since/, 'a renamed agent kept its old name on the note');
});

test('a label with markup in it stays text: no element is made from it', () => {
  const b = board();
  b.paint([{ agent: 'Angel', label: '<b>x</b><img src=y>', since: at(9, 5) }]);
  assert.match(b.slot.textContent, /<b>x<\/b><img src=y>/, 'the label did not arrive as literal text');
  const box = b.slot.children[0];
  assert.equal(box.children.length, 2, 'the note grew elements beyond its dot and its text');
  assert.equal(box.children[1].children.length, 0, 'the text node has children, so the label became markup');
});

test('a record missing its agent, label or time is skipped, and the rest still show', () => {
  const b = board();
  b.paint([
    { agent: 'Angel', label: 'cargo test' },
    { label: 'no agent', since: at(9, 5) },
    { agent: 'Kitty', label: 7, since: at(9, 5) },
    null,
    { agent: 'Mona Lisa', label: 'full suite', since: at(14, 30) },
  ]);
  assert.equal(b.slot.textContent, 'A heavy job is running on this computer: full suite (Mona Lisa, since 14:30).');
  const c = board();
  c.paint([{ agent: 'Angel', label: 'x', since: NaN }]);
  assert.equal(c.slot.textContent, '', 'a NaN time painted a line');
});

test('the same jobs again do not repaint; a change does; a job that ends clears the note on the same slot', () => {
  const b = board();
  const jobs = [{ agent: 'Angel', label: 'cargo test', since: at(9, 5) }];
  b.paint(jobs);
  const first = b.slot.children[0];
  b.paint(jobs.map((j) => ({ ...j })));
  assert.equal(b.slot.children[0], first, 'an unchanged list rebuilt the note on every poll');
  b.paint([{ agent: 'Angel', label: 'cargo build', since: at(9, 5) }]);
  assert.notEqual(b.slot.children[0], first, 'a changed label kept the old note');
  assert.match(b.slot.textContent, /cargo build/);
  b.paint([]);
  assert.equal(b.slot.children.length, 0, 'a finished job left its note standing');
});

test('the page wires it: a #heavy-slot hidden when empty, and tick() paints it from data.heavyJobs', () => {
  const html = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(html, /<div id="heavy-slot"><\/div>/);
  assert.match(html, /#heavy-slot:empty[^{]*\{ display: none; \}/);
  assert.match(html, /^\.utoast\.heavy \{ --utone: var\(--label-2\); \}/m, 'the heavy note has no neutral tone rule');
  const tick = page.lift(SCRIPT, 'tick');
  assert.match(tick, /paintHeavyJobs\(data\.heavyJobs\)/);
});
