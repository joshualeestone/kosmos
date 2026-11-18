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
| 8fde6a5aff, ab0c2a540c | #8686/#8685: the #8640 folder check on Windows (windows) | 130 |

## No line
#8632, #8679 (iPhone app, not in this build); #8055 (iPhone warm return); #8680 (agents' instructions name task edit, covered by the notes line); #8681 (a test's Ctrl+C timing); #8659 (Windows Codex upgrade's last-look deadline, internal); #8672, #8694 (test pins, browser-check board); plan/proof commits.

## Decided
- The wake line says "An agent can set": slice 1 has no page control to set one (plan taskwake-8669, Not in slice 1); the person sees it on the Tasks row and the task page.
- The no-model line names its condition (the AI Settings link only for an agent Kosmos started), as #8667 does.
- Lines trimmed to the window's 140 characters; the build refused each longer one and wrote nothing (checked: the built file changed only on the last build).

## Weakest premise
Rank is judgement. The wake line's "tells its agent once" compresses "one holder, the setter first, told when next idle".

## Would change my mind
A person-facing merge since 7c2d1f1376 missing from these tables, or a reviewer showing a line claims more than its change does.

## Review log
