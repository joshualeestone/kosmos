# whatsnew-0810: What's New for 0.8.10

Pool PR before the 0.8.10 staging cut (11-18, #1050). Data only: `release/whats-new-pool.json`, the built `web/whats-new.json`, and this plan. Prod serves 0.8.09 (promoted 11-18 08:26 CST, frozen at 7c2d1f1376).

## Pool bookkeeping first (its own commit)
`shown 0.8.09 --promoted --from-history --ref=7c2d1f1376`: 5 marked shown, lastProd 0.8.09. `build` then reads prod and agrees ("the pool already records prod 0.8.09").

## The window (5; every platform 5)
1. Edit a task after it is made (#8664 page half, edcda93cc6; rank 9.0)
2. A task can wait for a merge or a time (#8669, 4bf7392b41; rank 9.2)
3. A signed-out agent page says so (#8662, aa388aa1af; rank 9.4)
4. No model recorded says where to set it (#8667, d96f6ae610; rank 9.6)
5. A new agent gets a Files folder (already pending, 0.8.08, rank 10.1)

## Notes only (kosmos whats-new)
| merge | change | rank |
|---|---|---|
| fd67283d6b | #8664 CLI: kosmos task edit | 126 |
| 4bf7392b41 | #8669 CLI: kosmos task wake | 127 |
| 997e745e8b | #8665/#8666: kosmos agent list names the model; kosmos agent model | 128 |
| e788308f2d | #8668: task check --moved-to, 1000-character report | 129 |
| 8fde6a5aff, ab0c2a540c | #8686/#8685: the #8640 folder check on Windows (windows); #8685's roster-read-once and no listing for a running agent are inside the same guard, folded into this line | 130 |

## No line
#8632, #8679 (iPhone app, not in this build); #8055 (iPhone warm return); #8680 (agents' instructions name task edit, covered by the notes line); #8681 (a test's Ctrl+C timing); #8659 (Windows Codex upgrade's last-look deadline: a slow box's upgrade now lands, but it completes the 0.8.09 GPT-6 line's promise rather than adding one, so no line of its own); #8672, #8694 (test pins, browser-check board); plan/proof commits.

## Decided
- The wake line says "An agent can set": slice 1 has no page control to set one (plan taskwake-8669, Not in slice 1); the person sees it on the Tasks row and the task page.
- The no-model line names its condition (the AI Settings link only for an agent Kosmos started), as #8667 does.
- Lines trimmed to the window's 140 characters; the build refused each longer one and wrote nothing (checked: the built file changed only on the last build).

## Weakest premise
Rank is judgement. The wake line no longer says who is told: one holder, the setter first, when next idle, and nobody when no one holds the task (the page says so).

## Would change my mind
A person-facing merge since 7c2d1f1376 missing from these tables, or a reviewer showing a line claims more than its change does.

## Review log
### Review 1 (opus): 2 WARNINGs fixed, 2 NITs fixed
- WARNING fixed: the wake line names its condition, GitHub connected for a pull request or branch (engine/taskwake.js answers "GitHub is not connected with the gh tool" otherwise); it drops "tells its agent once" to fit.
- WARNING fixed: the Windows leftover line said "works from" the folder, which reads as the working folder, the one case #8686 does not cover; now "runs from the agent's folder or names it".
- NIT fixed: the #8668 notes line says the task page shows both ends of a move.
- NIT fixed: the weakest premise names the no-holder case.
### Review 2 (sonnet): 1 WARNING fixed, 3 NITs (1 fixed, 2 left)
- WARNING fixed: the edit line said the activity records what changed; for a detail it records only that it changed (engine/taskactphrase.js). Now: who changed it, with the old and new title.
- NIT fixed: the plan says why #8659 has no line.
- NITs left: the wake title says "a merge" though a PR closed unmerged also wakes (the line says "a pull request"); the no-model line simplifies where the link shows (the condition is named).
### Review 3 (opus): 1 WARNING fixed, 3 NITs fixed
- WARNING fixed: "with GitHub connected" was false for a person who connected GitHub through Kosmos's own sign-in (githubdevice): the wake reads only the gh tool (server.js wakeGh, engine/taskwake.js "Not here (slice 1)"). Now "through the gh tool". The engine's own refusal ("Connect it under Connections") has the same gap: a card, not this PR.
- NIT fixed: the edit line no longer implies old and new detail text: "for a title the old and new words".
- NIT fixed: the agent model line says it lists choices when it can (some vendors have no list).
- NIT fixed: the plan says #8685 is folded into the Windows folder-check line.
