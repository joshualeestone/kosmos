# reachable2-5548: triage the 34 exports #5548 slice 1 surfaced (kosmos#5548, slice 2)

Stacked on reachable-5548 (PR #5577, slice 1).

## Finished means
PENDING_5548 is gone: every export slice 1 newly saw is either reached (bin/ now scanned), excused by FILE with a
reason someone can check, or tracked on a card as a real unreachable capability. The shrink-only check carries over.

## Evidence
A research pass over all 34 (git grep outside tests, string-form greps in server.js / web/index.html, git log -S for
each adding commit, card state). Table: kept in the scratchpad and summarised on #5548.

## Decided
- bin/ joins CALLER_FILES: bin/class1-autohandle.js calls sweepClass1, bin/agent-supervisor.sh calls retireLauncher
  (node -e). They were never orphans; the sweep could not see them.
- Excused by file (TRIAGED_5548), by category: 14 test seams (each's source comment or role says so), 1 internal
  exported for its test, 9 thin accessors of a sibling production calls, 4 superseded (deletion on #5582),
  labelFor (slice 2 of OPEN #4375), HANDOFF_CHECK_FOR_SERVING_AFTER_MS (mirrored in KosmosLauncher.cs, pinned by a test).
- Two REAL unreachable capabilities: exportAgent (the export half of #1652, card #5581) and minInterval (the
  connections-sweep guard of #1645, never wired, card #5583).
- Rejected: deleting the superseded five and the accessors now. Each costs test edits (setArchived is a fixture in six
  files), the risk is not worth it in a guard change, and #5582 carries it.
- Weakest premise: the research's per-name category. For offeredTools/deriveCatalog the in-file callers were not all
  read; "internal" fits either way (exported for a test). An entry is cheap to correct.

## Checks
- engine.reachable.test.js: 7 tests (guard; reads every block; triaged covers only its file and is still exported;
  triaged only shrinks; pending-file and self-test). Mutations: bin/ removed -> guard red; an entry removed -> guard red;
  a fake entry for a called name -> shrink-only red.

## Review 1 (sonnet, blind, spot-checked 25 entries): 2 WARNING + 1 NIT
- [WARNING] ALLOWED_TOOLS, deriveCatalog, offeredTools were "used inside its own module": false, nothing in the module
  uses them --> FIXED: recategorised as test seams of #5346's capture hardening, with accurate reasons.
- [WARNING] bin/ callers matched on raw text, so its shell scripts' comment lines could hide an orphan --> FIXED: bin/
  JS through codeOnly, shell scripts lose full-line comments (not trailing #: JS inside node -e). Test: the comment
  strip leaves no full-line comment and keeps retireLauncher's real call. Mutation (no strip) -> red.
- [NIT] labelFor's "OPEN #4375" is an unchecked card state --> checked: #4375 is open.
Reviewer found no dangerous-direction entry (no real capability hidden as a seam or accessor).

## Review 2 (opus, blind): 1 WARNING + 2 NIT
- [WARNING] minInterval was excused as SUPERSEDED, false in the dangerous direction: inflight.js says compose it OVER
  collapse, and the route's own comment says collapse is no defence against a sequential loop; the #1645 plan left
  the wiring undone --> FIXED: an unreachable capability on new card #5583 (wire or delete); removed from #5582, whose
  body and title are corrected (four exports).
- [NIT] plan said 6 tests --> 7.
- [NIT] a future non-JS, non-shell file in bin/ would be stripped as a shell script; JS comments inside node -e and
  trailing # comments are not stripped --> recorded: no current case; the remaining way to hide an orphan is named.
Reviewer verified the shebang in bin/*.js blanks only part of line 1 (output after line 1 identical with and without).

## Review 3 (sonnet, blind): CONVERGED (nothing above NIT)
Spot-checked the 17 entries reviews 1 and 2 had not: none hides an unreachable capability or unwired defence.
- [NIT] IMPORT_CONTRACT "importAgent reads it" was inaccurate (it is declarative; tests assert the enforcement matches)
  --> FIXED wording.
