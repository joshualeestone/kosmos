# createenable-4254: re-creating a removed agent's name starts (kosmos#4254)

## What
`remove` makes a removal stick with `launchctl disable gui/<uid>/<label>`, a per-user override that outlives the
plist. Create's `started it` step ran `launchctl bootstrap` without `launchctl enable` first, so re-creating a
removed name bootstrapped into a standing disable: refused every time, and the name could never be used again on
that Mac. Create now runs `launchctl enable` on the label before `bootstrap`, best-effort, exactly as the
adopt/repair path (engine/create.js, "enable BEFORE bootstrap") already does.

## Tests
- create.test.js "the agent is started the same way it will be started every time after": `enable` is excluded
  from the one-starting-command count by name (it starts nothing), and the test asserts `enable` runs, before
  `bootstrap`, on this agent's own label. Red with the enable call removed.
- The half-written-agent test's CONTROL excludes `print` and `enable` by name and counts everything else (a good
  create now also runs `enable`). The
  zero-mutation assertions elsewhere are unchanged and still correct: `enable` is a mutation, and those paths stop
  before the start step.

## Not done (decided)
- A remove-then-create test through fakes: the order assertion tests the mechanism; a fake launchd that models the
  override would test the fake.
- Windows: removal disables the Scheduled Task (`/Change /DISABLE`), and create re-registers with `/Create /F`, which
  replaces the task definition including its enabled flag. REASONED from source, not measured (no Windows box here).

## Weakest premise (now MEASURED)
Measured on macOS 26.7 with a throwaway `/usr/bin/true` job, both arms: never disabled, bootstrap rc 0 and loaded;
after `launchctl disable`, bootstrap rc 5 (`Bootstrap failed: 5: Input/output error`) and NOT loaded; `enable` then
bootstrap, rc 0 and loaded. So the standing disable is what refuses the re-create. Not measured: older macOS
versions, where the repair path's comment claimed a bootstrap that "succeeds and starts nothing"; the fix is the
same either way. The probe leaves an `enabled` override entry for its own label (harmless).

## Review record
- Round 1 (opus): no BLOCKER, no WARNING. NIT the half-written test's control was loosened to count only `bootstrap`
  -> restored to the exclude-by-name form (`print` and `enable` excluded, everything else counts); perturbed: with
  create's bootstrap removed that test goes red. NIT my comment (refused) and the repair path's (succeeds, starts
  nothing) disagreed -> measured (above): refused. The repair-path comment is corrected to the measurement.
- Round 2 (sonnet): W register.test.js still carried the disproven "succeeds and starts nothing" claim for the same
  repair path -> fixed. My own sweep (any wording, whole tree, not just the phrase the reviewer searched) found four
  more copies: install/setup.sh x2 (board and watchdog jobs) and the enable-before-bootstrap assertion messages in
  create.test.js and register.test.js -> all now say refused, with the measurement. Comment and message lines only;
  292/292; setup.sh parses. Noted, NOT changed: installJob and create's start step each carry the enable-before-
  bootstrap order with no shared helper (pre-existing split; both are now asserted by their own tests).
- Round 3 (opus): W README's hand-removal note said a later create of the name is refused by launchd; false since
  this fix (create enables first) -> it now says create enables, and only a bootstrap without enable is refused. It
  was not a copy of the corrected phrase, so the round-2 sweep by phrase could not find it; found by meaning. N the
  plan's Tests section still described round 1's loosened control -> fixed.

