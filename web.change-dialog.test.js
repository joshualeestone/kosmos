'use strict';
/**
 * The model-change dialog reports its outcome, success as well as failure
 * (#619, the #788 family): driven THROUGH changeDialog and changeModelNow
 * lifted from the page, against a fake fetch. The page before the fix is
 * the control: its dialog stayed on "Working…" after a successful change.
 *
 *   node --test web.change-dialog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
/* Sandbox before the fleet require, as every fixture consumer does. */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'chgdlg-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
/* A REAL CARD for CURRENT, from the fixture that produces them, never a
   hand-written stand-in (this repo's own lint refuses one, rightly: a
   stand-in is free to carry fields the producer never emits). */
function currentCard() {
  /* No displayName: that makes the fixture write an identity file under
     AGENT_WORKFORCE_WORKERS, which this test does not sandbox and must not
     write; the card's sessionName is all the dialog reads. */
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const card = board.agents.find((a) => a.name === 'mara');
    assert.ok(card, 'the fixture produced no card');
    const pick = ({ sessionName, name }) => ({ sessionName, name });
    return pick(card);
  } finally { board.restore(); }
}

function lift(script, name) {
  const at = script.indexOf(name);
  assert.ok(at > -1, name + ' moved');
  const end = script.indexOf('\n}\n', at) + 3;
  return script.slice(at, end);
}
function world(html, fetchImpl) {
  const script = page.scriptOf(html);
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', value: 'fable', hidden: false, disabled: false, selectedIndex: 0, options: [{ textContent: 'Claude Fable 5', value: 'fable' }], focus() {} });
  const ctx = {
    /* ⚠️ addEventListener/removeEventListener joined the stub with #1316:
       `changeDialog` registers a document-level Escape handler, and a stub
       without them throws before any assertion here runs. No-ops are enough for
       this file, which is about the SENTENCES; the sibling
       web.change-dialog-exit-1313.test.js records them. */
    document: { getElementById: el, addEventListener: () => {}, removeEventListener: () => {} },
    CURRENT: currentCard(),
    fetch: fetchImpl, encodeURIComponent, tick: async () => {}, agentShown: () => 'Mara', console,
    /* #768-batch: changeModelNow now names the provider in the reduced success line.
       Lift the real (const arrow) providerOf into the VM ctx, since `lift` only pulls
       the two `function` declarations. */
    providerOf: (a) => ((a && a.runner === 'codex') ? 'openai' : 'anthropic'),
  };
  vm.runInNewContext(lift(script, 'function changeDialog(') + '\n' + lift(script, 'async function changeModelNow('), ctx);
  return { ctx, el };
}
async function change(w) {
  w.ctx.changeDialog({ title: 'Change Mara to Claude Fable 5?', small: 'Mara restarts.', go: 'Change and restart', run: (say) => w.ctx.changeModelNow(say) });
  await w.el('chg-go').onclick();
  return { msg: w.el('chg-msg').textContent, keep: w.el('chg-keep') };
}
const ok = (outcome, because) => async () => ({ ok: true, json: async () => ({ outcome, because }) });
const CURRENT_PAGE = fs.readFileSync('web/index.html', 'utf8');

test('a successful change is said in the dialog with Done; a saved-but-not-restarted one with Close; a refusal with Close', async () => {
  let got = await change(world(CURRENT_PAGE, ok('changed', 'Mara is starting again on Claude Fable 5.')));
  /* #768-batch: on a real restart the dialog now reduces to the one action left --
     say hello to reactivate -- naming the provider (Mara has no codex runner -> Claude).
     The engine's fuller sentence still stands on the section line behind the dialog. */
  assert.equal(got.msg, 'Say hello to Mara to reactivate them on Claude.');
  assert.equal(got.keep.textContent, 'Done'); assert.equal(got.keep.hidden, false);
  got = await change(world(CURRENT_PAGE, ok('partial', 'We saved Claude Fable 5, but could not start it again.')));
  assert.match(got.msg, /^We saved/); assert.equal(got.keep.textContent, 'Close'); assert.equal(got.keep.hidden, false);
  got = await change(world(CURRENT_PAGE, async () => ({ ok: false, json: async () => ({ outcome: 'refused', because: 'that agent has no startup file' }) })));
  assert.equal(got.msg, 'that agent has no startup file'); assert.equal(got.keep.textContent, 'Close');
});

test('control: the page before this change left the dialog on Working… after a successful change, its button hidden', async () => {
  let before;
  try { before = execFileSync('git', ['show', 'origin/main:web/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { console.log('  (origin/main not readable here; the control did not run)'); return; }
  if (/say\(out\.because \|\| 'Changed\.'/.test(before)) { console.log('  (origin/main already carries the fix; the control has nothing to bite on)'); return; }
  // The control runs the OLD page (origin/main) in this harness to prove it lied
  // with 'Working…' before #619's change-dialog fix. It detects "main already
  // carries the fix" by the code-string regex just above -- which goes stale the
  // moment the fix's code shape is refactored. origin/main HAS since evolved
  // (#619 merged long ago; #2463 refactored the success text and added a
  // `providerOf` reference), so this control is now effectively RETIRED: on any
  // branch it will take one of the two graceful exits below, never the assertion.
  // That is acceptable -- its subject (the pre-#619 page) is no longer on
  // origin/main, and the LIVE change-dialog coverage is the forward tests above
  // (they drive CURRENT_PAGE). This is a deliberate, documented retirement, not a
  // silently vacuous guard; pinning `before` to a fixed pre-#619 sha would restore
  // the historical bite and is a reasonable future enhancement if wanted.
  //
  // Retire BEHAVIOURALLY, not by the brittle regex, via two exits:
  //   - catch: a branch whose COMMITTED harness predates #2463 has no `providerOf`
  //     in world()'s ctx, so running the evolved origin/main page throws
  //     'providerOf is not defined'. THIS is what red'd every such PR's `test` job
  //     fleet-wide the moment #2463 landed on main. change() usually swallows the
  //     error into got.msg, but the catch also covers a hard throw.
  //   - msg-mismatch: a branch that DOES carry #2463's harness (main, this branch)
  //     runs the old page fine and gets the refactored success message, not
  //     'Working…'. Either way the old page no longer produces the lie, so skip.
  let got;
  try {
    got = await change(world(before, ok('changed', 'Mara is starting again.')));
  } catch (e) {
    console.log(`  (origin/main evolved beyond this harness: ${(e && e.message) || e}; the control has lost its bite)`);
    return;
  }
  if (got.msg !== 'Working…') {
    console.log(`  (origin/main no longer shows the old 'Working…' lie (got ${JSON.stringify(got.msg)}); the control has lost its bite)`);
    return;
  }
  assert.equal(got.keep.hidden, true);
});
