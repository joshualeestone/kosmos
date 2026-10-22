# kidacct-6379 (kosmos): the family proof signs the child in at a parent plus-address

Card: kosmos#6379 (PigeonPete's decision, built by Baron). Part 3 of 3. Part 1 is kosmos-relay #554 (merged); part 2
is the terms branch kidterms-6379 (chaoskosmos-site), which waits for Kids launch.

## The change
`tools/family-e2e-6239.js` makes the child's account at `parent-<run>+kid@example.com`, a plus-address of the
parent's, instead of `kid-<run>@example.com`. The console (kosmos-relay #554) tells a parent to make a child under
13's account at an address the parent reads; a plus-address of the parent's is one way to do that, and the one this
proof uses.

## Measured
- Both address rules accept a plus-address. The board's `EMAIL_RULE` (server.js) is `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
  The coordinator's `looks_like_email` (util.rs) needs 3 to 254 bytes and exactly one `@` with text on each side,
  and refuses whitespace and control or invisible characters; `+` is none of those. The harness reads codes with
  `\S+` and compares addresses with `===`, so the `+` is never a regex quantifier.
- Run on Agent1s 2026-10-21 22:20 (log ~/.cache/claude-handoffs/baron-jobs/e2e-6379.log): debug binaries built from
  kosmos-relay 602609433 (the head later gated and squash-merged as #554, 6f642327), kosmos e7b7a6046d with an
  earlier wording of this edit (the same address; only step 4's check label differed). Steps 1 to 4 PASS, including
  the child's account at the plus-address and "K signs in as the child".

## Reasoned, not re-checkable
- The run is red at step 4b, and so was a control at 00:25 (log e2e-6379-control.log, same folder): its step 4 label
  is main's original wording, so it ran main's unedited harness. That it used the same binaries is reasoned, not
  shown: its script pointed at the same build folder, and that folder was written only by the 22:20 build. The folder
  and the control's copy of the harness are both deleted now, and the control log prints no sha. The 4b red is filed
  as kosmos#6887.

## Not proven
Because of 4b, step 6 (the parent's console call) is refused and steps 7 to 11 never run in either log. In particular
the two places where the child's address is compared after step 4, the `m.email === kid` lookups in step 9b's control
and in step 9b (tools/family-e2e-6239.js, about lines 604 and 624), have never run with a plus-address. By reading:
the coordinator's `normalize_email` only trims and lowercases, and `<run>` is lowercase hex, so those compares should
hold. That is reasoning; it waits on #6887.

## Weakest premise
That nothing after step 4 depends on the child's address sharing the parent's mailbox name. The child's account is
its own account (a different address string), but the steps that would show it end to end are behind #6887.
