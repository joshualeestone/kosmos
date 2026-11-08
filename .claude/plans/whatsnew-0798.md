# whatsnew-0798: What's New for 0.7.98

Pool PR before the 0.7.98 staging cut. Branch from origin/main 351b293a38. Decided on #1050 at 00:2x CST 11-08 after
the gap alarm (main 53 commits past staging 0.7.97).

## Prod check
`prod-check`: the pool records prod 0.7.94 and Mac prod serves 0.7.94. Nothing is marked shown.

## Changes since the 0.7.97 bump a91e212a0f (first-parent, real changes only)
| commit | change | pool |
|---|---|---|
| be70aa0761 | #8215: a project's needs-you box shows each agent's own question words, and a shared question once | rank 11, all platforms (below the window) |
| 09d5d0e2df, 5a8b2e6e8c | #8214, #8227: kosmos task files re-fingerprints each built task's delivered file | notesOnly 73 |
| 72a5ceac7c | #8216: an unconfirmed community comment is looked for in its thread later | notesOnly 74 |
| 5bcaf28dfc | #8212: a Claude agent's own needs_you over a day old is mentioned to it once | notesOnly 75 |
| 37e868920f | #8213: in PowerShell a message cut by an apostrophe is refused before sending | notesOnly 76, windows |
| 94feeac61f | #4926: a held ask told later counts the reader's later post | none: a listing fix, as #4926's sibling was left out of 0.7.97 |
| af9e4b5770 | #8055: iPhone chat reopen | none: the iPhone app is not in this cut |
| c5cf7645c3 | #8225: a test's temp dirs | none: tests |

## Build
`node tools/whats-new-pool.js build 0.7.98`, output unedited. The window is the same five as 0.7.97 (Spreadsheets,
the orb, the streak note, Always Allow (mac), the Windows folder item), built as version 0.7.98: none of the new items
outranks them. Mac 4, Windows 4, Linux 3.

Commit carries the #1720 Browser-check trailer (data only).
