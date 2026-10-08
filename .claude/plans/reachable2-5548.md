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
- Excused by file (TRIAGED_5548), by category: 11 test seams (each's source comment or role says so), 4 internals
  exported for their tests, 9 thin accessors of a sibling production calls, 5 superseded (deletion on #5582),
  labelFor (slice 2 of OPEN #4375), HANDOFF_CHECK_FOR_SERVING_AFTER_MS (mirrored in KosmosLauncher.cs, pinned by a test).
- exportAgent is a REAL unreachable capability (the export half of #1652): card #5581 to wire or delete it.
- Rejected: deleting the superseded five and the accessors now. Each costs test edits (setArchived is a fixture in six
  files), the risk is not worth it in a guard change, and #5582 carries it.
- Weakest premise: the research's per-name category. For offeredTools/deriveCatalog the in-file callers were not all
  read; "internal" fits either way (exported for a test). An entry is cheap to correct.

## Checks
- engine.reachable.test.js: 6 tests (guard; reads every block; triaged covers only its file and is still exported;
  triaged only shrinks; pending-file and self-test). Mutations: bin/ removed -> guard red; an entry removed -> guard red;
  a fake entry for a called name -> shrink-only red.
