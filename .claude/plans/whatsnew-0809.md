# whatsnew-0809: What's New for 0.8.09

Pool PR before the 0.8.09 staging cut (~21:00 CST 11-17, #1050). Data only: `release/whats-new-pool.json`, the built `web/whats-new.json`, and this plan. Prod serves 0.8.08, which was cut with KOSMOS_CUT_NO_WHATS_NEW=1, so everything person-facing since the 0.8.07 freeze (e3ab7762f5) is new to prod users.

## Pool bookkeeping first (commit 5aebdc8c71, order matters)
1. `shown 0.8.07 --promoted --from-history --ref=e3ab7762f5`: the pool had lastProd 0.8.06, so 0.8.07's window was never recorded; its five highlights are now shown in 0.8.07.
2. `shown 0.8.08 --promoted --none`: 0.8.08 reached prod with no What's New. Running this before step 1 would have re-offered 0.8.07's five (caught at the build output, reverted, redone in order).

## The window (5; Mac 5, Linux 5, Windows 5: all untagged)
1. GPT-6 is in the model list (#8593, rank 9.0)
2. Report or block someone outside your Kosmos (#8625 + #8631, rank 9.2)
3. Sort your Files (#8627, rank 9.4)
4. Flip through every page of a PDF (#8637, PR #8642, rank 9.6)
5. Link previews show their picture (#8636, PR #8646, rank 9.8)

## Changes to announce, by merge (since the 0.8.07 freeze e3ab7762f5; 0.8.08 freeze 9a712a0da7)
| merge | change | since | pool |
|---|---|---|---|
| 99dcf9026e, 6e1dd44b0e | #8593: Codex 0.169.0 and gpt-6 (Mac/Linux in 0.8.08, Windows half #8660 in 0.8.09) | 0.8.08 | rank 9.0, window, untagged |
| 1d11abb648, 3e0861e441, adfffd7a2d | #8625 board route (0.8.08) + #8631 desktop Report/Block and Blocked list (0.8.09) | 0.8.09 | rank 9.2, window |
| c5bd75cd08 | #8627: Files sort, four orders, remembered per screen | 0.8.08 | rank 9.4, window |
| c0f48c5675 | #8637 (PR #8642): PDF preview pages | 0.8.09 | rank 9.6, window |
| 5e041898db | #8636 (PR #8646): link preview pictures | 0.8.09 | rank 9.8, window |
| bedabc10e2 | #8617: a Files folder at agent creation (and the boot sweep) | 0.8.08 | rank 10.1 |
| 667a47157c (+ reviews) | #8629: a failed DM read keeps a scrolled-back reader's place | 0.8.08 | rank 10.12 |
| bbf68c4b3b | #8652: a first DM to a just-started Windows agent waits for its roster row | 0.8.09 | rank 10.7, windows |
| d80bd74fe1 | #8628: memory rings one thin stroke, never clipped | 0.8.08 | rank 12.3 |
| 3d7b84fd88 | #8618: a model switch takes a full id | 0.8.08 | notesOnly 121 |
| 646a835cd4 | #8616 (PR #8619): kosmos room --post / --since | 0.8.08 | notesOnly 122 |
| 4cde790967 | #8634: a restarted agent is reminded of its own wait | 0.8.09 | notesOnly 123 |
| 45f767551f, 3517995ff2 | #8640: delete-leftovers never offers a claimed pane's agent | 0.8.08 | notesOnly 124 |
| a70e51fc20 | #8658: kosmos msg and a crash relaunch get #8652's wait (Windows) | 0.8.09 | notesOnly 125, windows |

No line: #8626, #8635, #8654 (iPhone app, not in this build); #8620 (an internal restart after the Codex runner swap, covered by the GPT-6 line's update); #8605, #8610 (Windows card-model rule internals: stat once, named worlds); #8584 (rewords the 0.8.07 Windows startup-job line, still pending); #8644 (delete-plan follow-ups: a thread move, a newline rule); the plan/proof commits.

## Decided
- The GPT-6 line is untagged with since 0.8.08: Mac/Linux had it in 0.8.08, and Windows gets the Codex 0.169.0 pin in this build (#8660), so every platform reading 0.8.09's window has it.
- The Report/Block line is since 0.8.09: the board route shipped in 0.8.08 but nothing a person could press did until #8631.
- The two Windows-only 0.8.03 items ("Windows Settings stops a false warning", "Removing Kosmos takes out its agent hooks", the 0.8.07 review 3 deferral) are NOT retired by hand and NOT in the window: five new untagged items rank above them. Whether Windows prod ever served 0.8.03 to 0.8.05 is not recorded by any instrument I hold (the pool records Mac promotes; the pointer lives in R2 with no history; the rooms keep 200 rows). Windows prod is 0.8.08 now (latest-win.json re-read 18:36 CST 11-17, c25c6ac4). The question returns only when they could enter a window again.
- #8652's line is tagged windows: the wait is in the shared route, but the race it closes (record row before roster row) is the Windows roster's.

## Weakest premise
Rank is judgement. The GPT-6 line says Kosmos updates Codex for every platform; the Windows half (#8660) swaps only while no process runs from the managed folder, so a busy Windows Codex updates later, not at once.

## Would change my mind
A person-facing change I missed in the merge list, or a reviewer showing a line claims more than its change does.

## Review log
