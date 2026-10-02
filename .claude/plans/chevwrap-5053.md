# chevwrap-5053: a long project name never pushes the Tasks back chevron off the title's line

Card #5053 (found by #5052's Linux measurement; Splinter asked for the fix, 14:01 CDT 2026-10-02).

## Measured
At 390px on a Mac the `.tsk-head` row is 314px; chevron 32 - 4 + 16 gap + title 241 ("1 Task on Five Families") =
285, so 29px spare. Linux: 299px row, 258px title, 302 needed, wraps. A longer name wraps on the Mac too.
render-subback-4586 with a long-name arm ("Five Families Holdings"), on main, on this Mac: red at 390 and 360
(`gap -32, overlapY -16`).

## Change
web/index.html, the Tasks head (#panel-tasks .tsk-head):
- Desktop: the flex row no longer wraps; the title shrinks and wraps inside its own box (min-width: 0,
  overflow-wrap: anywhere); the chevron and "+ New task" keep their size. Looks as before with ordinary names.
- Phone width (max-width: 40rem, the repo's phone breakpoint), Mona Lisa's design call on #5053: a grid. The chevron
  and title share the first row, the title taking the rest of the width; "+ New task" ALWAYS on its own row below,
  left-aligned with the title's text; the chevron top-aligned with the title's first line; the title's line-height
  1.2 (it inherited .panel h2's 20px, set for 15px text, so wrapped lines touched). No column gap: the chevron
  carries its margin, so with the chevron hidden (all projects) the title is not indented.
docs/browser-checks/render-subback-4586.js: a long-name arm at 390 and 360 and the phone-layout rules (below,
left-aligned, chevron at the first line, lines not touching), a 390 control for the all-projects head, the short-name
390 and desktop rules.
docs/browser-checks/mobile-shots.js: a `project-tasks` screen for design shots.
Only one other head uses `.sub-back`: #pj-docs-view .pjtitle, a grid with the chevron in its own column; not changed.

## Decisions (reversible)
- Phone layout per Mona Lisa (#5053): "+ New task" below always (it stays in one place), title full width.
  Earlier version (New task beside a 4-line title) superseded.
- The title's line-height is 1.2 at every width; the desktop head stays one button tall (pinned at 1280).
- The chevron sits at the row's top on desktop and the grid's top on a phone, so beside a wrapped title it marks the
  first line. Weakest premise: the 4px top tolerance holds at larger default font sizes (reasoned by review 3, not run).

## Verification
- render-subback-4586 on this Mac: 44/0 with the fix. CONTROL: the same check on main's CSS, 6 FAILED, exactly the
  new phone arms (separation, chevron top, all-projects head, short-name layout).
- The 12 checks tools/bc-pr-select.js selects (queued on Agent1s).
- Design shots: ~/work/design-shots/kosmos-5053 (project-tasks, tasks; desktop and iPhone 15; light and dark).

## Iterations
### Iteration 1 (opus, blind; it read the committed fix and the uncommitted phone grid): 0 blockers, 2 warnings.
1. The title's 20px line-height (from .panel h2) made wrapped 24px lines touch. Fixed at phone width; pinned.
2. The committed flex version centred the chevron on the whole title block; resolved by the phone grid
   (align-self: start) and the 4px chevron-top assertion.
CONVENTIONs taken: the plan rewritten for the new design; the stale "may wrap" comment. NIT taken: mobile-shots says
"built-in seed". Left: the loose "(right of or below)" arm stays (the per-width rules are stricter).

### Iteration 2 (sonnet, blind): 0 blockers, 1 low warning. Taken.
1. Above 40rem a long title now wraps in its own box (it used to drop to the next line), still at 20px lines, so
   wrapped lines touched at 641-800px or in the narrower consolidated column. Fixed: line-height 1.2 on the title at
   every width. Measured that desktop is not taller: a new 1280 rule (head at most 36px, one button tall) passes on
   the fix and on main. A 700px long-name arm asserts the shared row and untouched lines. Check: 46/0.
Verified by the reviewer: no other rule overrides the grid or placements (the touch min-height on #tsk-new is
compatible); the hidden chevron leaves the title unindented; render-tasks-view-3559's 16-32px gap stays in band.
Left: the loose long-name "(right of or below)" arm; a future third child would auto-place into row 3.

### Iteration 3 (opus, blind): 0 blockers, 2 warnings. Taken.
1. On desktop the chevron was centred on a wrapped title's block (iteration 1's fix was phone-only). Now
   align-self: flex-start. Control: centring it again fails only the new 700 "chevron at the first line" rule.
2. The 700 arm probably never wrapped. It now uses a name long enough to wrap at 700 and asserts it did (h > 36).
CONVENTION taken: the plan's stale line-height decision. NIT taken: the CSS comment names both button heights.
Left: the 390/360 "|chevTop - titleTop| < 24" belt-and-braces (the 4px phoneHead rule is the real one).
Verified by the reviewer: DOM, visual and tab order match; no JS measures the head; 640px exactly gets the grid;
a no-space title breaks at 320; the new-look rules do not touch the head. Check: 48/0.

### Iteration 4 (sonnet, blind): 0 blockers, 0 warnings. CONVERGED.
Verified: iterations 1-3's fixes; flex-start moves the one-line desktop chevron about 1px; the fixture is restored on
every path. Left, with reasons: the 44px touch-tablet row puts the chevron about 4px above a one-line title's centre
(inside tolerance, unasserted); a dead `project.name = LONG` before the 700 block; an unclosed context on a thrown
error (the run fails anyway); the 700 "share the row" name is structurally true under nowrap; "34px" in a comment is
a measured figure.
