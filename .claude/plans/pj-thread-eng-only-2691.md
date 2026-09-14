# #2691 - remove the stray "Talk to one of them" block below the project dialog

## The card
Josh, design channel 2026-09-10, screenshot dialog-cruft-talk-to-one-of-them-2026-09-10.png:
> Still getting this weird stuff below the regular dialog box. Starting with and including
> "Talk to one of them," every message goes to the one agent you pick ... With the hide link,
> with the dropdown that says Johnny Cage and all of the text from Johnny Cage, which says
> "not waiting," clear it. You have not sent Johnny Cage anything from here. Type a message,
> send. All of that needs to go away. I don't know why it appears on some projects sometimes.

The block below the room composer is `#pj-thread` ("Talk to one of them"): heading + Hide link
+ explainer + agent picker (`#pj-thread-who`) + the waiting-agent question panel (`#pj-question`)
+ the message log (`#pj-msgs`) + a one-to-one composer (`#pj-say`/`#pj-send`).

## Why it "appears on some projects sometimes" (the real gate)
`pjApplyEngMode()` (web/index.html), the one derivation of the #370 fold:
```
box.hidden = !ENG_ON && (!asking || PJ_THREAD_HIDDEN);
```
`ENG_ON` defaults false. So in the DEFAULT (Engineering-off) view the block is shown ONLY when
an agent on that project is waiting on an answer (`asking`) and the person has not dismissed it.
That asking-override was added by #2575/#2146 as an anti-false-calm surface (so a waiting agent
is never silently dropped). "Some projects sometimes" = exactly the projects with a waiting agent.
The screenshot confirms it: Johnny Cage is waiting; Sub-Zero shows "Needs you" in the roster.

## Decision
Josh saw the asking-override surface and ruled "all of that needs to go away." So #2691 walks
back the Off-mode asking-override. I gate `#pj-thread` to **Engineering mode only**:
```
box.hidden = !ENG_ON;
```
In default mode the block never appears (neither the box nor the `#pj-thread-show` breadcrumb,
which existed only to restore a dismissed Off-mode asking-box). Engineering mode keeps the full
picker/question/answer path per #370 (Josh 2026-08-23: "leave it ... if engineering mode is on").

### What Off mode keeps, and the one affordance it moves (corrected after challenge iter 4)
The two surfaces a waiting agent NEEDS are preserved in Off:
- The needs_you **signal** still shows in the member roster: the "Needs you" status line plus
  the #2699 red warning triangle on the agent avatar.
- The **answer path** survives in the DETAIL view: `#d-qask` (the agent's own page question panel)
  is visible in Off mode and is how the number is typed. Proven independently by
  render-engmode-gate-2131.js ARM 3 and render-thread.js:431-439 ("the answer button lands on the
  agent's own page, which is where its question is"). The "Needs you" roster card carries an
  `.ansgo` ("See the question") button into that detail view.

One affordance that lived ONLY inside `#pj-thread` DOES become Engineering-only, and my first draft
overclaimed "loses no function" by omitting it: the **"Not waiting? Clear it"** control
(`#pj-question-clear` -> `pjClearState`, the sole `clear-selfreport` caller) that clears a STALE
needs_you (an agent that self-reported needs_you, resumed work, and never self-cleared). The detail
view offers answer + Trust&Restart but no stale-clear, so in the default view a stale flag now stays
until the agent self-clears or an engineer clears it. That is an OVER-report ("Needs you" shown a
little too long), never a false-calm, so it degrades in the SAFE direction. It is intended: Josh
named this control in the same #2691 message ("which says 'not waiting,' clear it"). So the room
`#pj-thread` Off surface was redundant for the signal and the answer, and its one non-redundant
affordance (stale-clear) was one Josh explicitly asked to remove from the default view.

### What I rejected
- Removing `#pj-thread` in ALL modes: contradicts #370 (engineers keep the one-to-one box on
  purpose). Gating Off-only honors both #2691 and #370.
- Trimming only the chrome (heading/explainer/picker/Hide/"not sent yet") but keeping the room
  question+composer in Off: Josh's enumeration named the composer and the question text too, so
  the whole room surface is what he pointed at. Kept as the documented alternative if I misread.
- (Superseded during implementation.) I first planned to LEAVE the Hide/dismiss machinery as
  vestigial (minimal change). I changed course and REMOVED it fully -- the head "Hide" button, the
  `#pj-thread-show` breadcrumb, the `PJ_THREAD_HIDDEN` flag, both click handlers, and their CSS --
  because with the Off surface gone the dismiss has no live purpose in any mode (the Hide button was
  ALREADY a no-op in Engineering mode, box always shown when ENG_ON), it left a write-only
  `PJ_THREAD_HIDDEN` (dead code), and Josh's #2691 message named "the hide link" for removal. The
  "Not waiting? Clear it" STATE-clear control is KEPT (it is a distinct engine-backed feature),
  now reachable in Engineering mode. This is what shipped; see the Change set below.

## Change set
1. `web/index.html` `pjApplyEngMode()`: gate `box.hidden = !ENG_ON;` and drop the now-unused
   `q`/`asking` locals and the whole breadcrumb block (nothing else in the function uses them).
   Then remove the dismiss machinery outright: the `#pj-thread-hide` (Hide) and `#pj-thread-show`
   (breadcrumb) markup, their `.pj-thread-hide`/`.pj-thread-show` CSS, the `PJ_THREAD_HIDDEN`
   declaration, and both click handlers. Reconcile the sibling comments (#370 header, the
   `pjApplyEngMode` header, the `#pj-answer-how` note, the pj-clear-state test header) so none
   still describes the removed Off-mode behavior.
2. `web.fold-boxes.test.js`: rewrite the truth-table to assert the NEW behavior - Off hides the
   box whether or not an agent is asking; Off never shows the breadcrumb; ENG shows the box. Keep
   the #370 base assertion (Off folds to one composer) and re-document the #2691 walk-back + the
   detail-view successor surface. Keep the toggle-re-derivation pin (unaffected).
3. `docs/browser-checks/render-thread.js`: rewrite the Off-mode arm (the `#pj-thread` fold-override
   block) to assert the box is HIDDEN in Off even with a question open, that the room composer
   (`#pj-post`) is the one standing, and that the detail-view answer path (`#d-qask`) is reachable
   in Off (already driven at 431-439). All ENG-ON sections (from the eng-flip onward) are
   unchanged - they still drive `#pj-thread`.
4. Reconcile the browser-check wiring guards (reason-grep counts, README rows, browser-checks.sh)
   only if the assertion count / registration changes trip them - render-thread is already indexed,
   so no NEW registration is expected.

## Verification
- New/updated hermetic checks proven can-fail (perturb the gate the other way and watch the arm go
  red before trusting green).
- `web.fold-boxes.test.js`, `web.pj-clear-state-2575.test.js` (references `#pj-thread-hide` markup,
  still present; PJ_QUESTION_AGENT unchanged), and the full 6g suite green.
- render-thread.js run against its fixture thread-server, all assertions green + screenshots.
- Web-change browser-check gate (#1720): a Browser-check trailer / docs assertion.

## Weakest premise
That Josh wants the room surface gone even while an agent is waiting, rather than only the chrome
around it. His enumeration named every element (composer included), so I read it as the whole room
surface. If he wanted the room answer-composer kept in Off, this is wrong and the fix is to trim
only the chrome instead. One sentence from Josh swaps it; flagged to Splinter as a Decided FYI.

Browser-check: render-thread.js (Off-mode fold arm rewritten), render-engmode-gate-2131.js.
