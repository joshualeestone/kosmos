# whatsnew-0806: What's New for 0.8.06

Pool PR before the 0.8.06 staging cut (#8564). Data only: `release/whats-new-pool.json`, the built `web/whats-new.json`, and this plan. 0.8.05 has not reached prod (prod is 0.8.02), so 0.8.05's pending lines carry into 0.8.06; `build` found the pool already records prod 0.8.02.

## The window (Mac 4, Linux 4, Windows 5)
1. Claude Fable 5.2 is in the model picker (0.8.05, rank 9)
2. Images, video and voice on Connections (#7750, PR #8556, rank 9.3, untagged)
3. A suggested answer beside the question (0.8.05, rank 9.5)
4. See what your agents found on Connections (#8519, PR #8522, rank 9.7, untagged)
5. Restarting agents on Windows read as running (0.8.05, rank 10.05, windows)

"The restart note says what was checked" (mac, 10.45) and "A little more room between chat lines" (10.25) leave the window and stay pending; both are minor next to two new Connections features.

## Changes to announce, by merged PR (since the 0.8.05 freeze 7f6b48cf61)
| PR | change | pool |
|---|---|---|
| #8556 | #7750: Images, video and voice group on Connections, Replicate and ElevenLabs token doors | rank 9.3, window, untagged |
| #8522 | #8519: Settings > Connections, What your agents found | rank 9.7, window, untagged |
| #8557, #8560 | #8552/#8555: a closed task says how it closed (Tasks row, task page, task show) | rank 11.0, untagged |
| #8539 | #8535: a post the wake pause kept quiet says why, who set it, what still gets through | rank 11.2, untagged |
| #8534 | #8525: a member with a computer can allow a new Cloud machine | rank 11.3, untagged |
| #8492 | #8478: Windows keeps an agent's account and model across its startup task | rank 11.5, windows |
| #8511 | #8489: Windows Start at login stops reading the same account as changed | rank 11.6, windows |
| #8493 | #8491: Setup guide says how to free its name in three more cases | rank 12.7, untagged |
| #8549 | #8548: a while-you-were-away digest at a real startup | notesOnly 114 |
| #8551 | #8547: kosmos agent delete-leftovers | notesOnly 115 |
| #8502 | #8501: task add/assign --add-member | notesOnly 116 |
| #8507 | #8506: an agent's working rules hold only its platform's lines | notesOnly 117, restart agents |
| #8554 | #8261: records keep every agent that confirmed them | notesOnly 118 |
| #8504 | #8477/#8496: a Windows leftover delete runs only what was confirmed | notesOnly 119, windows |

No line: #8541 (#8530, Muse chats in company backup) and #8536 (#8528, backup words) because company backup is off, so nobody sees them; #8545, #8509, #8518, #8494, #8558, #8529's local-bucket change, and the plan/proof commits (tests, release tooling or internal). The relay's Work screens (#8529, kosmos-relay #831) ship in the coordinator, not in this desktop build.

## Decided
- Both Connections items are untagged: the Connections tab and the token doors are the board's (engine/tokendoors.js, web/), which every platform runs.
- The Windows delete item (#8504) is tagged windows to be safe: the PR is a Windows fix. If the fingerprint also guards the Mac delete, tagging it windows only under-claims.
- Lines kept to 140 characters (the build refuses longer); three were shortened after the first build refused one.

## Weakest premise
Rank is judgement. "See what your agents found" shows only once an agent has used a service, so some people will not see it yet.

## Would change my mind
A person-facing change I missed in the merge list, or a reviewer showing one of these lines claims more than the PR does.
