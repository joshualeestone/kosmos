# Fix: test-install.sh EXPECTED_ADDS must include the #2066 source-channel file

## Why (cut-blocker)

The 6.31 staging cut aborted at step 4b (the real sandboxed install gate, test-install.sh). #2066
added a source-channel write to setup.sh (records which channel pointer the build was fetched from,
into `<store.ROOT>/source-channel`). A real install now creates `./AgentWorkforce/source-channel`,
but test-install.sh's EXPECTED_ADDS (the install-written-files manifest) did not list it, so the
gate reported "added, not expected: ./AgentWorkforce/source-channel" and aborted.

First cut including #2066 (0.6.30 predated it); step 4b only runs in a real cut, not #2182's
unit-test CI, so it surfaced now. The #2066 challenge-loop reviewed the write but not the
install-gate manifest.

## Fix

Add `./AgentWorkforce/source-channel` to `EXPECTED_ADDS` (test-install.sh:158), sorted LAST (the gate
compares a `find | sort`-ed ADDED to EXPECTED_ADDS, and `./AgentWorkforce/source-channel` sorts after
the `./AgentWorkforce/bin/*` entries -- verified in C and default locale). source-channel is
install-written (setup.sh), like the supervisor / codex-bridge / engine-path already there, so it
belongs in EXPECTED_ADDS (not the boot-written exclusion list). Updated the comment + the check
message to name it. Also fixed one pre-existing em dash (line 764) in the same file (Josh's rule).

The abort message confirms source-channel IS added by the sandbox install, so EXPECTED_ADDS listing
it will match. The re-cut's step 4b is the authoritative proof.

## Scope

test-install.sh only. Adds the audit-checklist learning (Splinter): the pre-cut audit should
cross-check EXPECTED_ADDS against recently-merged install-writing changes.
