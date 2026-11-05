# helpleak-7980: the --help marker cannot silence a real command; the subshell rule is pinned

Card: kosmos#7980 (follow-up to #7967, from its review rounds 6 to 8).

## Decided
- `cmd_community_with_reason` honours KOSMOS_HELP_REDISPATCH only for the bare verb (`$# -eq 0`), the one shape the
  global --help re-dispatch runs (`"$SELF" "$1"`), and unsets it before running the command, so nothing it starts
  inherits it. A variable exported by hand now silences only a bare `kosmos community`, whose output is its usage.
- Rejected: making the re-dispatch set it for community only (every verb's help child carries it, but only community
  reads it, so it changes nothing); a nonce tied to the parent pid (the subshell may or may not exec, so PPID is not
  stable).
- The BASH_SUBSHELL rule gets a test that drives the REAL say, _community_reason_line and cmd_community_with_reason
  (cut out of install/kosmos) with a stand-in cmd_community: an exit 5 inside $(...) then success writes nothing; the
  control (exit 4 in its own shell) writes the line and keeps 4.
- Weakest premise: that the re-dispatch always runs the bare verb. It does today (`"$SELF" "$1"`); if it ever passes
  arguments, help would print a failure line again (the #7967 --help test would catch that).

## Steps
1. The wrapper change in install/kosmos. done
2. Tests in cli.community-exit-reason-7967.test.js; each fails on its mutant (the `$# -eq 0` dropped; the
   BASH_SUBSHELL check dropped). done
3. Review 1 nits: a child of the command does not inherit the marker (fails with the unset removed); the comment says
   the re-dispatch is below; the test cutter checks the end of each function too. done
