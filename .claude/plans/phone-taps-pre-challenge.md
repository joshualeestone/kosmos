---
pre_challenge: true
method: challenge-loop
branch: phone-taps
diff_hash: 93a038e746dd9f5305da1c873f1b2ce04f6588f348ba7f846f5e9f4e3c70550f
validation: passed on every affected check (render-phone-taps-5218.js all PASS light/dark at 390 with touch + desktop control; mobile-shots 12 screens x SE/iPhone 15 x light/dark = 48 shots, covers 0; render-room-msgbox-2806 passes; tools.browser-checks-wired + browser-checks-indexed 12/12). Controls: the check reds 8 times on main; the room header at 44 reads a cover; mutants (rules deleted, a loose or 76px area, 44x10) red the check by name. The full suite runs on the PR's CI; the merge is held until after Monday.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T06:19:45Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7. Round 1 was Angel's cross-review (Mortals, Chromium and WebKit); rounds 2-7 were fresh blind reviewers. Each ran the check and its own synthetic harnesses.
**Converged:** Yes. Round 7 raised no new issues.
**Fixed:** 10 WARNING (2+2+2+2+1+1; one more carded as #5225), 8 NIT | **Kept, named:** 2 known false greens in the covers audit (case 11, overlapping fixed controls); the tablet one-screen name target, carded as #5225

#### Iteration 1 (5738328, Angel): 2 false greens, 1 wording
- [WARNING] covers never scanned a LABEL row --> FIXED (labels scanned)
- [WARNING] nested controls were skipped both ways, so a child's hit area over its card read 0 --> FIXED (a descendant's area outside its box counts)
- [NIT] Answer's box (63x24) vs reach (about 75x40) were conflated in the plan --> FIXED
- [STRENGTH] WebKit: AI settings 0 small fields and 0 small taps; names clean
#### Iteration 2 (331a183): 3 WARNING, 3 NIT
- [WARNING] a padding hit area was a false green --> FIXED (told apart from stacking by layer)
- [WARNING] the name's area is clipped on a touch tablet's one-screen list --> CARDED #5225 (scope is the phone)
- [WARNING] the check pinned only part of its claim --> FIXED (every rule read from computed style, with stand-ins)
#### Iteration 3 (ba6d890): 2 WARNING, 1 NIT
- [WARNING] the name-area line passed on unresolved text --> FIXED (numbers, on a laid-out element)
- [WARNING] absolute siblings overlapping were exempted --> FIXED (layer by ancestor)
- [NIT] :popover-open could throw on an old engine --> FIXED (guarded)
#### Iteration 4 (a048487): 2 WARNING, 3 NIT
- [WARNING] areas were read for size only, so a loose area passed --> FIXED (reach + bounded probe)
- [WARNING] covers false reds (a fixed control, a custom checkbox, a clipped control) --> FIXED
- [NIT] two copies of the scan --> FIXED (the check lifts fitOf); case 11 --> KEPT, named
#### Iteration 5 (171ef4d): 1 WARNING, 2 NIT
- [WARNING] an escaped control was skipped by the clip rule (a false green) --> FIXED (only the containing-block chain clips)
- [NIT] the bound was loose at 40 --> FIXED (26); overlapping fixed controls --> KEPT, named
#### Iteration 6 (6f2afd2): 1 WARNING, 2 NIT
- [WARNING] transform/filter/contain make containing blocks (false reds) --> FIXED; contain paint clips
- [NIT] body's overflow was taken as a clip --> FIXED; an off-screen bound probe passed --> FIXED (it fails)
#### Iteration 7 (dc36a12): no new issues
- [STRENGTH] the page change is one touch-only block; no later rule overrides it; desktop control passes
