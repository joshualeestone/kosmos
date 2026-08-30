# Plan: create.js adopts the shared live-execution gate (#1598 follow-up)

**Branch:** create-js-adoption
**Repo:** agent-workforce
**Depends on:** #1627 (Renet's #1539), merged. Unblocked and greenlit by Splinter.

## Problem

create.js's run() was the last of the three live-execution modules (with
remove.js and delete-leftover.js) still on a narrower interim mechanism: the
#1539 launchctl-sandbox guard, which inferred intent from the environment and
covered launchctl alone. #1598's shared gate (engine/live-execution.js) is
strictly stronger: it keys on an explicit production opt-in and covers every
binary.

## The change

- Require engine/live-execution.js in create.js.
- Replace the #1539 guard block in run() (after `if (runner)` and `if (DRY_RUN)`,
  the ordering Renet mutation-verified) with:
    if (!liveExec.liveExecutionAllowed()) {
      liveExec.refuseOrWarn('engine/create.js', file, args);
      return { ok: false, stdout: '', liveExecutionRefused: true };
    }
- Retire everything that existed only for the #1539 guard: the guard, its test
  (engine/create.launchsandbox-1539.test.js), the launchIsSandboxed() predicate +
  export, the LAUNCHCTL_READS constant, and the run export.

## The load-bearing subtlety: OK-polarity (Renet's trap)

remove.js returns { ok: true, dryRun: true } on refuse. installJob here reads
`started = Boolean(r && r.ok !== false)`, so copying that shape would flip an
honest not-started into a SILENT started:true on the unauthorized path. create.js
therefore returns **ok:false** on refuse, keeping installJob honest with NO change
at the call site. This is deliberately NOT the literal "delete the guard, call the
gate" the old comment described.

## Testing

- The gate MECHANISM (throw-in-test / warn-in-prod / execute-when-opted) is
  already covered by engine.live-execution-1598.test.js via remove + delete-leftover,
  which use the same gate function.
- A create-specific unit test of the ok:false polarity is impractical to isolate:
  the return shape is only reached on the production warn-and-return path, which a
  `node --test` process cannot enter (refuseOrWarn throws first on --test), and run()
  is no longer exported. The polarity is guarded by an explicit code comment and by
  review. (Open to a test if the challenge-loop finds a clean, safe way.)
- Affected backend suites verified green: create.test.js + remove.test.js (191),
  the 1598 gate test (3).

## Out of scope (documented follow-ups, Renet)

- installJob writes the plist to the real LaunchAgents BEFORE the guarded calls.
- createAgentInner touches the real ~/.claude.json via trust.js before bootstrap.
The gate covers run(), not those fs writes; both are separate.

## Done when

create.js run() uses the shared gate with the ok:false polarity, the #1539
mechanism and its test are retired, the suite is green, and it passes a
challenge-loop.
