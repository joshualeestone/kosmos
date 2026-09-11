'use strict';
/**
 * kosmos#2808 (Josh, 0.6.56): clean up the agent-page "waiting on an answer"
 * message. Two things:
 *   1. TRUNCATE the raw command wall (#d-qask-text) to a short teaser with a
 *      "Show full command" toggle, so it stops filling the top of the page.
 *   2. Add a one-click "Clear this message" (dismiss) button, wired to the same
 *      clear-selfreport route the project room's clear uses (#2575).
 *
 * Static assertions pin the WIRING that must not silently regress; the runtime
 * slices below LIFT the two self-contained click handlers and run them against
 * stubs (the runtime-dom pattern: no jsdom, no browser). The live paint +
 * reachability is exercised by docs/browser-checks/render-qask-clear-2808.js in
 * a real browser at the cut, the same split render-pj-clear-2575 uses.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

// Real cards from the producer, never hand-built `{ sessionName }` literals (the
// fixture-discipline gate). CURRENT (the open-agent object the handler reads) is
// one of these.
function twoCards() {
  const board = fleet.install([fleet.agent('liukang'), fleet.agent('mara')]);
  return {
    a: board.agents.find((c) => c.name === 'liukang'),
    b: board.agents.find((c) => c.name === 'mara'),
    restore: board.restore,
  };
}

/* ---- static wiring ---- */

test('#2808: the dismiss button and the toggle exist, hidden by default', () => {
  const clr = PAGE.match(/<button[^>]*id="d-qask-clear"[^>]*>/g) || [];
  assert.equal(clr.length, 1, 'exactly one dismiss button');
  assert.match(clr[0], /\btype="button"/, 'it is a button, not a submit');
  assert.match(clr[0], /\bhidden\b/, 'default hidden; the render turns it on for a waiting box');
  assert.equal((PAGE.match(/id="d-qask-clear-msg"/g) || []).length, 1,
    'its receipt line exists exactly once');

  const exp = PAGE.match(/<button[^>]*id="d-qask-expand"[^>]*>/g) || [];
  assert.equal(exp.length, 1, 'exactly one show-full-command toggle');
  assert.match(exp[0], /\bhidden\b/, 'default hidden; the render turns it on only for a long wall');
  assert.match(exp[0], /aria-controls="d-qask-text"/, 'the toggle names the box it expands');
});

test('#2808: the button reads "Clear this message", never "give permission"', () => {
  // The honest wording is load-bearing: clear-selfreport clears the notification,
  // it does not grant a live pending permission. A "give permission" label would
  // be false for a genuinely blocked agent, so it must not appear on this control.
  assert.ok(/>Clear this message<\/button>/.test(PAGE), 'the button reads "Clear this message"');
  const btn = (PAGE.match(/<button[^>]*id="d-qask-clear"[^>]*>[^<]*<\/button>/) || [''])[0];
  assert.ok(!/give (this agent )?permission/i.test(btn),
    'the dismiss button must not claim to grant permission');
});

