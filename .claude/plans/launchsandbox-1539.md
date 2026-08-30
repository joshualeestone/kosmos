# launchsandbox-1539: a sandboxed plist path must mean a sandboxed registration

## The problem

`AGENT_WORKFORCE_LAUNCH` sandboxes where a plist is **written**. It does not
sandbox the `launchctl` **registration**, and nothing about the variable's name
says so.

A test that redirected it, believing itself sandboxed, bootstrapped three real
agents into the operator's own user domain: three tmux sessions, three
`claude --dangerously-skip-permissions` processes with cwd in `$HOME`, and three
loaded launchd jobs.

## How the dangerous configuration is reachable, which is the non-obvious part

`create.js` already refuses it **through its setters**:

- `setRunner(null)` forces `DRY_RUN = true`
- `setDryRun(false)` **throws** without an injected runner

⇒ So neither setter can produce it. What produces it is calling **neither**:
`DRY_RUN` initialises from `AGENT_WORKFORCE_DRY_RUN === '1'`, which nothing sets,
so a module that is merely required and used runs **live**. That is exactly how
it happened: one added `installJob` call in a file that never touched the seams,
because no existing test needed to.

## The fix

One guard in `run()`, refusing the launchctl verbs that **mutate** the user's
launchd domain while the plist path is redirected.

**Both directions are harmful, which is why `bootout` is on the list.** A test
that believes it is sandboxed can start real agents, and can equally tear down a
real one, taking a live agent off the fleet with no trace in its own output.

**Reads are deliberately not listed.** `print`, `print-disabled` and `list`
change nothing, and blocking them would break sandboxed tests that legitimately
enumerate.

## The card's open question, answered by measurement

