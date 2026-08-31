---
method: pre-challenge
branch: syncstart-1649
diff_hash: c93673616804a7bc2c3af79f3c4d9945fbe295f5cf90a2035ca9534ed6d30f1e
explicit_override: true
---

# Pre-challenge: #1649 refresh the connections block at board start

**Override reason:** self-review, not a `/challenge-loop` run. Stated rather than relabelled.

## What I challenged in my own change

**1. Is the "it no-ops when unchanged" premise true?**
**Half true, and the card said to check rather than assume.** The unchanged path writes nothing and
does plenty: a file read, `findBlock`, a full `spliceBlock` and a string compare, per agent.
**Measured before wiring it: 3.3 ms for 18 agents** with realistic 13.6 KB files, stable across
repeats, against 29.7 ms for the writing pass and 0.0 ms for an empty roster. Cheap enough.

**2. Does this actually deliver what the card's title implies?**
**No, and I changed the acceptance rather than the claim.** An instruction file is read once at
session start, so no live agent learns anything from this. What it buys is that the **file** is right
at the agent's next start instead of waiting for an unrelated form save. The test asserts the file and
says why.

**3. Can it break a board start?**
That is the failure that would matter most, since a board that will not start is worse than one with
stale text. It is inside `require.main === module`, wrapped in try/catch, writes to stderr and never
throws. **Asserted:** a board with an untellable agent still prints `Kosmos on http` and still tells
the agents it can.

**4. Can the test tell the two worlds apart?**
Removing the boot call reds 2 of 3 with the right message; restored is 3 of 3. The first arm also
asserts the **precondition** that the agent starts WITHOUT the block, so a pass cannot come from a
fixture that already had it.

## The near-miss worth recording

My first spawned-server run reported **18 of 18 agents** could not be refreshed. That was the **real
fleet**: `AGENT_WORKFORCE_FAKE_PANES` is read by the fake tmux, not by `engine/status.js`, so
without `AGENT_WORKFORCE_TMUX_BIN` the roster resolves real tmux. **Nothing was written** only
because `AGENT_WORKFORCE_WORKERS` pointed at the sandbox, so every agent came back `COULD_NOT`.
Verified afterwards rather than assumed: **zero real `CLAUDE.md` files modified**, control 17 exist,
my own brief untouched since 08-26.

⇒ **A boot-time WRITE path plus a half-sandboxed roster is how a test edits real agents' files.** It
is now documented in the test's own env block.

## Weakest premise, named

**I have not run this on a board with a real, large fleet.** The measurement is a sandbox with 18
synthetic agents and uniform 13.6 KB files; a real fleet has uneven files and a cold page cache at
boot. **What would change my mind:** a startup that measurably slows on a real machine. The mitigation
is already in the shape - it is not fatal, and the cost scales with agent count, which is 18 here.

📌 I also could not verify the read-count metric at all: `fs.readFileSync` counted 0 on every pass
including the writing one, because `engine/instructions.js` never calls it. **Dropped rather than
reported.** The empty-roster control reading 0 would have looked like corroboration.

## Verified before opening this PR

- node suite **3239/3239, fail 0, rc=0**, my 3 tests confirmed present **by name** (3 lines naming
  #1649; positive controls #1618 -> 17 and #1645 -> 11; negative control -> 0)
- 0 em dashes added (97 before, 97 after in `server.js`)

## Known imprecision

`diff_hash` is against local `main`, which trails `origin/main`, so it binds more files than this
branch changes (kosmos#1472). I did not fast-forward shared `main`.
