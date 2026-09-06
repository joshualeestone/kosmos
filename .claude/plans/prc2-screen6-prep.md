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

## Tests (new web.firstrun-consent-2037.test.js, source-grep style)

1. `#fr-s6-feedback` and `#fr-s6-createping` exist as `role="switch"` with `aria-checked="true"` (default ON) -- guards against the markup regressing.
2. The eyebrow "Self improving" and headline "Help make Kosmos work better for everyone" and both toggle copies are present verbatim.
3. `frFeedbackToggle` PUTs `/api/feedback-setting`; `frPingToggle` PUTs `/api/ping-setting`.
4. Both toggles flip `aria-checked` and bind BOTH click and keydown (Space/Enter).
5. `frGo` step-6 branch calls `frRefreshFeedback()` + `frRefreshPing()`.
Plus the render check: extend a firstrun/browser-check to drive to Screen 6 and assert both switches paint ON on a fresh board, and toggling flips them + persists (round-trips the backend).

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
