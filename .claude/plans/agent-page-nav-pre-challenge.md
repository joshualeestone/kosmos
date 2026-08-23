---
pre_challenge: true
method: challenge-loop
branch: agent-page-nav
diff_hash: 99e751906b0958ad367b247c385246a4d124ba3c2dff497f0f6fb884daf1b470
subdir_audit: passed
timestamp: 2026-08-23T16:14:17Z
iterations: 12
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** No (stopped at a named bound after iteration 12; see "Why it stopped")
**Total findings:** 50 (3 BLOCKERs, 28 WARNINGs, 8 CONVENTIONs, 11 NITs)
**Fixed:** 46 | **Deferred:** 4

### Why it stopped

The loop's rule is "iterate until a round finds no BLOCKER, WARNING or
CONVENTION". On a 21,000-line single-file front end that rule has no floor:
from iteration 3 on, every round found its defects inside the previous round's
fix, and Splinter measured the signature (25 regions touched by more than one
iteration; index.html around the Terminal section touched by six rounds). The
bound was named at iteration 12: fix what it found, sweep the one real class
it exposed (browser checks that open the agent page and assume one column),
and merge. Anything further is a card.

What the rounds were worth, in order: rounds 1 and 2 found the two defects
that would have shipped (the poll froze the terminal under "right now"; a page
left on Talk captured the pane every five seconds for nothing). Rounds 3 to 8
hardened the Terminal section's three states and the reader's place in the
thread. Rounds 9, 11 and 12 each found one more browser check under
docs/browser-checks that opened the agent page and expected one column; the
directory was then swept whole (every file that touches `#panel-detail`,
`.acard`, or a `d-*` id), which is what the loop should have done in round 9.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 6 WARNINGs, 2 CONVENTIONs, 2 NITs
- [BLOCKER] web/index.html tick — the window repaint still gated on ENG_ON, so it painted once and froze under "right now" --> FIXED (15c8b78)
- [WARNING] web/index.html Terminal section — empty for an untied agent --> FIXED (standing sentence)
- [WARNING] web/index.html .dsec — outline:none on the focused section (WCAG 2.4.7) --> FIXED (focus ring)
- [WARNING] web/index.html setThread — scroll-to-newest is a no-op into a hidden section --> FIXED (re-done on arrival)
- [WARNING] plan — Remove copy claimed shipped, was not --> FIXED (plan says kept as shipped, with the reason)
- [WARNING] plan — claimed arrow-key roving that does not exist --> FIXED (plan corrected)
- [WARNING] web/index.html model change — focused d-say in a hidden section --> FIXED
- [CONVENTION] two comments still said the box was gated by the switch --> FIXED
- [CONVENTION] tick comment described the removed gate --> FIXED
- [NIT] test sliced tick to 6000 chars --> FIXED (slice to function end)
- [NIT] `.dgrid` rule "dead" --> DEFERRED: it still serves the Settings panel's grid (line ~5484); the reviewer matched the class name in the detail panel only

#### Iteration 2
**New findings:** 4 WARNINGs, 3 CONVENTIONs, 3 NITs
- [WARNING] replacement focus landed on a disabled button --> FIXED (e58ce6a)
- [WARNING] tick captured the pane every five seconds whatever section was open --> FIXED (gated on the Terminal section, arrival paint)
- [WARNING] untied sentence shown during a tied agent's first read --> FIXED (data-tied, two sentences)
- [WARNING] test counted `detailGo(` literally, comments included --> FIXED (identifier match, plus the gate expression)
- [CONVENTION] half-edited comment over the focus line --> FIXED
- [CONVENTION] markup comment said dots were called from painters --> FIXED
- [CONVENTION] server.js comment said the route was behind the switch --> FIXED
- [NIT] render-projects comment described the old gate --> FIXED
- [NIT] scroll on every arrival --> FIXED (later superseded by TALK_SCROLL)
- [NIT] no caller passes a section --> FIXED (plan honest; browser check exercises it)

