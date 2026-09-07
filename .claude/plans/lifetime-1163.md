# A lifetime axis for the clean-machine launchd witness (#1163)

Branch `lifetime-1163`. Addresses #1163.

## The problem (and a correction to my own earlier note on the card)

`clean-machine.sh`'s launchd witness (#566) classifies each changed `com.kosmos`
job by its plist PATH: REAL (real LaunchAgents dir) and OURS (this run's sandbox)
fail; SANDBOX (some other sandbox path) is a benign "observed, ignored" note;
UNKNOWN (gone before its path could be read) fails.

#1163's incident: a `com.kosmos.board` job with `RunAtLoad`, registered under a
walkbase path, was classified SANDBOX and silently ignored - and it was still
live hours later, surviving logout, unattributable. The card's exact words:
**"The judge classifies OWNERSHIP [provenance]. It has no notion of LIFETIME."**

I had earlier annotated the card "probably superseded by #566." That was wrong
in direction and is retracted on the card: #566 is the provenance axis the card
says is INSUFFICIENT, not a fix for it. The card is live.

## Two consumers of lw_judge, both updated (a new verdict is a contract change)

`lw_judge` is a shared function with TWO consumers, and adding the `PERSIST`
verdict is a breaking change for any consumer that does not handle it:
- **`clean-machine.sh`** - the cleanliness verifier (updated: loud non-failing warning).
- **`tools/sweep-leaked-supervisors.sh`** - the leaked-supervisor REAPER. Its
  `case` was `REAL|UNKNOWN|SANDBOX)` with no default, so an unhandled `PERSIST`
  would fall through SILENTLY: a persistent leaked job (the exact #1163 shape)
  counted in FOUND but never checked for a missing plist, never counted LEAKED,
  never reaped - and since the sweep feeds an empty "before", EVERY persistent
  non-real job took that path, so `--reap` would report "nothing leaked" on the
  most dangerous job. Fixed: `SANDBOX|PERSIST)` handles PERSIST at least as
  strongly as SANDBOX (reaped when its plist is gone, surfaced when present).
  `test-sweep-leaked.sh` gains a persist arm that is a real regression guard -
  verified to go RED on the pre-fix sweep (persist-gone leak swallowed, "nothing
  leaked") and GREEN on the fix.

## The change

Add a LIFETIME axis, read from the same `launchctl print` seam the path is:

- **`lw_snapshot`** now emits `label<TAB>path<TAB>life`, where `life` is
  `persist` when the job's `properties = ...` line carries `runatload` or
  `keepalive` (it survives a logout), else `-`.
- **`lw_judge`** reclassifies a SANDBOX job marked `persist` as a new outcome
  **PERSIST**. REAL/OURS/UNKNOWN are unchanged (they already fail, and
  persistence never downgrades them). A 2-field snapshot line (no third field)
  reads as non-persistent, so every existing judge arm is unchanged.
- **`clean-machine.sh`** surfaces PERSIST as a distinct, LOUD, named warning
  ("survives logout, investigate and remove, cannot be attributed from its label
  alone"), and the run summary stops saying "all sandboxed test creates" when one
  was flagged.

## The call, and what I rejected

**PERSIST warns loudly; it does NOT hard-fail the run.**

- **Rejected: hard-fail on a persistent SANDBOX job.** A concurrent
  create-verification legitimately bootstraps `RunAtLoad` `com.kosmos.agent.*`
  jobs (verified on this machine: the live `com.kosmos.board` and several kosmos
  agents read `persist`), and `lw_judge` cannot tell a leak from another run's
  in-flight job - both are SANDBOX + persist. Failing would reintroduce exactly
  the #566 false-failure this witness exists to remove. So the escalation is
  loud-but-not-failing, and the site says so: to hard-fail instead, move PERSIST
  into the fail set - a one-line change.
- **Rejected: leave it as the quiet SANDBOX note.** That is the invisibility the
  card is about.

**Weakest premise:** that a loud warning is escalation enough. If the operator
wants a hard fail, the site names the one-line change. Second premise: that
`launchctl print`'s `properties` line is a stable persistence signal - if its
format changes, a persistent job degrades to `-` (read as transient), missing a
leak rather than false-failing; same best-effort posture as the existing path
read. The deeper attribution half the card pairs with this (stamp a walk's owner
into anything it launches) lives in the walk code, not this witness - a separate
follow-up, not this PR. Did NOT touch kwalk-0545 (PigeonPete's read-only
evidence, per the card's guard-rail).

## Proof

`tools/test-clean-witness.sh` drives the lib through its stubbed-launchctl seam.
Existing 7 arms unchanged (2-field lines read non-persistent). New arms:
- a persistent sandbox job -> PERSIST (the incident shape),
- a transient (`-`) sandbox job -> still SANDBOX (no false escalation),
- a persistent REAL job -> still REAL (persistence only escalates, never amnesties),
- the snapshot arm proves `persist` is captured from a `runatload` properties line
  and `-` from a print with none.

11/11 arms pass. Verified against real `launchctl` on this Mac: the persistence
read discriminates correctly (com.kosmos.board = persist, relay-cert-monitor = -).
