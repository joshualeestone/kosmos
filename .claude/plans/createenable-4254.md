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
- The half-written-agent test's CONTROL counts `bootstrap` itself (a good create now also runs `enable`). The
  zero-mutation assertions elsewhere are unchanged and still correct: `enable` is a mutation, and those paths stop
  before the start step.

## Not done (decided)
- A remove-then-create test through fakes: the order assertion tests the mechanism; a fake launchd that models the
  override would test the fake.
- Windows: removal disables the Scheduled Task (`/Change /DISABLE`), and create re-registers with `/Create /F`, which
  replaces the task definition including its enabled flag. REASONED from source, not measured (no Windows box here).

## Weakest premise
The card inferred, and I did not measure, that the disable override is what makes bootstrap fail. It rests on the
repair path's own comment naming the mechanism and on the card's fresh-name-works / removed-name-fails contrast.
The fix is harmless if the premise is wrong: `enable` on a label that is not disabled changes nothing.

## Review record
