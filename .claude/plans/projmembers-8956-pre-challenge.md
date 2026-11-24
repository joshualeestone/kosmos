---
pre_challenge: true
method: challenge-loop
branch: projmembers-8956
diff_hash: 88fba3d5464563dd289443c5af525ba1a4c10583712e66558d713a7dc235fac2
validation: full suite PASSED on 0f0de29391 after the rebase over #8957 (validation-log hash 88fba3d54645; 30263 node pass, 0 fail; test:shell 4 shards all green). iOS: ios/LogicTests/run-room.sh 945/945; simulator SDK app build succeeded; the 13 node tests that read ios/ pass; ProjectInfoUITests 5/5 on iPhone 17e, iOS 27, with a screenshot per new screen.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-24T11:09:48Z
iterations: 6
converged: true
---

# Challenge-loop proof: projmembers-8956 (kosmos#8956)

Fresh blind read-only reviewers, alternating opus and sonnet, each comparing against the web board and the server. Colleagues' notes followed (Renet, Ice Cream Kitty, PigeonPete, Mona Lisa, April). Full record: .claude/plans/projmembers-8956.md.

- Iteration 1 (opus): [WARNING] the board's told has three states and could_not was said as "it reads the change next time"; [WARNING] no answer was said as "nothing changed" (a lost reply can follow an action); [WARNING] the archive read a project save's result and the page stayed on an archived project. All fixed: three told cases in the board's words, "not connected" decided before sending, its own archive result, close back to Projects after an archive.
- Iteration 2 (sonnet): [WARNING] Restore was unreachable (the phone opens no archived project), removed; [WARNING] the archive question claimed the agents stop being told, now the board's own hint; [WARNING] result lines were not spoken, now announced.
- Iteration 3 (opus): [WARNING] a lost archive answer left the page with its line hidden, now the re-read decides; [WARNING] a slow archive after Back could close another room, now only while the page is on screen; NITs: one shared add builder and line, the board's list name, an enum busy state, VoiceOver progress, UI checks that could not fail.
- Iteration 4 (sonnet): NITs only (a session the phone will not send for is said plainly; dialogs and sheet waited out with waitForNonExistence).
- Iteration 5 (opus): [WARNING] UI scroll loops asked isHittable of rows that may not exist yet, now exists && isHittable; [NIT] the add sheet offers only agents the phone can send for.
- Iteration 6 (sonnet): no new findings. Converged.
- After convergence: the Remove question's wording made consistent with the result lines (they, still on your computer), re-validated in full.

Device checks, not covered by the sample board (it admits no computer): the confirm buttons posting, the room closing after an archive, the told and could_not lines on a real computer. Open items at BLOCKER or WARNING: none.
- Rebased over #8957 (PR #8975), which restyled the general board rows this change removes: kept this change's side; #8957's member-row note kept as it landed; the hand-off row uses its Board.opensOnBoard and Board.boardIcon. Re-validated in full on the rebased head.
