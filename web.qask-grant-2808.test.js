'use strict';
/**
 * kosmos#2808 (Josh, 0.6.56), the GRANT half. The render slice (truncate the
 * command wall + a one-click "Clear this message" for the stranded state) shipped
 * in #2817. This is Josh's remaining literal ask: for a LIVE permission prompt,
 * ONE plainly-worded button that grants and clears, so a non-technical user does
 * not have to read a raw menu.
 *
 * The button sends the affirmative option through the SAME `sendTalk(n, label)`
 * path the raw option buttons use, so it inherits the answered-hold (which hides
 * this box on a placed send: the "clear this message" half) and the server's 409
 * screen-check (which refuses a pane that moved on). It is NOT a second send
 * path.
 *
 * Static assertions pin the wiring + the show/hide GATE that must not regress;
 * the runtime slices LIFT the gate and the click handler and run them against
 * stubs (the runtime-dom pattern: no jsdom). Live paint + reachability is
 * exercised by docs/browser-checks/render-qask-grant-2808.js at the cut, the same
 * split render-qask-clear-2808.js uses.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

// A minimal element good enough for these slices (id/hidden/disabled/dataset).
// No jsdom.
function fakeEl(id) {
  return { id, hidden: false, disabled: false, dataset: {} };
}

/* ---- static: the button ---- */

test('#2808 grant: exactly one button, hidden, primary, Josh\'s wording', () => {
  const g = PAGE.match(/<button[^>]*id="d-qask-grant"[^>]*>[^<]*<\/button>/g) || [];
  assert.equal(g.length, 1, 'exactly one grant button');
  assert.match(g[0], /\btype="button"/, 'a button, not a submit');
  assert.match(g[0], /\bhidden\b/, 'default hidden; the render turns it on only for an affirmative live prompt');
  assert.match(g[0], /class="btn uprime"/, 'the primary (gold) treatment, so it is the obvious action');
  assert.match(g[0], />Give this agent permission and clear this message<\/button>/,
    'Josh\'s exact wording');
});

test('#2808 grant: the button lives in #d-qask, above the raw options', () => {
  const box = PAGE.indexOf('id="d-qask"');
  const grant = PAGE.indexOf('id="d-qask-grant"');
  const opts = PAGE.indexOf('id="d-qopts"');
  assert.ok(box >= 0 && grant > box, 'the grant button is inside the #d-qask box');
  assert.ok(grant < opts, 'it sits ABOVE the raw option buttons (the prominent primary; raw options are secondary)');
});

/* ---- static: the show/hide GATE ---- */

test('#2808 grant: the gate only fires on an affirmative live permission menu', () => {
  // opts already carries every guard the option buttons need (asking, live, not
  // the answered-hold, a confident 1..n menu). The grant adds: not the folder-
  // trust prompt, a real >=2 choice, and an AFFIRMATIVE first option.
  assert.ok(
    /const AFFIRMATIVE_RE = \/\^\\s\*\(\?:\[❯›\]\\s\*\)\?\(\?:yes\|allow\|proceed\|approve\|continue\|ok\)\\b\/i;/.test(PAGE),
    'the affirmative pattern matches yes/allow/proceed/approve/continue/ok, case-insensitive, past an optional selector glyph',
  );
  assert.ok(
    /grantOpt = \(opts && !body\.answerNote && opts\.length >= 2\s*&& opts\[0\] && AFFIRMATIVE_RE\.test\(String\(opts\[0\]\.label\)\)\) \? opts\[0\] : null;/.test(PAGE),
    'grantOpt requires opts, NOT a trust prompt (answerNote), a >=2 menu, and an affirmative opt[0]',
  );
  assert.ok(/qGrant\.disabled = flying;/.test(PAGE),
    'the button is dead while THIS person\'s own answer is in the air (no double-answer)');
  assert.ok(/qGrant\.hidden = false;/.test(PAGE) && /qGrant\.hidden = true;/.test(PAGE),
    'shown for grantOpt, hidden otherwise');
});