The card worried this guard "could break a legitimate sandboxed-install test that
WANTS the registration". Measured: **five PRE-EXISTING** test files call
`installJob`, and every one sets an injected runner and/or DRY_RUN, so all five
are short-circuited before the guard. (Six files call it now; the sixth is this
card's own, which deliberately sets neither.) It breaks nothing that exists; it is for the
next test.

## Verification

- full suite: see the figure at the END of this file, which is the only one kept current
- the predicate on four arms: unset -> false, redirected -> true, the real dir ->
  false, and the real dir **with a trailing slash** -> false (without
  `path.resolve` that reads as sandboxed and every real install is refused, which
  breaks production rather than a test)
- **the guard was mutation-tested against the real hazard**: disabled, the test
  fails AND a real launchd job appears; restored, none appears.

🛑 **THAT AUDIT SENTENCE WAS FALSE WHEN FIRST WRITTEN, AND THE WAY IT WAS FALSE
IS THE MOST USEFUL THING IN THIS FILE.** A later inert-guard mutation registered
a REAL launchd job (`com.kosmos.agent.sandboxprobeu1cz4k`, KeepAlive, forking,
pid 28152) which ran for 18 minutes on the operator's machine. My own audit did
not see it, and could not have:

    I measured a DELTA. The job was created by an earlier mutation arm, so it
    existed BEFORE my baseline. before == after, and the delta read 0.
    The arithmetic was correct. The instrument worked. A control would have
    passed. The baseline was simply taken after the damage.

⇒ **AFTER MUTATING A GUARD THAT PREVENTS AN ACTION, MEASURE THE ABSOLUTE, NOT
THE DELTA.** The sequence makes the trap near-inevitable: you mutate the guard
IN ORDER TO let the action through, so the action happens, and only then do you
audit.

✅ Every mutation arm in this work is now checked against an **absolute count**
captured before the first mutation of the session, and the inert-guard arms are
run with `--test-name-pattern` so they never reach the `installJob` arm at all.
Found by the iteration-2 reviewer, not by me. Job removed, verified 0 with
controls both ways, fleet's 18 sessions intact.

⚠️ That mutation is the one experiment in this work that can start a real agent.
It is safe only because the predicate is asserted first and `claudeBin` is
`/bin/echo`. Anyone repeating it should keep that order and prepare the cleanup
before running it, not after.

## Not done

The wider default-is-live property is not changed. `DRY_RUN` still initialises
false, and this guard only covers launchd mutations under a redirected plist
path. Making the module default to safe is a larger change with a different
blast radius.


---

# Iteration 1 review: two BLOCKERs, both mine, both fixed

## BLOCKER 1: the predicate did not measure the property it claimed

The docstring stated the invariant in terms of WHERE THE PLIST IS WRITTEN, which
is `agentsDir()`. The predicate read `process.env.AGENT_WORKFORCE_LAUNCH`, which
is only ONE of that function's two inputs, and compared it against `homeDir()`,
which is `os.homedir()` and honours `$HOME`.

⇒ A sandbox that redirected `HOME` moved the plist and the predicate did not
follow. Worse, `HOME` spoofed AND `AGENT_WORKFORCE_LAUNCH` set to
`$HOME/Library/LaunchAgents` (the most natural layout, because it mirrors
production) moved BOTH sides and cancelled out, reading as production.

Not hypothetical: 17 test files in this repo set `process.env.HOME`, 13 of them
alongside AGENT_WORKFORCE_LAUNCH.

Fixed by comparing `agentsDir()` against `os.userInfo().homedir`, which reads the
passwd entry and is not spoofable by the environment. Fails CLOSED if that
throws. Mutation-verified: reverting the predicate turns the new arm red.

## BLOCKER 2: my READS control could not fail, twice

v1 asserted `doesNotThrow`. A blocked read does not throw: the guard RETURNS
`{ok:false, stdout:''}` and the parser fails soft to an empty Set. Structurally
blind to the regression it was named for. Proven by mutation: blocking both read
verbs left all four tests green.

v2, my own first fix, asked the same question through an injected runner. `run()`
short-circuits on a runner BEFORE the guard, so the stub answered and the guard
was never in the path. Also proven by mutation: blocking `list` left it green.

⇒ I wrote a broken control, fixed it, and wrote a differently broken one. Both
were caught by mutation and neither by reading.

v3 calls `run()` directly with no runner and no dry-run, asserts each read verb is
NOT refused, and carries a control asserting a mutating verb IS. Mutation-verified
both ways: blocking `list` -> red; making the guard inert -> red.

## Shape changes from the WARNINGs

- **Allowlist, not denylist.** `LAUNCHCTL_READS = [print, print-disabled, list]`,
  everything else treated as a mutation. The old denylist omitted `load`,
  `unload`, `remove`, `start`, `stop`, `submit`, `kill` and more, and
  `load`/`unload` are the legacy spellings of the two verbs it did list, which is
  what every macOS doc shows. Default-is-dangerous, the same shape that caused
  this card.
- **Basename, not an exact path.** `delete-leftover.js:257` already calls
  `run('launchctl', ...)` bare.
- **The comment is scoped.** It claimed the invariant unconditionally while
  guarding one of three seams. Now states what it does not cover, and points at
  #1598.
- **The test file sandboxes DATA and PROJECTS.** It was writing three files into
  the operator's REAL Application Support on every run, one of which every live
  agent reads. `AGENT_WORKFORCE_HOME` was set and did nothing (create.js never
  reads it); removed rather than left reading as protection.
- **`run` is exported as a labelled test seam** so the refusal message can be
  asserted at all, because no public path surfaces it.

## Still not fixed, deliberately

`remove.js` and `delete-leftover.js` hold the same seam unguarded. Filed as
#1598 with measurements. The tmux half is the worse half: a booted launchd job
returns at next login, a killed pane does not.




---

# Verification, and this is the ONLY figure in this file kept current

    suite                    3131 pass, 0 fail
    ABSOLUTE kosmos jobs     0 before, 0 after   (not a delta, see the note above)
    tmux sessions            18 before, 18 after

⚠️ Earlier sections of this file quoted 3123 and then 3125, in the same document,
and both were stale by the time anyone could read them. A verification section
that disagrees with itself is unciteable, so the figures were removed from those
sections rather than updated, and this is the one place a number lives.

# Iteration 3: a BLOCKER that would have broken production silently

Keying the guard on `sandbox.audit().set` refused registration in a REAL install.
`install/setup.sh` exports DATA, PROJECTS and WORKERS for a non-default
`KOSMOS_HOME` (:2635-2637), DELIBERATELY leaves LAUNCH unset so plists go to the
real LaunchAgents, and exports `AGENT_WORKFORCE_HALF_SANDBOX_OK=1` (:2662) as
sandbox.js's own named escape hatch for that shape. All four are written into the
board plist's EnvironmentVariables (:2782), so the server carries them at every
login.

Measured: with that env `set.length` is 3 and `partial` is FALSE. Reading `.set`
bypassed the escape hatch, `installJob` reported `started: false`, and
`createAgentInner` rolled the whole creation back. Silently, on every
non-default-KOSMOS_HOME install, forever.

🛑 **THAT SENTENCE WAS FALSE AND IT WAS PUBLICLY VERIFIED BEFORE IT WAS CAUGHT.**
`tools/test-install.sh` does NOT always pin `AGENT_WORKFORCE_LAUNCH`: it
deliberately unsets it at :1812 and :1867. A colleague checked my claim by
counting 30 pins, which is correct and **cannot see an unset**.

✅ **The conclusion survives on stronger ground.** `tools/test-install.sh:223`
exports `AGENT_WORKFORCE_DRY_RUN=1` globally, and this guard sits BELOW the
`if (DRY_RUN)` short-circuit, so it is inert for that entire harness regardless of
what LAUNCH is doing. The gate genuinely could not have caught it, for a broader
reason than the one I gave.

⭐ **The reusable part: an outside check inherits the asker's framing.** I handed a
colleague my EVIDENCE to verify rather than my CONCLUSION, so his check could only
ever say "the evidence holds". It had no way to say "the question is wrong".

⚠️ And `.partial` alone was not the fix either, which I asserted without measuring
and was wrong about: with only LAUNCH set, `partial` is TRUE, so pointing LAUNCH
at the real directory would still have been refused. The condition actually wanted
is "somebody sandboxed something OTHER than LAUNCH and did not say the
half-sandbox was deliberate". LAUNCH's own value is judged by the path comparison,
where it belongs.

Both arms are now asserted, with the control being the same env minus the escape
hatch.
