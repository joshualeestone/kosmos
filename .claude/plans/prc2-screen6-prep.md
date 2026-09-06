# PR-C2 prep: install-flow Screen 6 "self-improving" consent switches (#2037 + #2020)

**Status: PREP ONLY.** This is a ready-to-apply patch, staged here so that the
moment Renet's 9-screen install flow lands on `main`, PR-C2 is a fast apply, not a
from-scratch build. **Do NOT edit `web/index.html` until Renet's flow is merged**
(collision rule: she owns the flow structure in `web/index.html`).

Routed by Splinter (2026-09-05, from Josh's signed-off mock). Both backends already
shipped (feedback #2037 via #2301/#2309; create-ping #2020 via #2283), so this is
UI + wiring + tests only, no engine work.

## Spec (Josh's signed-off mock, via Splinter)

- eyebrow: `SELF IMPROVING`
- headline: `Help make Kosmos work better for everyone`
- toggle 1 (switch, default ON): `Have an agent send a daily report with any bugs or improvement suggestions.` [#2037 feedback]
- toggle 2 (switch, default ON): `Let Kosmos know when you create an agent.` [#2020 create-ping]
- bottom button: `Next`
- Both are SWITCHES (not checkboxes), both default ON.

## Grounding (verified against origin/main at prep time)

- **Both backends default ON**: `/api/feedback-setting` (feedbacksend.read ENOENT -> on:true) and `/api/ping-setting` (ping.read ENOENT -> on:true, `engine/ping.js:75`). Unreadable -> off (the safe direction). So a Screen 6 switch reading either backend paints ON on a fresh install.
- **Existing Settings switches to mirror** (web/index.html): `#feedback-toggle` (feedbackPaint / refreshFeedback / feedbackToggleClick, `/api/feedback-setting`) and `#tell-toggle` (tellPaint / refreshTell / tellToggleClick, `/api/ping-setting`). Shared helper `paintSwitch(togId, on)` (on===null -> hidden + aria stripped; the could-not-read state). Both carry an EPOCH counter (stale-fetch guard) + a SAVING guard + the privacy "could-not-read, never a false Off" treatment.
- **Switch markup pattern**: `<div class="setrow" id="X-row"><div><b>title</b><p class="dhint">sub</p></div><button class="toggle" id="X-toggle" role="switch" aria-label="..." hidden><i></i></button></div>`.
- **Install flow (`#firstrun`)**: `.fr-body` screens with `p.fc-eyebrow`, `h2`, `.fr-segs`/`.fr-seg` progress, `.fr-acts` actions row + `#fr-next`. Step counter `#fr-step` ("Step 1 of 6" today; Renet is expanding to 9). CSS scoped to `#firstrun`.

## The Screen 6 CONTENT markup (to drop into Renet's Screen 6 `.fr-body`)

Uses `fr-`-prefixed ids so it never collides with the Settings switches. The
`.setrow`/`.toggle`/`.dhint` classes already exist; verify they render acceptably
inside `#firstrun .fr-body` (they inherit the wizard's `#firstrun` scoping) or add
a scoped rule.

```html
<p class="fc-eyebrow">SELF IMPROVING</p>
<h2>Help make Kosmos work better for everyone</h2>
<div class="setrow" id="fr-feedback-row">
  <div><b>Have an agent send a daily report with any bugs or improvement suggestions.</b></div>
  <button class="toggle" id="fr-feedback-toggle" role="switch" aria-label="Send a daily product-feedback report" hidden><i></i></button>
</div>
<div class="setrow" id="fr-ping-row" style="margin-top:12px;">
  <div><b>Let Kosmos know when you create an agent.</b></div>
  <button class="toggle" id="fr-ping-toggle" role="switch" aria-label="Let the Kosmos team know when you create an agent" hidden><i></i></button>
</div>
<p class="dhint" id="fr-consent-msg" role="status" style="margin:10px 0 0;"></p>
<!-- The Next button is Renet's flow's advance control (#fr-next or her Screen-6
     equivalent); this screen adds no button of its own. -->
```

## The JS wiring (mirror of the Settings switches, targeting the fr- ids)

Reuses `paintSwitch` and the exact could-not-read / EPOCH / SAVING treatment. When
Renet's flow SHOWS Screen 6, it must call `frRefreshFeedback()` and `frRefreshPing()`
so the switches paint from the live backend (both default ON).

```js
/* PR-C2 (#2037 + #2020): the install-flow Screen-6 copies of the two consent
   switches. Same backends as the Settings switches (/api/feedback-setting,
   /api/ping-setting), same could-not-read-never-a-false-Off treatment; both
   default ON, and these switches are the install-time opt-out. Separate ids
   (fr-*) so the two live independently of the Settings row. */
let FR_FEEDBACK_EPOCH = 0, FR_FEEDBACK_SAVING = false;
function frFeedbackPaint(r) {
  const unread = !r || r.ok === false || typeof r.on !== 'boolean';
  paintSwitch('fr-feedback-toggle', unread ? null : r.on === true);
}
async function frRefreshFeedback() {
  const mine = ++FR_FEEDBACK_EPOCH;
  try {
    const res = await fetch('/api/feedback-setting');
    if (!res.ok) { if (mine === FR_FEEDBACK_EPOCH) frFeedbackPaint(null); return; }
    const r = await res.json();
    if (mine === FR_FEEDBACK_EPOCH) frFeedbackPaint(r);
  } catch { if (mine === FR_FEEDBACK_EPOCH) frFeedbackPaint(null); }
}
async function frFeedbackToggleClick() {
  if (FR_FEEDBACK_SAVING) return; FR_FEEDBACK_SAVING = true;
  const mine = ++FR_FEEDBACK_EPOCH;
  const msg = document.getElementById('fr-consent-msg');
  try {
    const on = document.getElementById('fr-feedback-toggle').getAttribute('aria-checked') !== 'true';
    const res = await fetch('/api/feedback-setting', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
    const body = await res.json().catch(() => ({}));
    if (mine !== FR_FEEDBACK_EPOCH) return;
    if (!res.ok) { if (msg) msg.textContent = body.error || 'We could not save that setting.'; return; }
    frFeedbackPaint(body);
  } catch { if (msg) msg.textContent = 'We could not save that setting.'; }
  finally { FR_FEEDBACK_SAVING = false; }
}

let FR_PING_EPOCH = 0, FR_PING_SAVING = false;
function frPingPaint(r) {
  const unread = !r || r.ok === false || typeof r.on !== 'boolean';
  paintSwitch('fr-ping-toggle', unread ? null : r.on === true);
}
async function frRefreshPing() {
  const mine = ++FR_PING_EPOCH;
  try {
    const res = await fetch('/api/ping-setting');
    if (!res.ok) { if (mine === FR_PING_EPOCH) frPingPaint(null); return; }
    const r = await res.json();
    if (mine === FR_PING_EPOCH) frPingPaint(r);
  } catch { if (mine === FR_PING_EPOCH) frPingPaint(null); }
}
async function frPingToggleClick() {
  if (FR_PING_SAVING) return; FR_PING_SAVING = true;
  const mine = ++FR_PING_EPOCH;
  const msg = document.getElementById('fr-consent-msg');
  try {
    const on = document.getElementById('fr-ping-toggle').getAttribute('aria-checked') !== 'true';
    const res = await fetch('/api/ping-setting', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
    const body = await res.json().catch(() => ({}));
    if (mine !== FR_PING_EPOCH) return;
    if (!res.ok) { if (msg) msg.textContent = body.error || 'We could not save that setting.'; return; }
    frPingPaint(body);
  } catch { if (msg) msg.textContent = 'We could not save that setting.'; }
  finally { FR_PING_SAVING = false; }
}
document.getElementById('fr-feedback-toggle').addEventListener('click', frFeedbackToggleClick);
document.getElementById('fr-ping-toggle').addEventListener('click', frPingToggleClick);
```

## Tests (model on web.feedback-switch-2037.test.js + web.firstrun-*.test.js)

A new `web.firstrun-consent-2037.test.js` should statically assert (these files are
source-grep tests, not runtime DOM):
1. The page carries `id="fr-feedback-toggle"` and `id="fr-ping-toggle"` as `role="switch"`.
2. The eyebrow `SELF IMPROVING` and headline `Help make Kosmos work better for everyone` are present.
3. Both toggle copies are present verbatim.
4. `frFeedbackToggleClick` PUTs `/api/feedback-setting` and `frPingToggleClick` PUTs `/api/ping-setting`.
5. Both paint via `paintSwitch` and use the could-not-read (`unread -> null`) treatment (no false Off).
6. Screen 6 is refreshed on show: whatever hook Renet's flow exposes calls `frRefreshFeedback()` + `frRefreshPing()`.
Plus a `browser-test`/render check (Screen 6 renders, both switches paint ON on a fresh board) once the flow exists.

## What I need from Renet's flow (FLAG to Splinter)

The prep above is self-contained EXCEPT three integration points that belong to her
flow structure. I need these before the fast-apply:
1. **The Screen 6 panel container** in her sequence (id / how the screen is defined) so I drop the content into the right `.fr-body`.
2. **The "on show Screen 6" hook** so `frRefreshFeedback()` + `frRefreshPing()` fire when the screen appears (mirrors how the Settings switches refresh on the Settings tab opening).
3. **The Next-button** on Screen 6 (is it `#fr-next` reused, or a Screen-6-specific control?) so nav wiring is correct.
4. Coordinate the exact S6 surface with Mona's signed-off mock (#102).

## Flags raised (separate from PR-C2)

- **Stale Settings copy**: the Settings `#tell-row` sub-copy still says create-ping is "Off by default", but `/api/ping-setting` now defaults ON (#2020/#2283, verified `engine/ping.js:75`). That is a Settings-copy fix, not PR-C2 — flag for whoever owns the Settings ping row.
- **Disclosure line**: my #2037 report-revision (#2309) already scrubs project/agent/user names + adds the in-prompt no-identifiers rule, so the earlier "report body keeps names" disclosure concern is largely resolved. Any Screen-6 disclosure copy is Josh's mock-review call, not mine to write.
