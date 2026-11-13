# whatsnew-0805b: the rest of 0.8.05's What's New

Second pool PR before the 0.8.05 staging cut (Splinter's call 21:27 CST 11-12: cut 0.8.05 now; Josh re-briefed that his go now means 0.8.05). Data only. The first pool PR (#8444) covered merges up to 04:23; 25 more merged after it. My afternoon checks missed them: they filtered out every commit subject containing " -- ", which most PR titles here have.

## Changes to announce, by merged PR (since #8444, 4c6f97acd7)
| PR | change | pool |
|---|---|---|
| #8468 | #8461: Claude Fable 5.2 in the model menu, named and priced | rank 9.0, in the window, untagged |
| #8482 | #8475: a Windows startup task with no folder is listed and its delete removes only the task | notesOnly 104, windows |
| #8476 | #8471: a Windows delete that cannot remove the task keeps the agent | notesOnly 105, windows |
| #8486 | #8466: a leftover Windows task holds its name; create says how to free it | notesOnly 106, windows |
| #8467 | #8454: a moved Codex agent on Windows no longer shows the old account's limits (a later stop, start or switch can hide its reports until Codex reports again, per the PR) | notesOnly 107, windows |
| #8472 | #8466: a Windows Codex card drops the reading from before a change and shows the job's planned model (still wrong while a session runs another model, per the PR) | notesOnly 108, windows |
| #8481 | #8384: Linux Settings reads Linux's restart and sleep settings | notesOnly 109, untagged (no Linux tag exists; names Linux) |
| #8470 | #8462: kosmos feedback show/list answer on stdout | notesOnly 110 |
| #8473 | #8464 item 1: the file-owner notice says how big the change was | notesOnly 111 |
| #8479 | #8464 item 2: kosmos task check, per-check reports | notesOnly 112 |
| #8485 | #8483: a resent community comment or post is not doubled | notesOnly 113 |
| #8445 #8446 #8448 #8449 #8450 #8452 #8457 #8458 #8460 #8465 #8469 | #8378: Windows test clusters | none: tests |
| #8443 #8447 #8455 | iPhone UI tests (CI only); #8447 an iPhone chat scroll fix | none: the iPhone app is not in this build |

## Decided
- Fable 5.2 leads the window: Josh asked for it (#8461), and a new model is the thing a person is most likely to act on.
- "Windows Settings stops a false warning" (0.8.03) moves 10.1 to 10.5, out of the window into the release notes, so Mac keeps the restart note: Mac 4, Windows 4, Linux 3.
- The Fable line says "cheaper per token than Fable 5.1", not "priced at the published rate": #8468 derives one figure (the cache write) rather than reading it.
- The Windows leftover-task changes stay in the release notes: they matter only to someone with a leftover task.

## Weakest premise
Two lines are true of the merged code but not yet seen working, so the served 0.8.05 build has to confirm them before promote, the first one first:
- **Claude Fable 5.2 (leads the window).** #8468 says a board-created Fable 5.2 agent has not yet been seen running `claude-fable-5-2`; #8461 is parked needs-release for exactly that. The line claims only that you can pick it, which the menu already does.
- **Linux Settings (release notes).** #8481's output shapes for busctl, gsettings and systemctl come from documentation, not a real Linux board.
Rank is judgement, and the Windows Codex lines rest on the PRs' descriptions, not a Windows run of mine.

## Would change my mind
Any line found false on a served build: drop it before promote.
