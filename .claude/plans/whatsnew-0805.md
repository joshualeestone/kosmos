# whatsnew-0805: What's New for 0.8.05

Pool PR before the 0.8.05 staging cut. Data only. 0.8.04 was a hotfix cut with no What's New window, so 0.8.03's pending lines carry into 0.8.05 (decided on #1050). Prod is still 0.8.02; `build` found the pool already records it.

## Changes to announce, by merged PR (since the 0.8.04 freeze f4032d90e7)
| PR | change | pool |
|---|---|---|
| #8429 | #8395: an agent's suggested answer beside a for-you hold's question (task page, Tasks list, project card) | rank 9.5, in the window, untagged |
| #8426 | #8415: a Windows supervisor between Claude children reads running, not "Not running" | rank 10.05, in the window, windows |
| #8428 | #8421: the board log says an automatic update started and how it ended (Mac only) | notesOnly 100, mac |
| #8435 | #8406: the Windows kill guard sees through NAME=value, env and launcher prefixes | notesOnly 101, windows |
| #8438 | #5664 step A: the token-only guard is written on Windows, and says what it does not cover | notesOnly 102, windows |
| #8434 | #8423: install marker only under an absolute root | none: no change a person or agent sees |
| #8432 | #8424: winlog-epipe follow-ups (comments, tests) | none |
| #8431, #8436 | design-shot check, Windows test skips | none: tests |
| #8433 | #8405: iPhone shows the suggested answer | none: ships with the iPhone app |

## Decided
- "A little more room between chat lines" moves from 10.5 to 10.25 and "Removing Kosmos takes out its agent hooks" from 10.3 to 10.6. Without that the window was Mac 2, Linux 1, Windows 4; with it Mac 3, Linux 2, Windows 4. The uninstall line is the least useful to someone still using Kosmos; it stays pending and in the release notes.
- The suggested-answer line is untagged: the board UI is on every platform. The CLI flag is on the Mac/Linux CLI and the Windows CLI (#8429 Files).

## Weakest premise
Rank is judgement. The Windows "running" line rests on #8426's description and Homer's measurement on the card, not on a run of mine.

## Would change my mind
A Windows run showing an agent still reading "Not running" while its supervisor restarts it: drop that line.
