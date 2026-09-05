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
