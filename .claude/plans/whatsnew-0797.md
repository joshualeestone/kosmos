# whatsnew-0797: What's New for 0.7.97

Pool PR before the 0.7.97 staging cut. Branch from origin/main 980398054d. The cut was decided on #1050 at 14:2x CST
11-07 after the gap alarm (main 64 commits past staging 0.7.96).

## Prod check
`prod-check`: the pool records prod 0.7.94 and Mac prod serves 0.7.94. Nothing is marked shown. Windows prod 0.7.94;
Windows staging 0.7.96 (no pool record; the pool records Mac promotes only). If Josh promotes 0.7.96 before the cut, this
is rebuilt against lastProd 0.7.96.

## Changes since the 0.7.96 bump d61c5fc25f (first-parent, real changes only)
| commit | change | pool |
|---|---|---|
| d2cacf9374 + follow-ups | #6397: the streak's daily note slides out of the K mark as a gold pill on a wide screen, then a count badge for the day (option A of the three drawn for Josh, after his #6160 ask) | rank 7.5, all platforms |
| 83c9ef6706 | #8202: kosmos task show prints one task whole, both CLIs | notesOnly, rank 67 |
| fb8cf2020a | #8156: the zz-livecheck- prefix for throwaway test agents | none: a fleet testing aid |
| c78780aff3 | #8021: the board log says what each auto-handoff prompt's delivery did | none: a log line |
| 2b27879620 | #8177: on Windows, a case variant of an agent's name finds no job | none: visible (removing "Cai" used to report Cai removed while "cai" kept running) but rare and Windows-only; it is named in the versions entry |
| f27a61830f | #8195: a repo-wide ratchet on early readers under pipefail | none: tests |

## Build
`node tools/whats-new-pool.js build 0.7.97`, output unedited. Window: Spreadsheets, The KOSMOS orb, Your streak note
comes out of the K mark, Always Allow (mac), Kosmos says when others can change its folder (windows). Mac 4, Windows
4, Linux 3. The streak item takes the Gemini item's slot (rank 16, mac), which waits for a later window.

Commit carries the #1720 Browser-check trailer (data only).

## Review round 1 (NITs only)
- task show line uses the CLI's own placeholders, <project-id> <task-number>.
- The streak line says the badge stays "that day" (it is gone the next day until that day's pill folds).
- #8177's reason for leaving it out is corrected above.
- Kept: the streak at rank 7.5, above Always Allow (8). Both are Josh-asked; the streak's design was drawn for him.