test('#2808 grant: the click sends the affirmative through sendTalk, not a new path', () => {
  assert.ok(
    /getElementById\('d-qask-grant'\)\.addEventListener\('click'/.test(PAGE),
    'the grant button has its own click handler (it is not a .qopt in #d-qopts)',
  );
  const i = PAGE.indexOf("getElementById('d-qask-grant').addEventListener('click'");
  const seg = PAGE.slice(i, i + 400);
  assert.ok(/sendTalk\(btn\.dataset\.n, btn\.dataset\.label\)/.test(seg),
    'it calls the SAME sendTalk(n, label) the raw options use');
  assert.ok(/if \(btn\.disabled\) return;/.test(seg), 'a disabled button sends nothing');
});

/* ---- runtime: lift the gate and drive it ---- */

// Slice from the AFFIRMATIVE_RE declaration through the end of the qGrant block,
// so the runnable slice declares AFFIRMATIVE_RE + grantOpt and runs the toggle.
function gateRunner() {
  const START = 'const AFFIRMATIVE_RE =';
  const s = PAGE.indexOf(START);
  assert.ok(s >= 0, 'gate start anchor found');
  const blockAnchor = "{\n    const qGrant = document.getElementById('d-qask-grant');";
  const bi = PAGE.indexOf(blockAnchor, s);
  assert.ok(bi >= 0, 'gate block anchor found');
  let depth = 0, end = -1;
  for (let j = bi; j < PAGE.length; j++) {
    if (PAGE[j] === '{') depth++;
    else if (PAGE[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end >= 0, 'gate block braces balance');
  const slice = PAGE.slice(s, end + 1);
  return new Function('document', 'opts', 'body', 'flying',
    '"use strict";' + slice + ' return document.getElementById("d-qask-grant");');
}

function runGate(opts, body, flying) {
  const el = fakeEl('d-qask-grant');
  const document = { getElementById: (id) => (id === 'd-qask-grant' ? el : null) };
  gateRunner()(document, opts, body || {}, !!flying);
  return el;
}

test('#2808 grant runtime: SHOWS for a Claude yes/no permission menu', () => {
  const el = runGate([{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], {}, false);
  assert.equal(el.hidden, false, 'shown');
  assert.equal(el.dataset.n, '1', 'targets option 1');
  assert.equal(el.dataset.label, 'Yes', 'carries option 1\'s words for the bubble');
  assert.equal(el.disabled, false, 'live when no send is in flight');
});

test('#2808 grant runtime: SHOWS for a longer affirmative label and a Codex label', () => {
  const a = runGate([{ n: 1, label: 'Yes, and don\'t ask again this session' }, { n: 2, label: 'No' }], {}, false);
  assert.equal(a.hidden, false, 'a "Yes, ..." label still counts as affirmative');
  const c = runGate([{ n: 1, label: 'Yes, continue' }, { n: 2, label: 'No, quit' }], {}, false);
  assert.equal(c.hidden, false, 'Codex\'s "Yes, continue" / "No, quit" menu');
  assert.equal(c.dataset.label, 'Yes, continue');
});

test('#2808 grant runtime: DEAD while this person\'s own answer is in flight', () => {
  const el = runGate([{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], {}, true);
  assert.equal(el.hidden, false, 'still shown');
  assert.equal(el.disabled, true, 'but disabled, so a second press cannot double-answer');
});

test('#2808 grant runtime: HIDDEN on the folder-trust prompt (Trust & Restart owns it)', () => {
  // The trust prompt carries body.answerNote and its own affirmative-looking menu;
  // a "grant" there would type into a dialog skip-permissions does not cover.
  const el = runGate([{ n: 1, label: 'Yes, proceed' }, { n: 2, label: 'No' }],
    { answerNote: 'Pressing 1 trusts this folder.' }, false);
  assert.equal(el.hidden, true, 'no grant button on the trust prompt');
});

test('#2808 grant runtime: HIDDEN when opt[0] is not affirmative', () => {
  const el = runGate([{ n: 1, label: 'No, tell Claude what to do differently' }, { n: 2, label: 'Yes' }], {}, false);
  assert.equal(el.hidden, true, 'a non-affirmative first option gets no one-click grant (person uses the raw menu)');
});

test('#2808 grant runtime: HIDDEN for an open question and a single-option menu', () => {
  assert.equal(runGate(null, {}, false).hidden, true, 'no parsed menu (open question) -> no grant');
  assert.equal(runGate([{ n: 1, label: 'Yes' }], {}, false).hidden, true,
    'a one-option menu is not a yes/no permission choice -> no grant');
});

/* ---- runtime: lift the click handler ---- */

test('#2808 grant runtime: a click sends opt[0]\'s digit + words; a disabled one sends nothing', () => {
  const i = PAGE.indexOf("getElementById('d-qask-grant').addEventListener('click'");
  const bi = i + PAGE.slice(i).indexOf('{');
  let depth = 0, end = -1;
  for (let j = bi; j < PAGE.length; j++) {
    if (PAGE[j] === '{') depth++;
    else if (PAGE[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  const body = PAGE.slice(bi + 1, end);
  const run = new Function('e', 'sendTalk', '"use strict"; (function(){' + body + '})();');

  const sent = [];
  const sendTalk = (n, label) => sent.push([n, label]);

  run({ currentTarget: { disabled: false, dataset: { n: '1', label: 'Yes' } } }, sendTalk);
  assert.deepEqual(sent, [['1', 'Yes']], 'sends the affirmative digit on the wire and its words in the bubble');

  run({ currentTarget: { disabled: true, dataset: { n: '1', label: 'Yes' } } }, sendTalk);
  assert.deepEqual(sent, [['1', 'Yes']], 'a disabled (in-flight) button sends nothing more');
});
