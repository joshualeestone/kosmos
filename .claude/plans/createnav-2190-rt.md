# #2190: Create advances to the progress screen, not 'Making it' inline

## What "done" looks like
Clicking Create navigates to the `cstep('made')` progress screen (K-mark + step list) instead of
showing "Making it…" beside the form on the create screen. A network error, a refusal, or any
non-created answer routes BACK to the create screen so the message lands beside the field.

## The fix (web/index.html create-go handler)
- On click, after validation (role + label) and `CREATING = true`: `cstep('made')`, set `made-head`
  = `name ? 'Making '+name : 'Making it'`, hide made-warn/hello/look/retry, clear `made-ticks`, and
  `if (MADE_MARK && MADE_MARK.finish) MADE_MARK.finish(); MADE_MARK = startKLoader(...)`. (The
  finish-before-start prevents a retry leaking a second animation loop -- `startKLoader` has no hard
  stop, only `finish`.) The old inline `msg.textContent = 'Making it…'` is gone.
- The three failure return paths (network-error catch, `outcome==='refused'`, non-ok/other) each first
  `if (MADE_MARK && MADE_MARK.finish) MADE_MARK.finish(); MADE_MARK = null; cstep('name');` and then
  set `msg.textContent` -- so the message is beside the field, not on the screen we advanced to.
- The success path no longer re-does `cstep('made')`/heading/hide-resets/`startKLoader` (all moved to
  the click block); it keeps `revealMade(result)`. The completion watch still calls
  `MADE_MARK.finish()`.

## Verification
- Hermetic browser-check `docs/browser-checks/render-createnav-2190.js` (loads web/index.html over
  file://, boots no server): stubs `/api/roles` (so `loadRoles`→`pickMode('pm')` sets PICKED and
  validation passes) and `/api/agents` (to control the outcome), fills create-name + create-label,
  clicks Create, waits for the async handler to settle, and asserts: a `created` outcome shows the
  progress screen (made shown, create screen hidden, no inline "Making it…", made-head names the
  agent); a `refused` outcome routes back (create screen shown, progress hidden, the message beside
  the field). Run with the pinned runtime headless:
  `NODE_PATH=/Users/agent1/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-createnav-2190.js`
  → passes. Perturbation-verified (reverting the click nav fails it).
- Full browser-checks + suite (a web/index.html change trips the browser-check gate chain) + a
  challenge-loop before PR.

## Parked residual (Splinter agreed)
The K-loader ANIMATION visual quality (does the mark look right animating) is Josh's in-app review;
the check asserts the loader is started-on-nav / finished-on-error as STATE, not pixels.

## Notes
- Render-only/hermetic, NOT interactive-live-app: runnable headless via the pinned Playwright runtime,
  no claude-fe. (Earlier mis-parked needs-browser; corrected.)
- No em dashes. Merge on green, no reviewer (Kosmos beta).

## Adoption note (Renet Tilley, night shift 2026-09-05)

Splinter routed #2190 to me after Angel built it (branch `createnav-2190`, worktree
preserved) but stopped at ~89% context WITHOUT merging, to avoid dying mid-challenge-loop.
Her fix is built, hermetically verified, perturbation-proven, and iteration-1-reviewed (a
blind agent found one real regression -- a K-loader RAF leak on walk-away, fixed with a
`dropMyLoader()` helper keyed on `MADE_MARK === myMark` so it finishes only this attempt's
loader -- plus two NITs, all fixed). I ADOPTED her branch (created `createnav-2190-rt` from
its tip and rebased onto current green main; clean, the nav change is disjoint from the
churn since her base) rather than rebuild.

REMAINING when adopted, and the gating question Splinter set (Step 1): the full
browser-checks.sh on Angel's ~10-behind checkout showed 2 reds NEITHER hers --
`render-accounts-openai` (the OpenAI account/model menu) and `render-create-form` (the
create-form layout). #2190 touches ONLY the create-go NAV handler; a grep of this branch's
web/index.html diff for account/create-form/model-menu markup is EMPTY, so those surfaces
are untouched. Per the stale-worktree class, they must be baselined on a CLEAN origin/main
before merge: if they fail there too they are pre-existing (merge #2190 on its own green);
if they pass on clean main but fail here, investigate (implausible given scope). That
baseline + the challenge-loop's browser gate are HELD during Splinter's browser-quiet
window (he is sequencing a 6.35 re-cut against render-tier browser contention); resumed the
moment he lifts it.
