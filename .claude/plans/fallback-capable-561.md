# fallback-capable-561: a guessed CLI must be VERIFIED to speak `report`

## Why, and it is a defect I shipped two hours earlier

#1479 gave the resolver two location-independent fallbacks so a hook copied elsewhere
stops returning EMPTY. **One of them is wrong on this very machine**, and my own card
#561 said so on 2026-08-24:

> `~/.local/bin/kosmos` is a STALE INSTALLED BUNDLE ... His first resolver picked it, and
> every report NO-OPPED SILENTLY.

Measured again today with the fake-verb control:

```
~/.local/bin/kosmos  report      -> exit 2
~/.local/bin/kosmos  zzfakeverb  -> exit 2      IDENTICAL, so the verb is unknown
source checkout CLI  report      -> speaks it   (control, must differ)
```

## What was actually wrong, stated accurately

**Not silence.** The SessionStart guard already catches an incapable CLI loudly, and it
greps for the word rather than the exit code precisely because both are 2.

**It is a PREFERENCE defect:** the stale bundle SHADOWS a capable `kosmos` on PATH, so
reporting turns off for a session that could have had it.

## The change

The two fallback rungs now probe with the same test the SessionStart guard uses. The
`$HERE` rungs deliberately do NOT probe: they found the CLI by its RELATIONSHIP to this
file, so they are right by construction. **The fallbacks are guesses, and a guess is what
needs checking.** Cost is bounded to the guessing case; a real layout returns above.

## Two defects this found in my own test

1. **The `~/.local/bin` fixture was a bare stub**, so it could not exercise a probe.
2. **🛑 Two controls were VACUOUS.** They set `PATH` to the fixture dir alone, so **`bash`
   itself was not findable** and `resolve` returned empty because it could not RUN. They
   were passing for a reason unrelated to the resolver. Found only because a perturbation
   that should have failed **did not**, which is the one signal that can reveal this.
