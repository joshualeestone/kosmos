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
WANTS the registration". Measured: five test files call `installJob`, and **every
one** sets an injected runner and/or DRY_RUN, so all five are already
short-circuited before the guard. It breaks nothing that exists; it is for the
next test.

## Verification

- full suite **3123 pass, 0 fail**
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

Suite 3125 pass, 0 fail. launchd delta 0, tmux delta 0.