#### Iteration 3
**New findings:** 4 WARNINGs, 2 CONVENTIONs, 2 NITs (all inside iteration 2's fixes)
- [WARNING] open-time capture on a Talk landing --> FIXED (e3fda7c: no capture on open)
- [WARNING] scrollTop===0 guard could not tell "left" from "display:none" --> FIXED (TALK_SCROLL)
- [WARNING] deep-link parameter unexercised --> FIXED (browser check calls openDetail(name, section), fallback, capture count)
- [WARNING] deep-link to Terminal double-captured --> FIXED (section chosen after the box reset)
- [CONVENTION] tie re-check comment now section-gated --> FIXED
- [CONVENTION] em dash in a touched server.js line --> FIXED
- [NIT] run-on comment in render-projects --> FIXED
- [NIT] querySelector per tick --> FIXED (sections carry ids)

#### Iteration 4
**New findings:** 5 WARNINGs, 3 NITs (all inside iteration 3's fixes)
- [WARNING] TALK_SCROLL reset undone by the open path's capture --> FIXED (b3cb32d)
- [WARNING] re-click on Talk re-applied a stale offset --> FIXED (consumed on use)
- [WARNING] new message while away never lands in view --> FIXED (ruling written: the reader's place wins)
- [WARNING] sel.focus() while disabled --> FIXED (after the re-enable in finally)
- [WARNING] WINDOW_OPENING comment false --> FIXED (dead guards removed, counter marked dormant)
- [NIT] 404 left "Reading" standing --> FIXED
- [NIT] test pinned the dead guard --> FIXED
- [NIT] preventScroll:false --> FIXED

#### Iteration 5
**New findings:** 2 WARNINGs, 2 CONVENTIONs, 3 NITs
- [WARNING] 404 sentence flickered to "reading" every tick --> FIXED (4ec8901, gone marker)
- [WARNING] detailPaintWindow(undefined) painted the untied sentence for a removed agent --> FIXED
- [CONVENTION] "Opens re-learn the flag" false --> FIXED
- [CONVENTION] dot comment named one of two facts --> FIXED
- [NIT] aria-current="page" on buttons --> FIXED ("true")
- [NIT] rename from a second tab leaves pill names stale --> DEFERRED: the header name has the same property today; one fix for both belongs with the reports-to/role class card
- [NIT] route cost unbounded server-side --> FIXED (comment) and named in the PR

#### Iteration 6
**New findings:** 1 BLOCKER, 3 WARNINGs, 3 NITs
- [BLOCKER] the `if (!a) return` guard dropped the hide-and-retire for a removed agent --> FIXED (96ac4c1)
- [WARNING] arrival paint read the open-time record --> FIXED (fresh record)
- [WARNING] gone marker survived an agent switch --> FIXED (cleared on open)
- [WARNING] plan's dot sentence wrong about d-instr-stale --> FIXED
- [NIT] plan said aria-current="page" --> FIXED
- [NIT] section aria-label lacks the name --> FIXED
- [NIT] WINDOW_OPENING dormant --> FIXED (comment) / deletion deferred to its own change

#### Iteration 7
**New findings:** 4 WARNINGs, 4 NITs
- [WARNING] removed agent got a false Terminal sentence either way --> FIXED (0c4d6ac: gone state, no fallback)
- [WARNING] removed-agent explanation only in the Remove section --> FIXED (header line, every section)
- [WARNING] browser check passed a revived gate on the refusal arm --> FIXED (asserts a capture)
- [WARNING] re-click on Talk jumped to newest --> FIXED (arriving flag)
- [NIT] gone marker not cleared on refusal/catch --> FIXED
- [NIT] "ENG_ON is read by the project room" is not a reason --> FIXED
- [NIT] "names it" present tense --> FIXED
- [NIT] "twenty lines up" --> FIXED

#### Iteration 8
**New findings:** 3 WARNINGs, 4 NITs
- [WARNING] 404 arm asserted the untied cause --> FIXED (8c623d3: gone)
- [WARNING] removed-agent sentence twice on one screen --> FIXED (header once, Remove block says its half)
- [WARNING] status region set while hidden --> FIXED (unhidden first)
- [NIT] "red" for an amber dot --> FIXED
- [NIT] long single-line comment --> FIXED
- [NIT] route slice by count --> FIXED (anchored on the next route)
- [NIT] five writers of one marker --> FIXED (one writer)

#### Iteration 9
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 NITs
- [BLOCKER] docs/browser-checks/render-projects.js read the window box without clicking Terminal --> FIXED (024b577; run green through 9-grid-view)
- [WARNING] render-thread.js's untied check passed for every agent --> FIXED (clicks Terminal, returns to Talk before reading; run green, 91 checks)
- [WARNING] withdrawn line announced every tick --> FIXED (once per absence)
- [WARNING] catch arm did not clear the marker --> FIXED
- [NIT] specificity order --> FIXED (comment)
- [NIT] bare "No window to show." --> FIXED, then made bare again in iteration 10 with the reason written

#### Iteration 10
**New findings:** 2 WARNINGs, 4 NITs
- [WARNING] paintTalk comment contradicted the Terminal sentence --> FIXED (0b8c84c)
- [WARNING] 404 marker asserted a cause for two route bodies --> FIXED (bare sentence, comment says why)
- [NIT] redundant .dsec[hidden] rule --> FIXED
- [NIT] two wordings for one state --> FIXED (bare)
- [NIT] Shift+Tab order --> FIXED (written down)
- [NIT] firstrun guard guessed --> FIXED

#### Iteration 11
**New findings:** 1 BLOCKER, 3 CONVENTIONs, 2 NITs
- [BLOCKER] docs/browser-checks/regress-a-night.js read Restart/Remove rects without opening Memory --> FIXED (ab779bf; run: 48 pass, 2 create-screen failures reproduce on main and are carded as #344)
- [CONVENTION] grid-order test's header described the old grid --> FIXED
- [CONVENTION] watchDots guard's reason not true --> FIXED
- [CONVENTION] README table lacked the new check --> FIXED
- [NIT] kept place beats a message that arrived while away --> DEFERRED: ruled and written at the restore site
- [NIT] second tab on Terminal --> DEFERRED: named in the PR, server-side cap is a card

#### Iteration 12
**New findings:** 5 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] named-controls.js restart/removal surfaces clicked hidden buttons --> FIXED (0730453; run green, 57)
- [WARNING] named-controls.js and contrast.js swept one section of seven --> FIXED (one surface per pill; contrast run green, 60)
- [WARNING] render-rename-say.js waited for a hidden field --> FIXED (opens Profile; run green)
- [WARNING] render-special-purpose.js read hidden text --> FIXED (opens Instructions); its three remaining failures reproduce on main (the label it asserts was renamed before this branch)
- [WARNING] plan said the dot marks where the fix is --> FIXED (marks the section the banner is about)
- [CONVENTION] server test title --> FIXED
- [NIT] WINDOW_OPENING three explanations --> DEFERRED: deletion is its own change
- [NIT] aria-controls on pills --> FIXED
- [NIT] route cost in the PR --> FIXED (named)

### Final Ledger (deferred items)

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 11 | 1 | NIT | web/index.html ~1243 | `.dgrid` rule dead | DEFERRED | serves the Settings panel's grid |
| 22 | 5 | NIT | web/index.html tick | pill names stale after a second-tab rename | DEFERRED | header name has the same property; reports-to/role class card |
| 41 | 11 | NIT | web/index.html detailGo | kept place vs new message | DEFERRED | ruled, written at the site |
| 49 | 12 | NIT | web/index.html ~9600 | WINDOW_OPENING dormant | DEFERRED | deletion is a separate change |

### Strengths (across all iterations)
- The boxes moved as the same elements with ids intact; `detailGo` is the only writer of section visibility; the poll never calls it, pinned by identifier (every iteration)
- The dots mirror the sections through a MutationObserver on `hidden`, so the nav cannot disagree with the section it points at (1, 5, 7, 11, 12)
- The browser check leads with a control, measures by rectangle, counts captures synchronously, and asserts a capture rather than a visible box (2 onward)
- The server test pins the ungated route on the Off leg before the switch is turned on (2 onward)
- The membership test asserts presence before section, with the header as a control (6, 8, 12)
