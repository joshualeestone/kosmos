# wouldping-1494: log what a ping would have been, ping nobody

## The measurement nobody could take

The phone seam's automatic trigger **cannot fire for a Kosmos agent**: it hangs
off `PermissionRequest`, and all four supervisor launch paths pass
`--dangerously-skip-permissions`. Measured: **31,266 self-report entries, 23
`needs_you`, ZERO auto-written.**

So the board's red state runs on the **pane scrape**, and the scrape reaches the
seam not at all.

⇒ **Whether it should is a product decision, and it cannot be made without
knowing how often it would happen.** Nothing wrote that down, because a scraped
verdict is recomputed per read and never stored.

## What this does

`wouldping.saw()` records a **transition into a scraped `needs_you`** and sends
nothing. **No endpoint, no receiver, no switch, and it cannot wake anybody.**

**Splinter's framing, and it is the reason this shape works:** it needs no other
end, which is exactly the thing the seam does not have.

## Four decisions, each with its reason

**Transitions, never states.** `snapshot()` runs from 44 sites in `server.js` on
every poll. A line per read would be a log nobody could use.

**Reported ones excluded.** A reported `needs_you` already reaches the seam;
counting it would inflate the very number this exists to measure.

**Never throws.** A measurement must not break a read of the board.

**Every line carries its boot.** The previous state lives in memory, so a restart
re-arms every agent and the first read after one can log a continuation as a
transition. **Honest for a RATE, wrong for a TOTAL**, and the field is how a
reader knows.

## ⭐ A flaky test that was the defect, not noise

`sinceBoot` was `new Date().toISOString()`. **Two boots inside the same
millisecond produced the same value**, which defeats the entire purpose of the
field. Now a timestamp plus 4 random bytes: **time for a human, random for the
machine comparing it.** Five consecutive runs, 0 failures.

## ⭐ And a reachability test that could not see a dead call

Perturbing the call site to `if (false) wouldping.saw(...)` left the test
**GREEN**, because the text was still there.

⇒ Strengthened, **and its limit is written into it**: it catches the obvious
dead-branch spellings and is still a text check. The honest claim is **"not
trivially disabled"**, not "reached".

## Perturbed, five arms

```
log REPORTED ones too            -> red
log every read, not transitions  -> red
drop the sinceBoot field         -> red
let it reach the network         -> red   (the NOBODY IS PINGED test)
unwire it behind if (false)      -> red   (after strengthening; GREEN before)
```

## 📌 What I did wrong while building it

**My first smoke test ran unsandboxed and wrote a real line into the operator's
Application Support directory.** That is the #1443 defect, committed by me an
hour after fixing it. Removed the directory, and the test file now sandboxes
**before requiring the module**, with a control asserting the log path is inside
the sandbox.

Suite 3008 pass, 0 fail.
