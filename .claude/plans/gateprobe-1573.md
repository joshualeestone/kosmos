# gateprobe-1573: the gate could not see the one thing #1556 shipped

## The defect, and it is smaller and stranger than I filed it

Every other `node ./server.js` boot site in `tools/browser-checks.sh` sets
`AGENT_WORKFORCE_DRY_RUN=1` (`boot_thread_server` boots a different script and is not
one of them). A dry-run
probe returns `{ok:true, dryRun:true}` **without executing**, and #1556 correctly scores
that as "we did not check", so `willInstall` is unconditionally true on a dry-run board.

⇒ The confirm-skip path #1556 delivered was **unreachable by the gate, by construction**.
No amount of care writing a check would have found it.

## 🛑 The finding: the stub was already there and could not be reached

Board `sb4` already boots with a `fake-claude` whose `--version` arm echoes a version and
exits 0. It was written deliberately, with a comment explaining that two callers reach it
and that a sandbox must not fall through to the operator's real Claude.

**The same env block sets `AGENT_WORKFORCE_DRY_RUN=1`.**

⇒ **Two correct mechanisms, one env block, cancelling.** The stub answers a question
nothing asks; the flag ensures nothing asks it. Nobody was careless.

### The rule that generalises

**Dry-run neutralises a subprocess by FAKING SUCCESS, which is exactly what makes a probe
unobservable. A stub neutralises it by being HARMLESS, costs the same, and leaves the
probe visible.**

Anything gated on "did this external thing actually work" is invisible on a dry-run
board, however good the check is.

## What this adds

- `docs/browser-checks/render-connect-skip.js`, **two arms**. A skip-only assertion would
  pass on a build where the confirm can never open at all, which is the pre-#1556 defect
  inverted, so the broken-launcher arm is not optional.
- Two boards that omit `AGENT_WORKFORCE_DRY_RUN` and use stub launchers instead.
  `pick_ports` raised from 13 to 15.

🛑 **THOSE BOARDS ARE READ-ONLY, AND THAT MEANS NO MUTATION, NOT "NOTHING REAL RUNS".**
An earlier draft here listed launchd and the network among the things these boards do
not touch, and the script's matching sentence
was removed as a hazard. Both halves were wrong:

- **Real launchd READS happen with nothing clicked.** `/api/status` calls
  `create.disabledJobs()` and `runningJobs()`, which run `launchctl print-disabled` and
  `launchctl list` against the operator's real session, and `wait_up` curls that route
  before any check starts. Non-mutating and fail-soft, which is why the pair is fine.
- **A check that PRESSES A BUTTON would mutate it**: `create.js`'s `run()` no longer
  short-circuits, so `launchctl bootstrap` and `enable` hit the real login session. The
  plist path is sandboxed; the registration is not, which is #1539.

⇒ That restriction is no longer prose. `tools.browser-checks-wired.test.js` asserts
exactly ONE `run_one` targets `$P14`/`$P15` and that it is `render-connect-skip`.
Perturbed: a second check pointed at those boards goes red.
  `pick_ports` raised from 13 to 15.

Measured, run exactly as the gate runs it: **7/7, exit 0.**

```
working launcher   FR.connect {"willInstall":false}   confirm SKIPPED
broken launcher    FR.connect {"willInstall":true}    confirm OPENS, flat sentence
```

**That is #1556 at "behaviour measured".** I withdrew that claim on #1556 at 01:57
because the test I cited passes unchanged on main. It is earned now, by the only thing
that could earn it: somebody watched a browser do it.

## My own guard caught this, which is the argument for having written it

`tools.browser-checks-wired.test.js` (from #1575, merged hours ago) asserts every
`node ./server.js` boot site sets dry-run. **These two boards deliberately do not, so it
went red.** That is the guard working: without it, this change would have silently made
the #1575 comment false, which is precisely the rot it exists to prevent.

Resolved with a **NAMED exemption**, not a loosened assertion, and the narrowness is
perturbation-verified:

```
a third rogue boot with no dry-run, not the exempt pair   -> RED
strip dry-run from boot_board                              -> RED
restore                                                    -> 5 pass
```

Widening it to "most boots" would have thrown away the property it exists to hold. The
#1575 comment is updated in the same commit, so the sentence and the guard agree.

## Scope correction against myself

#1573 said the fix "wants a deliberate decision rather than a patch from someone passing
through". **Wrong.** It is a stub and a flag on boards that already exist.

## What this does NOT do

It does not change how the existing six boards boot. A release gate is the wrong place to
rewrite a sandboxing model, and those boards are load-bearing for every other check.
