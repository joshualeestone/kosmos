# Install flow: 6 -> 9 screen rework (install-flow-9screen)

Owner: Renet Tilley. Launch-critical. Josh signed off the 9-screen mock 2026-09-05
(spec of record: chaoskosmos-site `design/install-flow-9-screens.html`, branch
install-flow-9screen-mock / installkosmos.com/design/install-flow-9-screens).
Split: Mona builds screen visuals+copy (10 snippets, committed in
Josh-Brain/Projects/kosmos-9screen-build/); Renet builds the shell + gated-Next;
Angel builds Screen 6's two switches only.

## Status (2026-09-05 night)

DONE + committed + pushed (branch install-flow-9screen):
- Seam validated authoritatively (Mona's S1 renders native in #fr-screen-c, no
  clash) - Mona green to roll all snippets (all 10 delivered).
- Gated-Next BACKEND, all three gates, tested:
  - S2 file-access: engine/fileaccessstatus.js + /api/file-access-status (native
    -writer read side, mirrors a11ystatus). Fail-safe until native writer lands.
  - S3 sleep: machine.sleepGate + /api/sleep-status (engine reads pmset -g custom,
    functions at launch, no native writer). Laptop-on-battery GATES (Splinter+Josh
    decided: gate it; laptops waved through on AC-only only if a tester hits it).
  - S3 tmux: reuses existing /api/a11y-status.
  All three share ONE three-answers contract (checkable / verdict / fail-safe).
- Gate-poll FRONTEND helper: designed + harness-verified 10/10 (all gates, every
  verdict, two-gate AND, fail-safe uncheckable-never-blocks-never-false-green,
  denied->granted transition, non-vacuous gen-guard). Code below, ready to inline.

## The seam architecture (LOCKED, verified)

- Mona sends FULL per-screen inner content (eyebrow + h2 + copy + graphics + gate
  rows) as #fr-screen-<letter> container contents. She owns s<N>-* CSS; Renet owns
  fr-*. She never redefines an fr-* rule.
- The new-flow shell RETIRES its persistent #fr-eyebrow/#fr-title for NEW-container
  screens (each snippet owns its eyebrow+h2). The shell manages focus + aria-
  labelledby by targeting the ACTIVE screen's plain <h2> at runtime (assign id +
  tabindex=-1 on enter). Verified: focus + dialog label land on Mona's h2.
- HYBRID for REUSED panes: Model/About-you/Create keep using the persistent
  #fr-eyebrow/#fr-title (their bodies are untouched wired panes). So frGo shows the
  shell head for reused-pane screens, HIDES it for new-container screens.

## Screen map (new order) -> implementation

| # | Screen | Kind | Implementation |
|---|---|---|---|
| S1 | Welcome | NEW container | Mona S1. STAGE the ruled privacy copy here (see below). Button "Get Started". |
| S2 | Access | NEW container + gate | Mona S2. data-gate="file-access". Button "Next" locked. |
| S3 | Automation | NEW container + 2 gates | Mona S3. data-gate="sleep" + "tmux". Next locked until BOTH. |
| S4 | Notifications | NEW container | Mona S4. Button "Next". |
| S5 | Model | REUSE fr-pane-3 | existing model-connect (frPaintSubscription/frPaintOpenai/frConnResume). Button "Next". Skip-connect alt. |
| S6 | Self improving | NEW container | Mona S6 (switches fr-s6-feedback + fr-s6-createping = Angel binds). Button "Next". |
| S7 | Success | NEW container | Mona S7 (dock). Wire fr-s7-showwhere to existing appLocation/reveal handler. Button "Next". |
| S8 | About you | REUSE fr-pane-6 | existing frPaintYou. Button "Next". |
| S9A | Found agents | NEW container | Mona S9a. Populate id="fr-found-agents". Shown only if agents found. Button "Giddy Up". |
| S9B | Create first | REUSE fr-pane-7 | existing frPaintFleet/create. Shown only if none found. Button "Create agent". |

RETIRED panes (not shown in new flow): fr-pane-1 (old Success -> replaced by S7),
fr-pane-2 (old Welcome+privacy -> replaced by S1; privacy staged into S1),
fr-pane-4 (machine-check -> REMOVED, spec has no such screen; its sleep/tmux
concerns are now S3 gates), fr-pane-5 (a11y -> folded into S3 tmux gate),
fr-pane-intro (What-to-expect -> new flow leads with Welcome, no interstitial).
Keep the retired panes' PAINT/wiring functions that reused screens still call
(frPaintYou, frPaintFleet, model connect, appLocation/reveal); only stop SHOWING
the retired panes.

## The ruled privacy copy (NON-NEGOTIABLE: preserve, do NOT drop)

Josh ruled-final 2026-08-17, guardian comment in old fr-pane-2. Three lines:
1. "Your agents live on this computer, and so does everything they write."
2. "They're powered by an AI provider, so your requests are sent to that provider
   to be answered." (Josh's verbatim, ruled FINAL - do not reword.)
