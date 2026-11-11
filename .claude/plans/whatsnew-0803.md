# whatsnew-0803: What's New for 0.8.03

Pool PR before the 0.8.03 staging cut. Data only. `build` read prod 0.8.02, marked the highlights 0.8.02 showed as shown, and recorded lastProd 0.8.02.

## Changes to announce, by merged PR (since the 0.8.02 pin 91feaa2e15)
| PR | change | pool |
|---|---|---|
| #8383 | #8374: Windows Settings drops the launchd rows and their false line | rank 10.1, in the window, windows |
| #8367 | #8348: the Codex edit hook on Windows, so changed-by and undo work | rank 10.2, in the window, windows |
| #8366, #8391 | #8361: the Windows uninstall takes Kosmos's Gemini and Codex hooks out | rank 10.3, in the window, windows |
| #8376 | #8362: uninstall puts back the Gemini settings Kosmos filled in | rank 10.4, in the window, mac (the PR says Mac and Linux; Linux shows only untagged items, so it loses the line) |
| #8390 | #8375: Linux Settings drops macOS's checks | rank 12.5, release notes (untagged: a Linux-only tag does not exist) |
| #8370 | #5895: Windows browser openers pass a measured environment | rank 12.6, release notes, windows |
| #8386 | #8372: a Windows session's start report is accepted | notesOnly 96, windows |
| #8356 | #8352: a built note can be 1000 characters | notesOnly 97 |
| #8385 | #8373: the Windows board's own log | notesOnly 98, windows |
| #8371, #8381, #8387, #8382, #8393 | temp-path rule, tests, CI | none: nothing a person or agent does changes |
| #8343-#8360, #8346, #8349, #8350, #8351 | iPhone list | none: ships with the iPhone app |

## Decided
- "A little more room between chat lines" (0.8.01 item, never in a prod window) moves to rank 10.5 so Mac and Linux have a second line. It shipped in 0.8.01 and is on prod; #5711 counts an item as new until a prod window names it.
- Window: Mac 2, Windows 4. Windows gets the most because most of this release is Windows.
- Two lines were reworded so a windows-tagged highlight names no Mac and the untagged Linux line names no Mac (the build refuses a tag and a named platform that disagree).

## Weakest premise
Rank is judgement, and the Gemini restore line is tagged mac although Linux has it too.

## Would change my mind
A Windows run showing a line false (the Codex changed-by, or the uninstall leaving a hook): drop that line.
