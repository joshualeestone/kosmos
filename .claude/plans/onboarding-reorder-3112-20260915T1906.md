# onboarding-reorder-3112 -- move the Model step to position 2

Josh, 2026-09-15 (#3112, with 3 screenshots): the first-run onboarding should choose the
model SECOND, right after Welcome, so a model is connected before the permission/automation
steps ("pick model first so we can push the tmux requests"). Advisor: Angel (firstrun lane,
#2911). She confirmed no collision and gave the nav fix below.

## Scope of THIS branch
ONLY the reorder (the shippable, code-safe half of #3112). The other pieces of #3112/#3113
are DECISION-blocked (not code-blocked) and NOT in this branch:
- #3112 "add 3 tmux folder asks (2d-2f)": Angel's code read shows the premise is likely
  mis-modeled -- the single S2 file-access flow already fires the tmux folder grant (one set of
  prompts attributed to tmux via the responsible-process model), so there is no separate 3-tmux
  set to add. Needs a fresh-Mac observation of the actual prompt text + a Josh product call.
- #3113 tmux-a11y row stuck CHECKING: the up-front trigger was built on a11y-both-2911
  (ca850d0ee) and never merged; remove-vs-keep needs a fresh-Mac TCC.db read. PARKED
  needs-operator; both measurements bundled into the pending P0 clean-Mac session.

## Change (web/index.html)
The panes are fr-pane-1..9 with STABLE ids (browser checks + lib-firstrun-steps find panes by
id; deep links open ?fr-step=N -> fr-pane-N). Only the DISPLAY ORDER changes, not the numbering.
Panes: 1 Welcome, 2 Access, 3 Automation, 4 Notifications, 5 Model, 6 Self-improving, 7 Success,
8 About-you, 9 Your-agents.

1. `frStepSequence()`: return the explicit order `[1, 5, 2, 3, 4, 6, 7, 8, 9]` (Welcome, Model,
   Access, Automation, Notifications, then 6-9). Windows still drops Access(2) + Notifications(4)
   by pane NUMBER, unaffected by the reorder.
2. `frStepAfter(step)`: change from numeric `find(s => s > step)` to SEQUENCE-POSITION-based
   (`indexOf(step)+1` in the sequence), aligning it with `frStepProgress` which already uses
   indexOf. A step not in the display sequence (a Windows-filtered pane via deep link) falls
   back to the next pane by number (pre-#3112 behaviour) so frGo's clamp still lands.
   ⭐ Angel caught this: without it, `[1,5,2,3,4,...]` alone would jump 5 -> 6 (numeric >5) and
   SKIP Access/Automation/Notifications.
3. Route every hardcoded firstrun jump through the sequence, not a numeric literal:
   - pane 6 Next: frGo(7) -> frGo(frStepAfter(6))
   - pane 7 Next: frGo(8) -> frGo(frStepAfter(7))
   - Model pane exits (5 sites: Next when !claudeConnected, the OpenAI Next, Skip-connecting,
     and two "Continue anyway" error arms): frGo(6) -> frGo(frStepAfter(5)) (= Access on macOS,
     Automation on Windows). Also updated the one stale comment referencing frGo(6).
   - About-you (pane 8) advance: frGo(FR_STEP_YOU + 1) -> frGo(frStepAfter(FR_STEP_YOU)).
   Pane 1-4 Next already used frStepAfter; frGo(1) boot is unchanged.

## Verification
- Traversal simulation of the shipped functions: macOS -> [1,5,2,3,4,6,7,8,9]
  (Welcome, Model, Access, Automation, Notifications, Self-improving, Success, About-you,
  Your-agents), MATCH. Windows -> [1,5,3,6,7,8,9] (Access + Notifications dropped).
- Full node suite (`node --test engine/*.test.js *.test.js`, via `yarn test`) green.
  🛑 The step-order GUARD is web.win32-board-copy.test.js (asserts frStepSequence / frStepAfter /
  frStepProgress on BOTH macOS and Windows) and the About-you advance PIN is in server.test.js --
  NEITHER matches the `web.firstrun-*.test.js` glob. An earlier `web.firstrun-*` subset run
  (70 tests) reported green while missing exactly these guards (the bare-glob-runs-a-subset
  hazard); the full suite caught them and both were updated to the new order. Run the FULL suite
  for this change, never the firstrun-* subset.
- No global "step N of M" counter exists (#firstrun step indicators were removed by Josh's
  spec); the s3-step-cap "1 / 2" captions are SUB-steps WITHIN the Automation pane, unaffected.
- #1720 web-change gate: satisfied by a `Browser-check:` commit trailer. The reorder is
  navigation LOGIC (frStepSequence/frStepAfter), guarded by the win32-board-copy node test; the
  panes' markup + ids are unchanged, so there is no new rendered surface a browser-check would
  cover beyond that node coverage.
- HOLD the merge behind 6.68 (ship order stays 6.68-then-onboarding).
