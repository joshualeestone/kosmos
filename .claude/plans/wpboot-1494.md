# wpboot-1494: the log now says "I ran" before it says anything else

## The ambiguity, and it bit within an hour of the log landing

An empty result had two meanings and no way to tell them apart:

```
the code is not deployed        -> no directory
the code ran and saw nothing    -> no directory
```

⚠️ **And the first one happened.** #1518 merged, the board restarted, **and the
served checkout did not carry the file** (the shared tree was two commits behind,
correctly not pulled). For twenty minutes the absent directory meant "the code is
not there", and it looked exactly like "the scrape never fires".

**Three of us watched that happen, which is the only reason anybody could read
it.** Splinter's words: *"anyone reading it later without that context gets a
clean zero from a check that never ran."*

## The fix

A **boot line on the first `saw()` call, whatever the outcome**. One per process,
ever.

```
directory absent              the code is not there
boot line, no transitions     it ran and saw nothing
transitions                   it ran and saw things
```

⇒ **A log that needs no context to read.**

## ⚠️ Announced BEFORE the key check, deliberately

A board whose every card lacks a name **still ran**, and that is exactly the case
somebody would otherwise read as "not deployed". Perturbing the order fails its
own test.

## Perturbed

```
no boot line at all           -> red
announce AFTER the key check  -> red
announce on every call        -> red (it would be a heartbeat nobody asked for)
```

And a test that states the three reader-facing states in the order a reader asks
them, so the property is written down as a question rather than as an assertion
about a field.

Suite 3012 pass, 0 fail.
