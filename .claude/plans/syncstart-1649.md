# #1649: refresh every agent's connections block when the board starts

**Branch:** `syncstart-1649` · **Card:** kosmos#1649

## What was wrong

`connections.syncEveryone` had exactly one caller, `POST /api/you`. So an edit to `blockBody()`
reached an agent that already existed only when somebody happened to save the About-you form.

**This is the same defect the supervisor refresh above it already fixed**, in a different file, and
that block says it best: *"true of the FILE and false of the MACHINE."* My change sits directly
beside it and follows its three rules: boot is the update, never fatal, never at import.

## The cost was measured BEFORE wiring it, because the card asked and the claim was not obvious

The appeal of this fix is *"`tellAgent` no-ops when unchanged"*. **That is a claim, not a fact.** The
unchanged path still reads each file, runs `findBlock`, builds the whole spliced text and compares it.
Measured in a sandbox, 18 agents, realistic 13.6 KB instruction files:

```
PASS 1  block ABSENT, writes       29.7 ms
PASS 2  UNCHANGED, no writes        3.3 ms   <- the startup case
PASS 3  UNCHANGED again             3.2 ms   stable
CONTROL empty roster                0.0 ms
```

⇒ **3.3 ms.** Cheap enough for every board start. The card was right to demand the number and right
that "no-op" means *writes nothing*, not *does nothing*.

⚠️ **One number I am not reporting:** I also patched `fs.readFileSync` to count disk reads and got
**0 on every pass, including the one that wrote 18 files.** `engine/instructions.js` contains no
`readFileSync`, so I was counting a call that does not exist. **The timings stand; the read count was
a false zero and is dropped rather than dressed up.**

## 🛑 It makes the FILE current, not the AGENT

`engine/instructions.js` says an instruction file is read **once, at session start**, and *"only a
restart re-reads it"*. So nothing here makes a live agent know anything new. **What it buys is that
the file is already right at the agent's next start**, instead of waiting for an unrelated form save.
The half that tells anybody a running agent is behind already exists separately, as the staleness
state derived from the file's mtime against the session's start time.

**The test asserts the file for that reason**, and says so, rather than claiming something the
mechanism cannot do.

## Verified, and two of the three failures were mine

**Three arms, all passing, and the negative arm proven:** removing the boot call reds 2 of 3 with the
right message; restored is 3 of 3.

- an agent that existed beforehand has the block after a plain board start, **with a precondition
  asserting it did NOT have it first**, or the test proves nothing
- the board must **not create** an instructions file for an agent that has none
- a board with an untellable agent **still starts**, and the agents it could tell are still told

⭐ **Two fixture traps, both worth keeping in the file, because both produced convincing fake
failures:**

**1. A half-sandboxed roster reaches the REAL fleet.** `AGENT_WORKFORCE_FAKE_PANES` is read by the
fake tmux, **not** by `engine/status.js`. Without `AGENT_WORKFORCE_TMUX_BIN` the spawned board
resolved the real tmux and reported **18 of 18 agents**. Nothing was written only because
`AGENT_WORKFORCE_WORKERS` pointed at the sandbox, so every one came back `COULD_NOT` (verified
afterwards: **zero real `CLAUDE.md` files modified**, control: 17 exist). **A boot-time write path
plus a half-sandboxed roster is how a test edits real agents' instructions.**

**2. The worker folder drops the `-discord` suffix.** A session `x-discord` is agent `x` in
`workers/x/`. Creating the folder under the session name gave *"it has no folder of its own on this
computer yet"* for every fixture agent: a real refusal from the product and an entirely fake test
failure.

📌 **What diagnosed trap 2 was a change I made to the product**, not to the test: the boot message now
names the first refusal's reason instead of only a count. *"Could not refresh 1 of 1"* at boot, with
nobody watching, says something is wrong and nothing about what. `tellAgent` already returns a
`because` written for a person; printing it turned a twenty-minute hunt into one line.
