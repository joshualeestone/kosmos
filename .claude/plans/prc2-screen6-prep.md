# PR-C2 prep: install-flow Screen 6 "self-improving" consent switches (#2037 + #2020)

**Status: PREP, FINALIZED against Renet's `install-flow-9screen` branch (2026-09-05).**
This is the ready-to-apply BEHAVIOR patch. **Do NOT edit `web/index.html` until
Renet's flow merges** (collision rule). Apply the moment `install-flow-9screen`
lands on main (Splinter coordinates the merge order).

Routed by Splinter; structure hooks handed over by Renet (HEADS-UP 2026-09-05, full
writeup on her branch at `.claude/plans/install-flow-9screen-PR.md`).

## The split (confirmed with Renet)

- **Renet owns the MARKUP** and it is ALREADY on her branch (`web/index.html`
  `fr-pane-6`, ~line 8099), STATIC in the DOM from first paint, hidden until step 6:
  eyebrow "Self improving", headline "Help make Kosmos work better for everyone",
  two `.s6-switch-row`s:
  - `<span class="s6-sw" id="fr-s6-feedback" role="switch" aria-checked="true" tabindex="0">` -- daily report (#2037)
  - `<span class="s6-sw" id="fr-s6-createping" role="switch" aria-checked="true" tabindex="0">` -- create ping (#2020)
  Both default `aria-checked="true"` (ON). **Mona's CSS paints off `aria-checked`**
  (`.s6-sw[aria-checked="false"]` = grey + slider left; default = blue + slider right).
- **Angel (me) owns the BEHAVIOR only**: the toggle handlers + the on-show refresh.
  No markup to add. So this patch is JS + tests, applied onto her static markup.

## Integration hooks (from Renet, against her real structure)

1. **Container**: `#fr-pane-6`, 6th of 9 panes in `.fr-body` (Model=5, Success=7).
   Switches are STATIC -> bind at module top-level (direct listeners on the two
   ids, OR one delegated click+keydown on `#fr-pane-6`).
2. **On-show hook**: the `frGo` `} else if (step === 6) {` branch (currently just
   `frActions({ label: 'Next', go: () => frGo(7) })`). ADD `frRefreshFeedback()`
   + `frRefreshPing()` in that branch (mirrors step 5's `frPaintSubscription()`),
   so the switches reflect persisted state on show.
3. **Next**: reuses the shared `#fr-next` via `frActions` in the step-6 branch.
   No S6-specific control, no gate (Next always enabled -> Success/7).

## The behavior JS (apply onto Renet's markup)

Toggle = flip `aria-checked` "true"<->"false" (Mona's CSS renders it); click AND
Space/Enter must toggle. On toggle, PUT the backend and reflect. Both backends
default ON (verified: feedbacksend + `engine/ping.js:75` ENOENT->on:true), so a
fresh install shows both ON.

```js
/* PR-C2 (#2037 + #2020): behavior for install-flow Screen 6's two consent
   switches. Renet's markup is static spans (#fr-s6-feedback / #fr-s6-createping,
   role=switch, aria-checked). Same backends as the Settings switches
   (/api/feedback-setting, /api/ping-setting); both default ON, these are the
   install-time opt-out. Bound at top level because the spans exist from first
   paint. */
function frSwOn(el) { return el.getAttribute('aria-checked') === 'true'; }
function frSwSet(el, on) { el.setAttribute('aria-checked', on ? 'true' : 'false'); }

let FR_FB_EPOCH = 0, FR_FB_SAVING = false;
async function frRefreshFeedback() {
  const el = document.getElementById('fr-s6-feedback'); if (!el) return;
  const mine = ++FR_FB_EPOCH;
  try {
    const res = await fetch('/api/feedback-setting');
    if (!res.ok) return;                       // could-not-read: leave the default-ON markup position
    const r = await res.json();
    if (mine === FR_FB_EPOCH && typeof r.on === 'boolean') frSwSet(el, r.on);
  } catch { /* leave the default */ }
}
async function frFeedbackToggle() {
  const el = document.getElementById('fr-s6-feedback'); if (!el || FR_FB_SAVING) return;
  FR_FB_SAVING = true; const mine = ++FR_FB_EPOCH;
  const next = !frSwOn(el);
  frSwSet(el, next);                            // optimistic; revert if the PUT fails
  try {
    const res = await fetch('/api/feedback-setting', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: next }) });
    const body = await res.json().catch(() => ({}));
    if (mine !== FR_FB_EPOCH) return;
    if (!res.ok) { frSwSet(el, !next); return; }
    if (typeof body.on === 'boolean') frSwSet(el, body.on);
  } catch { if (mine === FR_FB_EPOCH) frSwSet(el, !next); }
  finally { FR_FB_SAVING = false; }
}

let FR_PING_EPOCH = 0, FR_PING_SAVING = false;
async function frRefreshPing() {
  const el = document.getElementById('fr-s6-createping'); if (!el) return;
  const mine = ++FR_PING_EPOCH;
  try {
    const res = await fetch('/api/ping-setting');
    if (!res.ok) return;
    const r = await res.json();
    if (mine === FR_PING_EPOCH && typeof r.on === 'boolean') frSwSet(el, r.on);
  } catch { /* leave the default */ }
}
async function frPingToggle() {
  const el = document.getElementById('fr-s6-createping'); if (!el || FR_PING_SAVING) return;
  FR_PING_SAVING = true; const mine = ++FR_PING_EPOCH;
  const next = !frSwOn(el);
  frSwSet(el, next);
  try {
    const res = await fetch('/api/ping-setting', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: next }) });
    const body = await res.json().catch(() => ({}));
    if (mine !== FR_PING_EPOCH) return;
    if (!res.ok) { frSwSet(el, !next); return; }
    if (typeof body.on === 'boolean') frSwSet(el, body.on);
  } catch { if (mine === FR_PING_EPOCH) frSwSet(el, !next); }
  finally { FR_PING_SAVING = false; }
}

// Static spans -> bind once at top level. Click + Space/Enter (role=switch a11y).
(function bindS6Switches() {
  const wire = (id, fn) => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fn(); } });
  };
  wire('fr-s6-feedback', frFeedbackToggle);
  wire('fr-s6-createping', frPingToggle);
})();
```

And in `frGo`'s step-6 branch (Renet's file), add the two refresh calls:
```js
  } else if (step === 6) {
    frActions({ label: 'Next', go: () => frGo(7) });
    frRefreshFeedback(); frRefreshPing();   // <-- PR-C2 add
  }
```

## Tests -- READY TO APPLY (new file: web.firstrun-consent-prc2.test.js)

Source-grep style, modeled on web.feedback-switch-2037.test.js (page.scriptOf +
page.lift + a codeOnly comment-stripper). `lift` handles `async function`
declarations (my handlers are async function declarations -- liftable). The route
round-trips live in server.test.js and the engine defaults in
feedbacksend.test.js / ping.test.js; this file pins the S6 WIRING those cannot see.
Drop it in verbatim when PR-C2 applies:

```js
'use strict';
/**
 * PR-C2 (#2037 + #2020): install-flow Screen 6 "self-improving" consent switches.
 * Renet's install-flow-9screen ships the Screen 6 MARKUP (two s6-sw pill SPANS,
 * #fr-s6-feedback / #fr-s6-createping, role=switch, aria-checked default-ON). This
 * pins the BEHAVIOR PR-C2 wires in: the toggle handlers flip aria-checked and PUT
 * the existing backends (/api/feedback-setting, /api/ping-setting), bind click +
 * Space/Enter, and the frGo step-6 branch refreshes on show (paints default-ON).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);
function codeOnly(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE = codeOnly(RAW);

test('Screen 6 ships the two consent switches as default-ON role=switch spans', () => {
  assert.match(PAGE, /id="fr-s6-feedback"[^>]*role="switch"[^>]*aria-checked="true"/, 'feedback switch missing or not default-ON');
  assert.match(PAGE, /id="fr-s6-createping"[^>]*role="switch"[^>]*aria-checked="true"/, 'create-ping switch missing or not default-ON');
});

test('Screen 6 carries the signed-off eyebrow, headline and both switch copies', () => {
  assert.match(PAGE, /Self improving/i, 'the eyebrow is missing');
  assert.match(PAGE, /Help make Kosmos work better for everyone/, 'the headline is missing');
  assert.match(PAGE, /Have an agent send a daily report with any bugs or improvement suggestions\./, 'the feedback copy is missing');
  assert.match(PAGE, /Let Kosmos know when you create an agent\./, 'the create-ping copy is missing');
});

test('each toggle handler flips aria-checked and PUTs its own backend', () => {
  const fb = lift('frFeedbackToggle');
  assert.match(fb, /aria-checked|frSwSet/, 'the feedback toggle does not read/flip aria-checked');
  assert.match(fb, /\/api\/feedback-setting/, 'the feedback toggle does not target /api/feedback-setting');
  assert.match(fb, /method:\s*'PUT'/, 'the feedback toggle does not PUT');
  const pg = lift('frPingToggle');
  assert.match(pg, /aria-checked|frSwSet/, 'the ping toggle does not read/flip aria-checked');
  assert.match(pg, /\/api\/ping-setting/, 'the ping toggle does not target /api/ping-setting');
  assert.match(pg, /method:\s*'PUT'/, 'the ping toggle does not PUT');
});

test('each refresh drives the switch from the backend GET, guarding could-not-read (never a false Off)', () => {
  const rf = lift('frRefreshFeedback');
  assert.match(rf, /fetch\('\/api\/feedback-setting'\)/, 'the feedback refresh does not GET the backend');
  assert.match(rf, /aria-checked|frSwSet/, 'the feedback refresh does not set the switch from the read');
  assert.match(rf, /res\.ok/, 'the feedback refresh does not guard a non-ok read');
  const rp = lift('frRefreshPing');
  assert.match(rp, /fetch\('\/api\/ping-setting'\)/, 'the ping refresh does not GET the backend');
  assert.match(rp, /aria-checked|frSwSet/, 'the ping refresh does not set the switch from the read');
  assert.match(rp, /res\.ok/, 'the ping refresh does not guard a non-ok read');
});

test('both switches bind click AND keydown (a role=switch is keyboard-operable)', () => {
  assert.match(PAGE, /'fr-s6-feedback'/, 'the feedback id is not wired in JS');
  assert.match(PAGE, /'fr-s6-createping'/, 'the ping id is not wired in JS');
  assert.match(PAGE, /addEventListener\('click'/, 'no click binding on the S6 switches');
  assert.match(PAGE, /addEventListener\('keydown'/, 'no keydown binding (Space/Enter) on the S6 switches');
  assert.match(PAGE, /'Enter'|' '/, 'Space/Enter is not handled in the keydown binding');
});

test('the frGo step-6 branch refreshes both switches on show (so default-ON paints)', () => {
  const frGo = lift('frGo');
  const s6 = frGo.slice(frGo.indexOf('step === 6'));
  const nextBranch = s6.indexOf('step === 7');
  const branch = nextBranch > -1 ? s6.slice(0, nextBranch) : s6;
  assert.match(branch, /frRefreshFeedback\(\)/, 'frGo step 6 does not call frRefreshFeedback');
  assert.match(branch, /frRefreshPing\(\)/, 'frGo step 6 does not call frRefreshPing');
});
```

Plus a render arm (post-apply, when the shared box is free): extend a firstrun
browser-check to drive to Screen 6 and assert both pills paint ON on a fresh board,
and that toggling one flips its `aria-checked` AND round-trips the backend.

## Contract LOCKED - Option A (Renet + Splinter + Mona, 2026-09-05)

- **Mona (design owner) CONFIRMED A** and corrected her earlier `.toggle` lean: the
  install flow already uses the pill as its switch idiom (S3's `.s3-sw` and S6's
  `.s6-sw` are the identical 38x22 blue pill), so intra-flow consistency (pill)
  beats Settings-tab consistency (`.toggle`). The pill is the Josh-approved mock
  visual AND the flow-consistent choice. Settled.
- **Mona's implementation note (already satisfied by the JS above):** drive
  `aria-checked` from the BACKEND READ (the EPOCH/SAVING/could-not-read treatment),
  not a permanently hardcoded `aria-checked="true"` - so we keep "never a false
  Off" and reflect the real setting, while still painting ON by default on a fresh
  install (ENOENT -> on:true). `frRefreshFeedback`/`frRefreshPing` do exactly this
  (GET -> set aria-checked from `r.on`, EPOCH-guarded; the toggle handlers carry
  SAVING + optimistic-revert).

### Could-not-read handling (resolved)

The Settings switches HIDE on a 403 could-not-read; a static `.s6-sw` pill cannot
hide. My refresh LEAVES the pill at its default-ON markup position on a
could-not-read (non-ok GET or throw). That satisfies "never a false Off" (it never
shows OFF while the engine may be sending - it shows the honest ON default), and
Screen 6 only runs on a fresh LOCAL install board where the GET succeeds anyway.
No distinct could-not-read visual is defined for the pill and none is needed here.

Mona's weakest premise (a role=switch span is as robust as `.toggle`): the wiring
above replicates every `.toggle` semantic on the span (aria-checked, click +
Space/Enter, EPOCH/SAVING/optimistic-revert, PUT). No `.toggle`-specific guarantee
is lost, so no revisit needed.

## Side-flags (separate from PR-C2, already routed to Splinter)

- Stale Settings `#tell-row` "Off by default" copy (create-ping defaults ON now):
  being fixed separately on branch `tell-copy-onbydefault-2020` (Splinter routed it).
- Disclosure copy: resolved by #2309's scrub; Josh's mock-review call.
