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

- **Exit 2 (no record)**: WARN and promote, with or without `--force`. The warning says a first
  Kosmos+ sign-in was NOT verified on this build, and one line (UTC time, version, sha256, the
  ruling) is appended to `promote-plus-unverified.log` in the record directory
  (`$KOSMOS_PLUS_VERIFY_DIR`, else `$HOME/.local/state/kosmos/release-verify`, where the records
  themselves live). So "which prod builds shipped without that check" stays answerable from a
  file, not from somebody's scrollback. A log that cannot be written never stops the promote; the
  output says so instead.
- **Unchanged**: exit 1 (a record that says FAIL, or is ambiguous) still refuses and is not
  forceable. That is a measured break, not a missing check, and the ruling is about not having to
  run the check. Exit 0 still promotes. The two other Mac gates, the Windows family, and the need
  for Josh's go on prod are all unchanged.
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
- The existing cases stand: a FAIL record refuses and is not forceable; a pass promotes.
- The test points `KOSMOS_PLUS_VERIFY_DIR` at its sandbox, so a local run never writes into the
  real `~/.local/state`.

## Weakest premise

That the ruling covers a MISSING record but not a FAILED one. Josh said he does not care whether
the Kosmos+ path is checked "all the way or not"; a failing record is a check that WAS run and
found a break, and refusing on it matches "Josh's prod go is still required" in Splinter's ask. If
Josh wants even a recorded failure to warn, it is the `1)` arm, one line.
