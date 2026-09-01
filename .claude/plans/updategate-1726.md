# kosmos#1726: engine/update.js pipes a remote script to sh with no live-execution gate

**Branch:** `updategate-1726` · **Card:** kosmos#1726, Ice Cream Kitty found it, unclaimed when I took it.

## The gap, verified against the subject rather than the report

```
engine/create.js   live-execution gate references   5
engine/update.js   live-execution gate references   0
engine/update.js:375 (pre-change)
  spawn('/bin/sh', ['-c', 'curl -fsSL "$1" | sh; ...'], { detached: true, stdio: 'ignore' })
  child.unref()
```

The file's own comment calls it *"the one command in this product that ends in `| sh`"*.

## Why this call site needed the gate more than the ones that already had it

`create.js` (#1598), `remove.js` and `delete-leftover.js` all gate an exec whose child the
process still holds. **This one is `detached` + `unref()` + `stdio: 'ignore'`, so the moment it
spawns it has LEFT.** A killed board, an aborted suite or a Ctrl-C stops none of it, and no stream
records what it did.

⇒ **Every other gate prevents an action that is merely wrong. This one prevents an action that
cannot be recalled**, which is why it is fail-closed BEFORE the spawn.

📌 **Recall is a separate design problem and this PR does not attempt it.** Closing the reachable
path makes the product strictly safer tonight; the unrecallability finding is the reason the gate
sits where it does, not a reason to hold the gate.

## Placement, which is load-bearing

```
361  if (installRunner) { ... }     the test seam, returns before the real path
390  if (!liveExec.liveExecutionAllowed()) { refuseOrWarn; return; }    THE GATE
399  const child = spawn('/bin/sh', ...)
```

**Gating in front of the seam would break every existing test that injects a runner**, which is a
worse product than the gap. One of my three tests exists solely to hold that ordering.

## Weakest premise, tested BEFORE writing any code

*Adding the gate breaks the legitimate production update path.*

```
server.js:7452  require('./engine/live-execution').allowLiveExecution()   real-start DOES opt in
live-execution.js require() count: 0                                     no cycle risk
CONTROL, safeRoster in server.js: 51                                     the grep works
```

⇒ Ruled out rather than assumed.

## 🛑 Perturbation, both arms, WITHOUT EVER SPAWNING THE INSTALLER

The only direct way to observe the spawn is to let it happen, and that is the hazard. So the spawn
was neutered to `/bin/true` plus a marker file for the duration:

```
ARM A  gate PRESENT  ->  marker NO    the gate blocked the path
ARM B  gate REMOVED  ->  marker YES   the path IS reachable, so ARM A proved the gate
RESTORED             ->  3 pass, 0 fail
```

## Three of my own checks failed first, and each caught something real

1. **A control failed and my main assertion was passing for the wrong reason.** `beginInstall`
   opens with `if (installStarted) return` and my first test had consumed it, so the injected
   runner was never called. **Only the control said so.**
2. **Reordering did not fix it** - the flag is one-shot with no reset, so the seam test lives in
   its own FILE, since `node --test` isolates per file.
3. **The perturbation read 0 on BOTH arms**, because my glob searched `/tmp` while `os.tmpdir()`
   on macOS is `/var/folders/...`. A control failing identically to its subject, with a zsh
   no-matches abort on top.

## Verification

    runner  tools/run-tests.sh
    rc      0
    tally   3351 tests, 3351 pass, 0 fail, 0 not-ok lines

Read from `RUNTESTS_EXIT` in the log, not the harness completion line.
