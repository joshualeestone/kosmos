# waitswift-8939: the iPhone row and page say what a built mark waits on

Finished when: on an iPhone, a task marked built with `--waiting person` reads "waiting on you" on its Tasks row and on its page; a mark with no value, or one not in the table, reads exactly as before.

## Build
- `Tasks.builtWaitsWords` (ios/Kosmos/TasksLogic.swift): fixed table person/review/release, ", waiting on " + words, "" otherwise. Row: after who and when, before the note. Page (TaskPageLogic.swift stateLine): after who, before the note. Both decode `builtWaitingOn`.
- Stacked on waitingon-8934 (03a5116c0e); rebase onto main once #8934 merges.
- Out of scope, decided: Today's built entries (the card names row and page; the web Today card has its own wording).

## Evidence
- Tasks logic 167/167, task page 133/133; all 13 LogicTests suites; 13 node tests that read ios/ (93 tests).
- Mutations: removing the row call fails 4 row checks; removing the page call fails 3 page checks.

## Challenge loop iteration 1 (sonnet): converged
- No new findings. Wording and order checked against the web row and page, including no note, no who and an empty time; payloads carry the field; Today confirmed out of scope.
