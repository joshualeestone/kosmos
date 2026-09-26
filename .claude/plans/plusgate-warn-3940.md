# #3940: a missing first-Kosmos+-sign-in record warns and is logged; it no longer holds a promote

**Branch:** `plusgate-warn-3940` · **Card:** kosmos#3940 (the promote gate #3940 added)

## The ruling

Josh, #admin, 2026-09-26 11:54 CDT, verbatim (relayed by Splinter):
> "Well, I don't care if we check the the Kosmos Plus path, all the way or not? Nobody's really
> using it yet. I'm the one that's testing it so I'm totally cool with making whatever we have the
> latest and greatest live so that I can then go test it. I don't need to test that part on
> staging. I'm more concerned about getting the Grok and Gemini agents configured right. And even
> that shouldn't hold us up from pushing this live."

The 0.6.97 prod promote (same morning) needed `--force` only because this gate had no record.

## The change (tools/promote-channel.sh, the Mac family only)

- **Exit 2 (cannot tell)**: WARN and promote, with or without `--force`. Exit 2 means one of: no
  record; an attempt still in flight (start ran, finish has not); or a gate that could not run
  (node or the record spec missing, a bad pointer). ⚠️ **An in-flight attempt is deliberately no
  longer waited for**: that is what "shouldn't hold us up" means, and the one case where a FAIL
  could land a minute after the promote. The warning says a first Kosmos+ sign-in was NOT verified.
- **The log line is written only AFTER the promote has happened** (pointer written, read back,
  alias refreshed), so a promote refused later (for example a staging publish landing mid-promote)
  leaves no line. It carries the UTC time, version, sha256, the ruling, and `reason=` the gate's
  own last line, so "no record", "in flight" and "the gate could not run" stay distinguishable. It
  goes to `promote-plus-unverified.log` in the record directory (`$KOSMOS_PLUS_VERIFY_DIR`, else
  `$HOME/.local/state/kosmos/release-verify`) OF THE MACHINE THAT RAN THE PROMOTE. A log that
  cannot be written never stops the promote; the output says so instead.
- The gate's own messages no longer say "HOLD" (tools/lib/plus-signin-record.js): they say "not
  verified", since the promote now proceeds past them.
- **Unchanged**: exit 1 (a record that says FAIL, or is ambiguous) still refuses and is not
  forceable. That is a measured break, not a missing check, and the ruling is about not having to
  run the check. Exit 0 still promotes. The two other Mac gates and the Windows family are
  unchanged. Josh's go for a Mac prod promote stays a process rule (this script has no flag for it).
- `tools/plus-signin-verified.sh`'s header no longer says exit 2 means HOLD.

## Deliberately NOT changed

- **Exit 1 stays a refusal.** The weakest premise of this plan (below) is exactly this choice.
- **The Windows verification gate** still HOLDs on a missing record: a different gate, and Josh's
  ruling was about Kosmos+.
- The agent-spawn gate still HOLDs on "cannot tell" (Mortals' board is a populated fleet, so
  that one still needs `--force` there). Josh said the Grok/Gemini configuration "shouldn't hold us
  up" either, but that is a different gate and was not the ask; noted on the card for Splinter.

## Tests (tools/test-staging-channel-2036.sh)

- No record, no `--force`: exit 0, promoted, the warning printed, "HOLDING" absent, exactly one
  log line naming the version.
- No record, with `--force`: exit 0, promoted, a second log line.
- No record and an unwritable log path: still promotes, and says it could not append.
- The log line carries the staged pointer's sha256 and `reason=` the gate's line.
- A promote refused AFTER a missing record (the mid-promote staging swap) leaves no log line.
- The existing cases stand: a FAIL record refuses and is not forceable; a pass promotes.

Red checks: the original promote-channel.sh fails all three new no-record cases (it HOLDs); the
first version of this change (logging inside the gate) fails "logs nothing" and the reason check.

Validation note: the first validation run had one red, engine/openaiaccounts.devicecode-3436
(a sign-in timing test) at load 30 on 10 cores; it passed alone twice, 15/15, and this branch
touches only tools/.
- The test points `KOSMOS_PLUS_VERIFY_DIR` at its sandbox, so a local run never writes into the
  real `~/.local/state`.

## Weakest premise

That the ruling covers a MISSING record but not a FAILED one. Josh said he does not care whether
the Kosmos+ path is checked "all the way or not"; a failing record is a check that WAS run and
found a break, and refusing on it matches "Josh's prod go is still required" in Splinter's ask. If
Josh wants even a recorded failure to warn, it is the `1)` arm, one line.
