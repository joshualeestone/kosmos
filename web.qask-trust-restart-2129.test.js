'use strict';
/**
 * kosmos#2129 recovery: the one-click "Trust and restart" button, surfaced in
 * the chat-view "Needs you" box (#d-qask), not only on the Terminal tab. Josh
 * hit the folder-trust prompt as an undismissible box above the dialog with no
 * way to act on it; this gives him the same one-click action right there.
 *
 * Static (no browser): the live render is exercised by the browser-check
 * docs/browser-checks/render-qask-trust-restart-2129.js in CI. These assertions
 * pin the WIRING that must not silently regress: the button exists, it is gated
 * on body.answerNote (the trust dialog ONLY, #1629 - never the #2456/#2575
 * reported-question false state), and it POSTs the trust-and-restart route.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#2129: the chat-box Trust and restart button exists, hidden by default', () => {
  const btn = PAGE.match(/<button[^>]*id="d-qask-trust-restart"[^>]*>/g) || [];
  assert.equal(btn.length, 1, 'exactly one chat-box trust-restart button');
  assert.match(btn[0], /\btype="button"/, 'it is a button, not a submit');
  assert.match(btn[0], /\bhidden\b/, 'default hidden; the render turns it on for the trust state');
  assert.equal((PAGE.match(/id="d-qask-trust-restart-msg"/g) || []).length, 1,
    'its receipt line exists exactly once');
});

test('#2129: the button is gated on body.answerNote (trust dialog ONLY, not the reported false state)', () => {
  // The show line: it turns the button ON, and it is guarded by body.answerNote.
  const show = PAGE.split('\n').filter((l) => /qTrust && body\.answerNote\) qTrust\.hidden = false/.test(l));
  assert.equal(show.length, 1, 'exactly one place unhides the button, and it requires body.answerNote');
  // The default-hide runs every paint before the branches, so a non-trust paint leaves it hidden.
  const hide = PAGE.split('\n').filter((l) => /if \(qTrust\) qTrust\.hidden = true;/.test(l));
  assert.ok(hide.length >= 1, 'the button is defaulted hidden each paint');
  // Control that CAN fail: if the guard were dropped (unhidden unconditionally),
  // this catches it. answerNote is null for the reported/false question (#1629),
  // so gating on it is what keeps the button off the #2456/#2575 false box.
  assert.equal((PAGE.match(/qTrust\.hidden = false/g) || []).length, 1,
    'the button is unhidden in exactly one place, and that place requires answerNote');
});

test('#2129: the button POSTs the same trust-and-restart route, self-contained', () => {
  assert.ok(
    /getElementById\('d-qask-trust-restart'\)\.addEventListener\('click'/.test(PAGE),
    'the chat-box button has its own click handler',
  );
  // Two buttons now drive the route: the Terminal-tab one and the chat-box one.
  const posts = PAGE.match(/'\/api\/agent\/' \+ encodeURIComponent\(forAgent\) \+ '\/trust-and-restart'/g) || [];
  assert.ok(posts.length >= 2, 'both trust-restart buttons POST the route (self-contained, not a shared helper)');
});

test('#2129: the chat-box receipt is cleared on agent switch, like its Terminal-tab twin', () => {
  // Mirrors the #d-trust-restart-msg reset, so a landed receipt cannot stand
  // under the next agent (the qask elements are reused, not rebuilt per agent).
  assert.ok(
    /getElementById\('d-qask-trust-restart-msg'\);\s*if \(m\) m\.textContent = ''/.test(PAGE),
    'the chat-box receipt is cleared on switch',
  );
});

test('#2129: the chat-box handler stays behaviorally identical to its Terminal-tab twin', () => {
  // The two handlers are a deliberate self-contained COPY (a shared helper would
  // break the qask isolation tests that lift the region). Nothing structural keeps
  // them identical, so pin the user-visible strings/precedence they share: each must
  // appear exactly twice, once per handler. A future edit that changes one copy's
  // message without the other drops a count and reds this test. (Iteration-1 review
  // caught the label already diverging; this guards the rest.)
  const twice = (needle, label) => {
    const n = PAGE.split(needle).length - 1;
    assert.equal(n, 2, `"${label}" must appear in BOTH trust-restart handlers, found ${n}`);
  };
  twice('Trusting and restarting…', 'interim text');
  twice('We could not trust and restart this agent.', 'non-ok / bad-response message');
  twice('We could not reach Kosmos to trust and restart this agent.', 'network-failure fallback');
  // NOTE: `r.because || r.error` is shared by other handlers (Open Terminal etc.), so it
  // is not a trust-restart parity pin. Pin the success-receipt precedence, which is.
  twice("(res.ok ? 'Restarting.'", 'success receipt precedence');
});