3. "No account setup. No email needed."
Splinter ruling 2026-09-05: MUST be preserved through the redesign. PLACEMENT is
Josh's on review (S1/S2/S5, and whether split) - do NOT pre-place or pre-split.
=> Stage all three lines in the S1 container in a clearly-marked, preserved block
(e.g. a commented/hidden staging block or under the headline pending his call),
so nothing is lost and he places it when he reviews the built flow.

## S9A / S9B conditional (Mona's note + spec)

If agents were found on this computer -> show S9A (found list, Add per row, Added
state, "Giddy Up" -> Agents dashboard). If none -> skip S9A, show S9B (today's
create-first). NEVER both. Reuse the existing found-agents/fleet detection that
fr-pane-7 already drives.

## Gate-poll helper (PROVEN 10/10 - inline verbatim into the first-run <script>)

Endpoints: file-access->/api/file-access-status (granted), sleep->/api/sleep-status
(prevented), tmux->/api/a11y-status (trusted). A row is GREEN (data-granted) ONLY
on a measured grant; #fr-next disabled ONLY when some row is measured-not-granted
(uncheckable never blocks, never shows false green). Generation-guarded.

```js
const FR_GATES = {
  'file-access': { url: '/api/file-access-status', granted: (r) => r.granted === true },
  'sleep':       { url: '/api/sleep-status',       granted: (r) => r.prevented === true },
  'tmux':        { url: '/api/a11y-status',        granted: (r) => r.trusted === true },
};
let FR_GATE_GEN = 0, FR_GATE_TIMER = null;
function frGateStop() { FR_GATE_GEN += 1; if (FR_GATE_TIMER) { clearInterval(FR_GATE_TIMER); FR_GATE_TIMER = null; } }
async function frReadGate(row) {
  const spec = FR_GATES[row.getAttribute('data-gate')];
  if (!spec) return 'uncheckable';
  let r; try { r = await (await fetch(spec.url)).json(); } catch { r = { checkable: false }; }
  if (r && r.checkable === true) return spec.granted(r) ? 'granted' : 'blocked';
  return 'uncheckable';
}
async function frPollGates(screenEl, gen) {
  if (gen !== FR_GATE_GEN) return;
  const rows = Array.from(screenEl.querySelectorAll('[data-gate]'));
  if (!rows.length) return;
  const states = await Promise.all(rows.map(frReadGate));
  if (gen !== FR_GATE_GEN) return;
  let anyBlocked = false;
  rows.forEach((row, i) => {
    if (states[i] === 'granted') row.setAttribute('data-granted', '');
    else row.removeAttribute('data-granted');
    if (states[i] === 'blocked') anyBlocked = true;
  });
  const next = document.getElementById('fr-next');
  if (!next) return;
  next.disabled = anyBlocked;
  if (anyBlocked) next.setAttribute('aria-disabled', 'true'); else next.removeAttribute('aria-disabled');
}
function frGateStart(screenEl) {
  frGateStop();
  const gen = ++FR_GATE_GEN;
  frPollGates(screenEl, gen);
  FR_GATE_TIMER = setInterval(() => frPollGates(screenEl, gen), 1500);
  return gen;
}
```
frGo on entering a gated screen: frActions paints Next enabled (soft-open), then
frGateStart(container). On leaving any screen: frGateStop() (like frA11yStop).
Harness: scratchpad gate-harness.cjs (dev artifact; the permanent guard is a
browser-check against the real flow - add one under docs/browser-checks/).

## Build order (each commit green: node suite + browser-checks)

1. [DONE] backend gates (file-access, sleep) + tests.
2. Add the 7 new #fr-screen-<letter> containers (Mona snippets) into .fr-body,
   privacy staged in S1. Inline the gate-poll helper.
3. Rewrite frGo: screens-config array (id, kind new|reuse, gate kinds, button
   label, paint fn for reuse). Hybrid head (hide shell head on new containers,
   focus active h2). Gate lifecycle (start on enter S2/S3, stop on leave).
4. Wire hooks: fr-s7-showwhere -> reveal handler; S9A/S9B conditional; leave
   fr-s6-* switches for Angel.
5. Browser-checks: extend render-first-run pattern for the 9 screens + a gated-
   Next check (deep-link each screen; assert gate rows + #fr-next). Honor the
   #1720 web/ gate (browser-check or Browser-check: trailer).
6. Full node suite + challenge-loop + PR. Ping Splinter for Angel's S6.

## Decisions (decide-and-continue, recorded)

- file-access via native-written-file, not engine probe (DENIED arm unobservable
  on a Full-Disk-Access box).
- sleepGate reuses sleepCheck parsing (no second definition).
- Machine-check step (old fr-pane-4) REMOVED - not in the signed-off spec.
- Gate green = measured-grant only; Next-enabled = fail-safe (uncheckable never
  blocks). Two separate conditions ("the lie is the position, not the presence").
