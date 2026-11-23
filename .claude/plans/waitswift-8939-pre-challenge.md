---
pre_challenge: true
method: challenge-loop
branch: waitswift-8939
diff_hash: 8c5aa72f6d8d48cb760c259cdc39d1790eca32f3c42fd728e9bdb771403af962
validation: local only, on 03be2beac8 rebased onto main after #8934 merged: all 13 ios/LogicTests suites pass (tasks 167/167, taskpage 133/133, main 2181/2181); 13 node tests that read ios/ plus server.builtwaiting-8934 (109 tests) pass. The full suite runs on the PR's CI (Swift-only change).
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-23T19:05:44Z
iterations: 1
converged: true
---

# Challenge-loop proof: waitswift-8939 (kosmos#8939)

- Iteration 1 (sonnet, fresh blind read-only reviewer): no new findings.
- What it checked: the row and page wording and order against the web row and page character by character, including no note, no who and an empty time; decoding of builtWaitingOn on both reads; that the server sends the field in both payloads; the other iOS built surface (Today), out of scope because the web Today card uses its own words; that each new test can fail.
- Mutations: removing the row call fails 4 row checks; removing the page call fails 3 page checks.
- [BLOCKER] none. [WARNING] none.
- Rebased after review onto main (Baron's #8934 landed with three more commits); none of them touched the web wording or the stored values this copies, checked by diff.

## What the reviewer read and confirmed, item by item
- Web row (web/index.html, the builtLine): Marked built, by you or by name, the time, tskBuiltWaitsWords, then ": note". iOS builtLine builds the same order.
- Empty time: the web adds a space only for a non-empty time; iOS does the same with `if !a.isEmpty`, so the words attach directly.
- No note and no who: each part is appended only when present, on both sides.
- Web page (the builtWords line): words after who, before the note; iOS stateLine the same.
- The table is identical: person "you", review "a review", release "a release", joined as ", waiting on " + words.
- Unknown value: the web guards with a string type check and Object.hasOwn; the Swift dictionary lookup gives the same result.
- Decoding: the tasks read uses str(row, "builtWaitingOn"); the page read uses text(...), which maps empty and non-strings to nil.
- Payloads: server.js builds each Tasks row with Object.assign from the stored task, and engine/tasks.js stores builtWaitingOn in its built fields.
- Other iOS surfaces: only TodayView builds a built line; out of scope (the web Today card uses its own words).
- Tests: each table case fails on a wrong word, order or comma; "the moon" fails if a raw value leaks; the no-note case fails if the words drop; the decode case fails if the field is not read; the premise check fails if the web table changes.
- Reviewer NIT, not acted on: the page's __proto__ case adds little over the row's "the moon" case; kept as a second unknown value.
