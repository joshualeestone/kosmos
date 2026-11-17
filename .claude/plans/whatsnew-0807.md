# whatsnew-0807: What's New for 0.8.07

Pool PR before the 0.8.07 staging cut (gap alarm 19:26 CST 11-16, #1050). Data only: `release/whats-new-pool.json`, the built `web/whats-new.json`, and this plan. Prod reached 0.8.06 today (16:05), so `build` marked 0.8.06's four cross-platform highlights shown and recorded lastProd 0.8.06.

## The window (5; Windows 4)
1. Repeating tasks are told with the Prompter off (#8581, rank 9.4)
2. The Issue tile opens what needs you (#8592, rank 9.6)
3. Delete your agents' posts on the community site (#7215 step 3, rank 9.8)
4. A changed model shows on the card at once (#8601, rank 10.15, untagged)
5. Codex agents keep their model at launch (#8597, rank 10.2, mac)

## Changes to announce, by merge (since the 0.8.06 freeze f7fb719e9e)
| merge | change | pool |
|---|---|---|
| 609d4dc4bb | #8581: a due repeat is told to its holder with the Prompter off | rank 9.4, window |
| 4641531935 | #8592: the Projects tab's Issue tile opens the issue (one project) or filters to them (several) | rank 9.6, window |
| 4f50796382, d97bef5897 | #7215: Settings links the community page with Delete (when sharing is on and Kosmos+ is live) | rank 9.8, window |
| a60aa469bd | #6249: a line Kosmos typed into an empty box is kept when other text appears beside it, and pressed only when the box shows it whole | rank 11.9, mac |
| 6ee05a06a2 | #8597: Codex's model-migration menu is answered ahead of time (own Codex home only) | rank 10.2, mac, window |
| c5afa9a660 | #8601 (PR #8607): the card names a Claude agent's new model at once | rank 10.15, untagged, window |
| 1c8b855911 | #8510 (PR #8583): Windows Start at login words for a kept account folder | rank 11.7, windows |
| 810ea18577 | #8586: one could-not-reach row per stall for a repeat | rank 12.2 |
| 315771189d | #8547 (PR #8582): kosmos agent delete-leftovers --list | notesOnly 120 |

No line: #8585 (one helper for views without local paths: internal), #8596 (a test's TMPDIR), and the plan/proof commits.

## Decided
- "Restarting agents on Windows read as running" (Windows-only, 0.8.05) is retired by hand as shown in 0.8.06: Windows prod serves 0.8.06 (latest-win.json read 19:4x), and the pool records Mac promotes only, so build would otherwise offer it again.
- The card-model fix (#8601) is untagged: engine/status.js readModel's rule runs on every platform (review 1).
- The typed-line fix (#6249) and the Codex fix (#8597) are tagged mac: both run only in the Mac/Linux supervisor (a Windows agent has no input box; Windows Codex runs one exec per message). So Windows shows 4.
- The community-delete line names the site's page and the sharing condition: Settings shows the link only with community sharing on and an agent linked; the page itself needs a Kosmos+ sign-in (kosmos-community #72, #73, served v0.5.24).
- #8599 (the CLI EPIPE fix, kosmos#8609 in CI) gets a notes line only if it merges before the cut; added then, in its own commit.

## Weakest premise
Rank is judgement. The repeat fix only shows on a Mac with the Prompter off; the Codex fix only when a Codex model has a newer one in its catalog.

## Would change my mind
A person-facing change I missed in the merge list, or a reviewer showing a line claims more than its change does.

## Review log
### Review 1 (opus): 1 BLOCKER fixed, 3 WARNINGs fixed, 4 NITs (3 fixed, 1 left)
- BLOCKER fixed: the #6249 line named the wrong case (Kosmos still does not type into a box that already holds text); rewritten to the case fixed, ranked out of the window (11.9).
- WARNINGs fixed: #6249 and #8597 tagged mac (Mac/Linux supervisor only); the community line says it links the site's page and needs sharing on.
- NITs fixed: #8601 untagged and in the window; the Codex line says "on its own account"; the repeat title says "told", not "run".
- NIT left: the hand retirement rests on latest-win.json reading 0.8.06 (re-read 19:3x: 32f15fd1, 0.8.06).
