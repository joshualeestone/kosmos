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

## ⭐ KEY ARCHITECTURE CORRECTION (2026-09-05, after reading the test tooling)

DO NOT introduce a parallel `#fr-screen-<letter>` container system. KEEP the
existing `fr-pane-N` numbered model and renumber it to the 9 screens, dropping
Mona's full-content snippets INTO the numbered panes. Why: the whole test +
deep-link toolchain keys on `fr-pane-N` -
- lib-firstrun-steps.js `stepForAnchor` DISCOVERS a step by the anchor's
  `fr-pane-N` ancestor (identity, not index - #1801), so checks AUTO-FOLLOW a
  renumbered pane IF the pane keeps the `fr-pane-N` shape + its content anchor
  (#fr-you, #fr-fleet, #fr-checks...). A `#fr-screen-c` container is invisible to
  this discovery and would strand every check.
- `?fr-step=N` deep link, the crumb "Step N of M", the segments, and
  `paneCount` (segments == numbered-panes - 1 cross-check) all key on fr-pane-N.
So: the container is `<div class="fr-pane" id="fr-pane-N">`; Mona's snippet
(eyebrow+h2+copy+graphics+gate rows) is its inner content. The seam typography
works identically (both are inside .fr-body; descendant selectors match - the
#fr-screen-c harness proof carries over verbatim to #fr-pane-N).
- Head model, unified: EVERY pane owns its head now. New-content panes get
  Mona's eyebrow+h2 from the snippet; REUSE panes (Model/About-you/Create) get
  Mona's eyebrow+h2 (from S5/S8/S9b) PREPENDED above their existing wired body.
  The persistent shell #fr-eyebrow/#fr-title is retired (hidden) for all panes;
  frGo focuses the active pane's own <h2> (assign id+tabindex on enter) and
  points aria-labelledby at it.
- Gate rows keep Mona's data-gate markup; the proven gate poll queries within the
  active pane (querySelectorAll('[data-gate]')) - pane id agnostic, so it works
  unchanged whether the container is fr-pane-N or fr-screen-letter.

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

## TEST-INVARIANT LANDMINES (map these fixes UP FRONT - a 6->9 renumber cascades)

The first-run flow is pinned by ~25 test artifacts. Renumbering blind hits the
"blast radius measured from reds is a lower bound" trap (a renumber breaks N
checks, only some go red). Reconcile ALL of these in the same change:

- **docs/browser-checks/lib-firstrun-steps.js** = the CENTRAL step->anchor map
  (`stepForAnchor`) that every render-firstrun-* check deep-links through. Update
  this FIRST; it is the single source the checks share.
- **~15 browser-checks** keyed to steps: render-first-run, render-firstrun-enter
  -2186, render-firstrun-model-continue-2134, render-firstrun-namestep-1994wiz,
  render-firstrun-connect-box-2187, render-firstrun-openai-connectbox-2241,
  render-a11y-gate-2125, render-a11y-copy-1940, render-preflight-2163,
  render-connect-skip, click-first-run, render-sleep-button, import-agent-flow,
  regress-a-night, named-controls. Each asserts content at a specific step.
- **web.firstrun-model.test.js** slices raw markup pane-3..pane-5 to isolate the
  model step -> if panes are renumbered/retired, fix the slice anchors.
- **~10 web.firstrun-*.test.js**: firstrun-a11y-1214, firstrun-enter-2186,
  firstrun-fractions-1835 (the frGo(3.7) clamp), firstrun-you-reach-1772,
  found-every-path-1493, found-undo, connect-confirm, willinstall-behaviour-1556.
- **server.test.js**: stale-id greps (asserts retired ids ABSENT in raw markup) +
  first-run structure. Retiring a pane may need its old id added to a stale guard.
- **tools.browser-checks-wired.test.js + browser-checks-reason-grep.test.js**:
  a NEW browser-check must be wired (runner loop + README index + EXPECTED_SITES
  reason-grep + selectors), per the browser-check wiring guards.
- **#1720 web/ gate**: any web/index.html diff needs a browser-check or a
  `Browser-check: <reason>` commit trailer.
- **Josh rulings to preserve** (not test-pinned but ruled): no Back / no visible
  Skip (fr-acts), the model "show all six rows" (#262/sticky footer), Claude/GPT/
  Gemini order, the Dock line ON Success under reveal (2026-08-27 16:08), the
  privacy copy (above), model-step copy verbatim, OpenAI no-key-promise (#2241).
  The #2163 pre-flight interstitial + old Success (fr-pane-1) are being replaced
  by S7 - confirm with Splinter the interstitial's expectations copy has a home
  (S2 Access "when prompted click Allow" partly covers it; S4 Notifications the
  background-activity part) or is dropped by the spec.

## Decisions (decide-and-continue, recorded)

- file-access via native-written-file, not engine probe (DENIED arm unobservable
  on a Full-Disk-Access box).
- sleepGate reuses sleepCheck parsing (no second definition).
- Machine-check step (old fr-pane-4) REMOVED - not in the signed-off spec.
- Gate green = measured-grant only; Next-enabled = fail-safe (uncheckable never
  blocks). Two separate conditions ("the lie is the position, not the presence").
