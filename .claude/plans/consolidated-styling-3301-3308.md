# Consolidated-view polish batch #3301-3308

Owner: Angel (delivery). Built by Mona Lisa on `consolidated-polish-3301`; Splinter moved the
cards to `claimed:angel` so Mona stays on the federation UI (#3312) critical path. My job is to
verify, run the pre-PR challenge loop, and ship the PR - NOT rebuild.

## Provenance / how this branch was formed
Mona's branch was stacked on the now-merged messages-filter base (its parent `8f01ed27` is an
ancestor of current main). I cherry-picked ONLY her polish commit `f73c8104` onto current main
(HEAD `7254b7c9`) - it applied with ZERO conflicts. So this PR is polish-only against current main,
not a re-application of messages-filter. Result: commit `0efa9bd1`.

## The 8 items (all in web/index.html; verified against the cards + Josh's screenshots)
- **#3301** agent-message sound: `ringNewAgentMessages(data.agents)` added in `tick()`, plus the new
  function - mirrors `ringNewMessages` (per-agent unread rise detection vs a KNOWN prior, silent
  first-load baseline, master-toggle + DND gating, `BUBBLE_LAST` 250ms coalescing so a project + an
  agent message in one tick make ONE pop, open-thread `CURRENT` excluded, null=unknown carried).
- **#3302** popover close on view switch: the `#userpop` outside-click handler now `close()`s on a
  `[data-layout-switch]` click inside the menu; Appearance still leaves it open.
- **#3303** center the + glyph + baseline: `.fold` (agents/projects rail +) gets
  `inline-flex/center/center`; the Tasks `#pj-newtask` gets `align-self: center` + `margin: 0` (was
  top-aligned ~3-4px high).
- **#3304** Tasks header order: grid `minmax(0,1fr) auto auto`; label col 1 (flush-left), View All
  col 2, + col 3 (far right). Matches the "Should be" screenshot exactly.
- **#3305** gutter: `.pj3` gets `column-gap: 0` (was base 16px), closing the chat<->rail strip;
  row-gap left to base so Tasks/Files vertical spacing is unchanged.
- **#3306** Files: `all.textContent = 'View All'` (count dropped; total still lives on the all-files
  screen the door opens) + `#pj-docs-msg:empty { min-height:0; margin:0 }` so the listing rises to
  the header when files are present.
- **#3307** tasks scroll behind divider: `.pj3 > aside.pjcol:not(.pjsplit) { margin-bottom: 0 }` so
  the task list fills to the divider and its overflow scrolls behind the rule.
- **#3308** section grounds: `--k-side (#f3f1ec)` -> `--k-bg (#faf9f7)` on #alist, #rail-agents,
  #rail-projects, .pj3. Confirmed `--k-bg` IS the top-header ground (`.apphead { background:
  var(--k-bg) }`, index.html:1167).

## Tests + checks (Mona's, verified legitimate by me)
- Node suite: Mona reported 7909 tests, 0 fail; I am re-running `bash tools/run-tests.sh` to confirm
  on the cherry-picked commit (not just her branch).
- Pin updates are legitimate, NOT weakened: `web.consolidated-match-mock` now pins the exact new
  `--k-bg` value; `web.controls-1303h` rewritten to pin the NEW #3304 order (grid-column 3=+,
  1=label, 2=View All). `web.bubblepop-2407` +82 lines = the new #3301 sound test.
- 2 browser-check assertions in `render-consolidated-layouts.js`, both non-vacuous (verified they can
  return the failing answer): #3304 order via live `getBoundingClientRect` (`plusRightOfViewAll`),
  and #3308 grounds via computed `backgroundColor` compared to `.apphead` (a token rename goes red).

## Verification split
- **Mac-checkable (I run):** node suite green; `render-consolidated-layouts.js` browser-check green
  via pw-runtime headless.
- **Josh in-app confirm (visual):** #3305 (how tight the gutter should be - `column-gap:0` leaves the
  cards' own 12px inset; reversible), #3307 (scroll-behind feel), #3308 (the ground tone reads right),
  the + centering pixels. These are reversible CSS; Josh confirms in-app after the next build.

## Weakest premise
That Mona's #3305 `column-gap:0` closes the gutter to Josh's taste. It removes the 16px base gap but
leaves the rail cards' 12px inset + the `.pjmid` border, so a strip remains. If Josh wants it tighter,
that inset is the next lever - reversible in one line.

## Pre-PR challenge loop — outcomes (blind adversarial review, 1 iteration, converged)
A fresh blind CTO-lens agent reviewed the diff. It surfaced 2 substantive findings + NITs; both
addressed, then re-verified:
- **[BLOCKER] #3304 focus-order (WCAG 2.4.3):** the reviewer noted the DOM keeps + before View All
  while #3304 paints View All left of +. RESOLUTION (decided, documented in code): keep Mona's layout
  (Josh's explicit ask) - the DOM swap does not fix it, it moves a worse VERTICAL focus jump into the
  tab view (the two views want opposite button orders; one DOM order cannot satisfy both). The order
  is meaning-independent (add vs open-all), so it does not fail WCAG 2.4.3. Corrected the stale
  comment that still claimed the DOM-early invariant held.
- **[BLOCKER-verify] #3307 gap:** CONFIRMED by render - Mona's margin-bottom:0 left the base 16px
  row-gap, so the Tasks list clipped ~16-18px short of the divider. FIXED: added row-gap:0 to .pj3.
  Re-measured on a rendered sandbox board: gap is now 2px (the Files card's own margin-top:2px), so
  the list reaches the divider and scrolls behind it per Josh's card.
- NITs (stale shadowed #pj-newtask rule at ~4424; screenshot): the shadow rule is inert (2-ID rule
  wins) and left as-is to minimize changes to tested code; screenshot captured (below).
- STRENGTHS confirmed by the reviewer: ringNewAgentMessages is a faithful correct twin; #3302 popover
  scoping is precise; #3306 mechanism sound; all new/updated assertions non-vacuous; house style clean.

## Final verification
- Node suite (bash tools/run-tests.sh): green - the only red was engine/create.test.js timing out
  under machine load (spawnSync ETIMEDOUT); it touches zero of my files and passes ALONE (rc=0).
- Surface gate: green with the Browser-check-surface: render-alltasks.js trailer.
- Browser-checks (bash tools/browser-checks.sh): render-consolidated-layouts PASS, render-alltasks
  PASS (21 assertions), render-tasks / render-bubblepop-2407 (#3301) / render-tophead-consolidated-2282
  PASS. The only failure was render-openai-install-refusal (page.click Timeout 30s, twice) - an
  OpenAI-install check unrelated to this consolidated-view diff, timing out under my concurrent load;
  CI re-runs it on a clean machine.
- After my #3307 + #3304-comment edits: render-consolidated-layouts re-run = 0 FAIL; consolidated-980
  13/13, controls-1303h / consolidated-match-mock / bubblepop-2407 all rc=0.
- Screenshot: scratchpad/consolidated-after-3307.png - all 8 items render correctly, no page errors.
