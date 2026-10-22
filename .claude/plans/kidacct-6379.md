# kidacct-6379 (kosmos): the family proof signs the child in at a parent plus-address

Card: kosmos#6379 (PigeonPete's decision, built by Baron). Part 3 of 3: part 1 is kosmos-relay #554 (merged), part 2 is
the terms branch kidterms-6379 (chaoskosmos-site, waits for Kids launch).

## The change
`tools/family-e2e-6239.js` makes the child's account at `parent-<run>+kid@example.com`, a plus-address of the parent's,
instead of `kid-<run>@example.com`. The console (kosmos-relay #554) tells a parent to make a child under 13's account
at an address the parent reads; a plus-address of the parent's is one way to do that, and the one this proof uses.

## Measured
- The board's address rule (`server.js` EMAIL_RULE, `^[^\s@]+@[^\s@]+\.[^\s@]+$`) and the coordinator's
  (`util.rs` looks_like_email: refuses only control and invisible characters) both accept a plus-address. The harness
  reads codes with `\S+`, which includes `+`.
- Run on Agent1s 2026-10-21 22:20 (log ~/.cache/claude-handoffs/baron-jobs/e2e-6379.log on Agent1s): debug binaries
  built from kosmos-relay 602609433 (the head later gated and squash-merged as #554, 6f642327), kosmos e7b7a6046d with
  this harness edit. Steps 1 to 4 PASS, including the child's account at the plus-address and "K signs in as the child".
- That run is red at step 4b, and so is a control at 00:25 with main's own unedited harness on the same binaries (log
  e2e-6379-control.log, same folder). That red is already on main and is filed as kosmos#6887. Steps 7 to 11 (the child joining under the family's words) are
  therefore not proven by either run.

## Weakest premise
That nothing after step 4 depends on the child's address being distinct from the parent's. The child's account is
its own account (a different address string), but the steps that would show it end to end are behind #6887.
