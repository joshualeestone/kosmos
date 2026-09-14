# #3075 Never Sleeps: one Accessibility box with both Kosmos and tmux switches

Branch: `s3-a11y-onebox-3075` off `origin/main` @ cceb2e3b (includes Angel's #2911).
Card: #3075 (canonical onboarding-permissions tracker; the design half was #3032, now
closed/collapsed into #3075). Milestone 0.6.66. Owner of the design/copy + S3 sub-step
order: Mona Lisa. Owner of the engine (gate logic + routes): Angel.

## What "finished" looks like
The Never Sleeps (Automation / S3) screen shows ONE macOS "Accessibility" mock window with
BOTH rows -- "Kosmos / Control your computer" and "tmux / Control your computer", each with a
switch -- under one caption "2 - when prompted, switch Kosmos and tmux to On", mirroring the
real macOS Accessibility list (which shows both apps in a single list). Angel's engine is
untouched and still binds. Every test/browser-check that pinned the old shape is updated and
green.

## The call I made
Josh's #3032 words: "add a second 'tmux controls your computer' switch RIGHT UNDER Kosmos in
that box, both switches animating on, and change the line to 'Kosmos and tmux not activated,
turn on.'" Angel's #2911 (engine) landed the tmux grant as a SECOND, separate Accessibility
mock window (step 2 Kosmos, step 3 tmux). That is functionally correct but is not the one-box
design Josh asked for. So I consolidated the two mocks into one window with both rows, folded
the two captions into one, and kept the Energy/sleep mock separate (it is a different Settings
pane).

I kept TWO separate status rows (data-gate="tmux" = the app grant, data-gate="tmux-a11y" =
the bundled tmux grant), NOT one combined status line, even though Josh's phrasing suggested a
single line. Reason: the two grants are toggled one at a time, so a single line cannot honestly
show "Kosmos on, tmux still off." The screenshot of the mixed state (Kosmos ACTIVATED green /
tmux NOT ACTIVATED red) confirms this reads correctly. The combined INSTRUCTION he asked for
lives in the caption; the honest per-grant confirmation lives in the two rows.

## What I rejected
- Leaving Angel's two-separate-mock build as-is: rejected, it is not the design Josh stated.
- One combined status line "Kosmos and tmux not activated": rejected as literally built,
  because it is dishonest mid-flow (see above). The caption carries the combined wording; the
  status stays per-grant.
- Touching Angel's engine (routes, FR_GATES, gate poll): rejected, out of lane and unnecessary
  -- the poll and overlay sync key off data-sw-gate document-wide, so two switches in one mock
  bind exactly as before.

## Weakest premise
That Josh still wants the one-box design after his later step-reorder message (#1940/#2085,
which moved Model to step 2) and after Splinter's (superseded) "tmux is file-access not
accessibility" note. The canonical #3075 SETTLES that tmux DOES get its own accessibility
grant (screenshot-confirmed, do-not-reverse), which is what Angel built and what this styles.
So the premise holds. If Josh's visual/Photoshop pass wants it back as two windows, this is a
small revert; he can adjust either way.

## What would change my mind
- Josh saying he prefers the two-window layout after seeing it live.
- Any indication the two rows in one mock break the switch-overlay alignment on a real headed
  Mac (the headless browser-check pins the state, not pixel-precise overlay position; that is a
  headed-pass concern).

## Engine-safety proof
- swMirror (frPollGates) = document.querySelector('.s3-sw[data-sw-gate="<gate>"]') -- global,
  exact-match, box-agnostic.
- frSyncSwitchOverlays = each .s3-sw-open finds its switch by data-sw-gate within its .s3-mock;
  both overlay buttons live inside the one shared .s3-mock, each finds its own switch.
- Both data-gate status rows + FR_GATES keys unchanged.

## Files
- web/index.html: merge the two S3 Accessibility mocks into one; combined caption; .s3-body
  becomes a gapped column so two rows read as a grouped list; both status rows kept.
- docs/browser-checks/render-firstrun-stepcap-gear-0640.js: caps count 3 -> 2.
- web.win32-board-copy.test.js: combined caption regex; drop the 2 obsolete keys (caption 3 +
  separate tmux mock) so the data-win-hide count re-balances (13 == 13); MAC_MARKUP caption.
- web.firstrun-a11y-1214.test.js: both the Kosmos-caption and tmux-caption asserts point at
  the combined caption.

## Verification
- Node suite: 7600 tests, 0 fail (bash tools/run-tests.sh, exit 0; #1720 + #2518 gates green).
- Browser-checks (isolated harness): render-gated-next, render-permission-slider-2620,
  render-firstrun-stepcap-gear-0640, render-win32-board-copy all pass.
- Screenshots (both-off + Kosmos-on/tmux-off) confirm the one-box design + honest mixed state.

## Coordination
Heads-up sent to Angel before taking the region; she confirmed no overlap (#2911 merged, her
next build is paintTalk/server.js, not S3) and named the 3 assertions to update (all done).
After merge: send Angel the final placement.
