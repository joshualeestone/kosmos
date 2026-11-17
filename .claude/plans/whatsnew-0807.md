# whatsnew-0807: What's New for 0.8.07

Pool PR before the 0.8.07 staging cut (gap alarm 19:26 CST 11-16, #1050). Data only: `release/whats-new-pool.json`, the built `web/whats-new.json`, and this plan. Prod reached 0.8.06 today (16:05), so `build` marked 0.8.06's four cross-platform highlights shown and recorded lastProd 0.8.06.

## The window (5, every platform)
1. Repeating tasks run with the Prompter off (#8581, rank 9.4)
2. The Issue tile opens what needs you (#8592, rank 9.6)
3. Delete what your agents posted (#7215 step 3, minelink-7215, rank 9.8)
4. A message typed beside other text is kept (#6249, rank 10.1)
5. Codex agents keep their model at launch (#8597, rank 10.2)

## Changes to announce, by merge (since the 0.8.06 freeze f7fb719e9e)
| merge | change | pool |
|---|---|---|
| 609d4dc4bb | #8581: a due repeat is told to its holder with the Prompter off | rank 9.4, window |
| 4641531935 | #8592: the Projects tab's Issue tile opens the issue (one project) or filters to them (several) | rank 9.6, window |
| 4f50796382, d97bef5897 | #7215: Settings links the community page with Delete (when sharing is on and Kosmos+ is live) | rank 9.8, window |
| a60aa469bd | #6249: a line typed beside other text is remembered, retried, and pressed only when whole | rank 10.1, window |
| 6ee05a06a2 | #8597: Codex's model-migration menu is answered ahead of time | rank 10.2, window |
| c5afa9a660 | #8601 (PR #8607): the card names a Claude agent's new model at once | rank 10.65, windows |
| 1c8b855911 | #8510 (PR #8583): Windows Start at login words for a kept account folder | rank 11.7, windows |
| 810ea18577 | #8586: one could-not-reach row per stall for a repeat | rank 12.2 |
| 315771189d | #8547 (PR #8582): kosmos agent delete-leftovers --list | notesOnly 120 |

No line: #8585 (one helper for views without local paths: internal), #8596 (a test's TMPDIR), and the plan/proof commits.

## Decided
- "Restarting agents on Windows read as running" (Windows-only, 0.8.05) is retired by hand as shown in 0.8.06: Windows prod serves 0.8.06 (latest-win.json read 19:4x), and the pool records Mac promotes only, so build would otherwise offer it again.
- The card-model fix (#8601) is tagged windows: the bug showed where the supervisor resumes the same conversation (Windows); the change is in shared engine/status.js, so tagging it windows-only undersells it at worst, never oversells.
- The community-delete line says "signed in with Kosmos+": the page needs that sign-in (kosmos-community #72, #73, served v0.5.24).
- #8599 (the CLI EPIPE fix, kosmos#8609 in CI) gets a notes line only if it merges before the cut; added then, in its own commit.

## Weakest premise
Rank is judgement. The repeat fix only shows on a Mac with the Prompter off; the Codex fix only when a Codex model has a newer one in its catalog.

## Would change my mind
A person-facing change I missed in the merge list, or a reviewer showing a line claims more than its change does.

## Review log
