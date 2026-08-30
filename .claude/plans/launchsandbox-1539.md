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
  fails AND a real launchd job appears (delta 1); restored, delta 0. Cleaned up
  immediately and audited with `pgrep` (0), `launchctl list` (0 kosmos jobs), and
  the fleet's 18 sessions intact.

⚠️ That mutation is the one experiment in this work that can start a real agent.
It is safe only because the predicate is asserted first and `claudeBin` is
`/bin/echo`. Anyone repeating it should keep that order and prepare the cleanup
before running it, not after.

## Not done

The wider default-is-live property is not changed. `DRY_RUN` still initialises
false, and this guard only covers launchd mutations under a redirected plist
path. Making the module default to safe is a larger change with a different
blast radius.