test('#2808: the clear handler POSTs clear-selfreport, self-contained, capture-and-recheck', () => {
  assert.ok(
    /getElementById\('d-qask-clear'\)\.addEventListener\('click'/.test(PAGE),
    'the dismiss button has its own click handler',
  );
  assert.ok(
    /'\/api\/agent\/' \+ encodeURIComponent\(forAgent\) \+ '\/clear-selfreport'/.test(PAGE),
    'it POSTs the clear-selfreport route for the current agent',
  );
  assert.ok(/reason: 'operator-dismissed'/.test(PAGE), 'it sends the operator-dismissed reason');
  assert.ok(/CURRENT && CURRENT\.sessionName === forAgent/.test(PAGE),
    'it captures-and-rechecks the agent so a receipt cannot cross agents');
});

test('#2808: the painter clamps a tall wall and offers the toggle only when tall', () => {
  // The clamp decision is from LINE COUNT of the text, not layout: a single long
  // line is one line tall (horizontal scroll handles its width), so only a
  // many-line wall clamps. Trailing newlines are trimmed so a 3-line command
  // with a stray trailing newline does not read as 4.
  assert.ok(
    /qLong = qStr\.replace\(\/\\n\+\$\/, ''\)\.split\('\\n'\)\.length > 3/.test(PAGE),
    'the tall-question test trims trailing newlines then counts > 3 lines',
  );
  assert.ok(/qtext\.classList\.toggle\('clamped', qLong\)/.test(PAGE),
    'the clamp class follows the long test');
  assert.ok(/qExpand\.hidden = !qLong/.test(PAGE), 'the toggle shows only for a long wall');
  // Default-hidden every paint like qTrust (so a non-asking paint leaves them off).
  assert.ok(/if \(qClear\) qClear\.hidden = true;/.test(PAGE), 'the dismiss is defaulted hidden each paint');
  assert.ok(/if \(qExpand\) qExpand\.hidden = true;/.test(PAGE), 'the toggle is defaulted hidden each paint');
});

test('#2808: the expand state survives a repeat poll of the SAME question', () => {
  // The BLOCKER this guards: paintTalk re-runs every ~5s poll for the same live
  // question; an unconditional `.expanded` reset would re-collapse the box a few
  // seconds after the person opened it. The reset must be gated on a new question.
  assert.ok(/const qNew = qtext\.__q2808 !== qStr;/.test(PAGE),
    'a new-question flag is derived from the stashed question key');
  assert.ok(/qtext\.__q2808 = qStr;/.test(PAGE), 'the current question is stashed on the element');
  assert.ok(/if \(qNew\) qtext\.classList\.remove\('expanded'\);/.test(PAGE),
    'the collapse happens ONLY on a new question, not every paint');
  // And the label reflects the CURRENT state, not a forced "Show full command".
  assert.ok(/const open = qtext\.classList\.contains\('expanded'\);/.test(PAGE),
    'the toggle label reads the current expanded state');
  // The key is dropped on agent switch so a new agent opens collapsed.
  assert.ok(/getElementById\('d-qask-text'\)\.__q2808 = null;/.test(PAGE),
    'the question key is reset on open so a switched-to agent opens collapsed');
});

test('#2808: the dismiss is hidden in the folder-trust state (Trust & Restart owns it)', () => {
  // Showing an identical-looking "Clear this message" next to "Trust & Restart"
  // would invite dismissing a live blocking prompt without resolving it.
  assert.ok(/if \(qClear\) qClear\.hidden = !!body\.answerNote;/.test(PAGE),
    'the dismiss is hidden when body.answerNote is set (the trust prompt)');
});

test('#2808: the box resets clamp + dismiss on open and clears the receipt on switch', () => {
  // On open (before the paint awaits): clamp classes stripped, dismiss hidden,
  // its receipt cleared.
  assert.ok(/getElementById\('d-qask-text'\)\.classList\.remove\('clamped', 'expanded'\)/.test(PAGE),
    'the clamp classes are stripped on open');
  // On agent switch: the receipt line is cleared, like its trust-restart twin.
  assert.ok(
    /getElementById\('d-qask-clear-msg'\);\s*if \(m\) m\.textContent = ''/.test(PAGE),
    'the dismiss receipt is cleared on switch',
  );
  assert.ok(
    /getElementById\('d-qask-clear'\);\s*if \(b\) b\.disabled = false/.test(PAGE),
    'the dismiss button is re-enabled on switch',
  );
});

/* ---- runtime: lift and run the two self-contained handlers ---- */

// A minimal element good enough for these two handlers (id, hidden, disabled,
// textContent, classList, get/setAttribute). No jsdom.
function fakeEl(id) {
  const set = new Set();
  return {
    id, hidden: false, disabled: false, textContent: '', _attrs: {},
    classList: {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, on) => {
        const want = on === undefined ? !set.has(c) : on;
        if (want) set.add(c); else set.delete(c);
        return want;
      },
      contains: (c) => set.has(c),
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
}

// Extract the `{ ... }` body of the click handler at `anchor` by brace-matching.
// Safe for THESE handlers: their braces are all real (none hidden inside a string
// or comment), which is asserted implicitly by the runtime tests passing.
function handlerBody(anchor) {
  const i = PAGE.indexOf(anchor);
  assert.ok(i >= 0, 'anchor not found: ' + anchor);
  const bi = i + anchor.lastIndexOf('{');
  let depth = 0;
  for (let j = bi; j < PAGE.length; j++) {
    if (PAGE[j] === '{') depth++;
    else if (PAGE[j] === '}') { depth--; if (depth === 0) return PAGE.slice(bi + 1, j); }
  }
  throw new Error('unbalanced braces after ' + anchor);
}

test('#2808 runtime: the toggle flips .expanded and its label both ways', () => {
  const els = { 'd-qask-text': fakeEl('d-qask-text'), 'd-qask-expand': fakeEl('d-qask-expand') };
  els['d-qask-expand'].textContent = 'Show full command';
  const document = { getElementById: (id) => els[id] || null };
  const body = handlerBody("getElementById('d-qask-expand').addEventListener('click', () => {");
  const run = new Function('document', '"use strict"; (function(){' + body + '})();');

  run(document);
  assert.equal(els['d-qask-text'].classList.contains('expanded'), true, 'expands on first click');
  assert.equal(els['d-qask-expand'].textContent, 'Show less');
  assert.equal(els['d-qask-expand'].getAttribute('aria-expanded'), 'true');

  run(document);
  assert.equal(els['d-qask-text'].classList.contains('expanded'), false, 'collapses on second click');
  assert.equal(els['d-qask-expand'].textContent, 'Show full command');
  assert.equal(els['d-qask-expand'].getAttribute('aria-expanded'), 'false');
});

function clearRunner() {
  const body = handlerBody("getElementById('d-qask-clear').addEventListener('click', async () => {");
  return new Function('document', 'CURRENT', 'fetch', 'paintTalk',
    '"use strict"; return (async () => {' + body + '})();');
}

test('#2808 runtime: a successful clear POSTs the route and re-reads the thread', async () => {
  const { a: CURRENT, restore } = twoCards();
  try {
    const els = { 'd-qask-clear': fakeEl('d-qask-clear'), 'd-qask-clear-msg': fakeEl('d-qask-clear-msg') };
    const document = { getElementById: (id) => els[id] || null };
    const posted = [];
    const fetchStub = async (url, opts) => {
      posted.push({ url, opts });
      return { ok: true, json: async () => ({ ok: true, cleared: true }) };
    };
    const painted = [];
    const paintTalk = async (s, n) => { painted.push([s, n]); };

    await clearRunner()(document, CURRENT, fetchStub, paintTalk);

    assert.equal(posted.length, 1, 'POSTs exactly once');
    assert.equal(posted[0].url, '/api/agent/' + encodeURIComponent(CURRENT.sessionName) + '/clear-selfreport',
      'URL-encoded clear-selfreport route for the current agent');
    assert.equal(posted[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(posted[0].opts.body), { reason: 'operator-dismissed' });
    assert.deepEqual(painted, [[CURRENT.sessionName, CURRENT.name]], 're-reads the agent thread on success');
    assert.equal(els['d-qask-clear-msg'].textContent, 'Clearing this message…',
      'no failure line is written on success (the receipt is the box disappearing)');
    assert.equal(els['d-qask-clear'].disabled, false, 're-enabled in finally');
  } finally { restore(); }
});

test('#2808 runtime: a failed clear surfaces a message and does NOT re-read', async () => {
  const { a: CURRENT, restore } = twoCards();
  try {
    const els = { 'd-qask-clear': fakeEl('d-qask-clear'), 'd-qask-clear-msg': fakeEl('d-qask-clear-msg') };
    const document = { getElementById: (id) => els[id] || null };
    const fetchStub = async () => ({ ok: false, json: async () => ({ ok: false, because: 'that could not be cleared' }) });
    const painted = [];
    const paintTalk = async (s, n) => { painted.push([s, n]); };

    await clearRunner()(document, CURRENT, fetchStub, paintTalk);

    assert.equal(painted.length, 0, 'a failed clear does not re-read (no false progress)');
    assert.equal(els['d-qask-clear-msg'].textContent, 'that could not be cleared', 'it surfaces the route reason');
    assert.equal(els['d-qask-clear'].disabled, false, 're-enabled for a retry');
  } finally { restore(); }
});

test('#2808 runtime: a mid-POST agent switch drops the receipt (capture-and-recheck)', async () => {
  const { a: CURRENT, b: other, restore } = twoCards();
  try {
    const els = { 'd-qask-clear': fakeEl('d-qask-clear'), 'd-qask-clear-msg': fakeEl('d-qask-clear-msg') };
    const document = { getElementById: (id) => els[id] || null };
    const painted = [];
    const paintTalk = async (s, n) => { painted.push([s, n]); };
    // The person switches to another agent while the POST is in flight: mutate
    // the shared CURRENT object to the other agent's session (the handler reads
    // its param object live).
    const fetchStub = async () => {
      CURRENT.sessionName = other.sessionName;
      return { ok: true, json: async () => ({ ok: true, cleared: true }) };
    };

    await clearRunner()(document, CURRENT, fetchStub, paintTalk);

    assert.equal(painted.length, 0, 'the re-read does not fire for the agent we left');
  } finally { restore(); }
});
