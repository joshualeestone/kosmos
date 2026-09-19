# Remove the tmux permission asks from onboarding (client scope)

Josh, 2026-09-19 0.6.81 QA (Discord): the onboarding setup screens should stop asking for
tmux's own permissions. Three specific removals, all tmux-specific; the Kosmos (app) asks stay.

## What Josh asked for

1. **S2 Access screen**: remove the "'tmux' would like to access files" preview box; keep only
   the "Kosmos" preview.
2. **S3 Automation screen**: kill the macOS "Kosmos wants to control System Events" pop-up that
   fires the instant the screen is entered. That pop-up is fired by the register-at-entry call
   `frFireTmuxA11yRegister` (added for #3221). Remove it.
3. **S3 Accessibility**: remove the tmux "Control your computer" row entirely (the Request
   access / Access granted / Turn On affordances), simplifying the screen to the single Kosmos
   Accessibility row.

Josh: "I'm kind of done screwing around with the installer... take it off here completely and
simplify the screen."

## Scope

CLIENT only, in `web/index.html`:
- S2: remove the tmux `.s2-dlg` file-access preview (decorative, aria-hidden). One file-access
  gate and one `/api/file-access-prompt` remain; agents keep folder access via the unchanged
  tmux-attributed grant, so this is cosmetic.
- S3: remove `frFireTmuxA11yRegister` + its S3-entry call (the System Events pop-up trigger); the
  tmux mock switch row, its `.s3-sw-open` overlay, and the `data-gate="tmux-a11y"` gate row; and
  the "and tmux" from the step caption.
- Un-gate Next from tmux-a11y. S3 Next-gating is DATA-DRIVEN (`frPollGates` iterates the
  `[data-gate]` rows in the active pane; no config list names tmux-a11y as required), so removing
  the DOM row IS the un-gate. `FR_GATES['tmux-a11y']` then becomes dead config; `frReadGate`
  returns `uncheckable` for any row whose key is absent, so there is no throw risk in either
  direction (row-without-entry or entry-without-row).
- Simplify `s3PermissionTargets` (drop the dead `gate === 'tmux-a11y'` fallback arm) and `FR_GATES`
  (drop the `'tmux-a11y'` entry).

Tests + browser-checks updated to match (S2 two-preview to one, S3 three-gate to two, register
tests removed, explicit `doesNotMatch` guards that the removed row/mock/switch/caption stay absent).

## Out of scope

The native/server side: `/api/tmux-a11y-prompt` + `spawnTmuxAutomationPrompt`,
`/api/tmux-a11y-status` + `tmuxGrant`, and the engine op behind them become dead client-side once
this lands. Those are Angel's separate native cleanup (#3282, parked needs-release: needs a .pkg
cut, after this web PR lands). This branch drops the only two CLIENT callers (the `FR_GATES` entry
and `frFireTmuxA11yRegister`).

Cross-PR coupling for #3282: two arms in `web.firstrun-a11y-1214.test.js` still read the surviving
`/api/tmux-a11y-status` route on purpose -- the #2559 test (asserts `/api/a11y-status` does NOT
serve `tmuxGrant`) and the repurposed #3113 test (asserts `present:false -> actionable:true` on that
route). When #3282 removes the route + `tmuxGrant`, those arms must be updated or removed or they go
red. STALE NATIVE COMMENTS (a class, not a list): across the ENTIRE native/server side --
`server.js` (both `/api/tmux-a11y-*` route comments), `engine/promptrequest.js`, `main.swift`, and
any other native file -- comments still describe the now-removed client caller
(`frFireTmuxA11yRegister`) as firing "up front on S3 entry", and the `/api/tmux-a11y-*` routes are
now unreached dead code. ALL of these are stale and ALL are #3282's to clean up when it deletes the
routes. This PR does not touch ANY native file, deliberately, so it stays client-only and does not
overlap Angel's #3282 edits. Flagged to Angel.

## Why the register should not keep firing silently

Per Angel + Mona: Apple forces the System Events consent prompt the first time any app scripts
System Events, so a silent background enable is not achievable. And per #2125 the tmux-a11y grant
is optional: the app's own Accessibility grant covers the runtime AX need, and the runtime path
(engine osascript under tmux) acquires whatever is needed at first agent action. So the onboarding
register is dropped, not hidden.

## Verification

- Node tests: `web.firstrun-a11y-1214.test.js`, `web.win32-board-copy.test.js`, `web.tmux-box-1214.test.js`.
- Browser-checks (headless): `render-firstrun-access-onebox`, `render-gated-next`,
  `render-win32-board-copy`, `click-first-run`, `render-permission-slider-2620`,
  `render-firstrun-wizard-flow`, `render-firstrun-stepcap-gear-0640`.
