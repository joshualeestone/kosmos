# reaper-1793: reap orphan temps left by a death in the write window

## The defect (kosmos#1793)

`engine/securewrite.js` writes a credential atomically: `openSync(tmp,'wx',mode)` -> write ->
`renameSync(tmp, file)`. A process that dies **between** the create and the rename leaves
`<file>.kosmos-<pid>-<started>-<seq>.tmp` behind, at 0600, holding the secret. `forget()` unlinks
only `FILE`, so that stale temp holds the OLD token past a revoke, a re-connect and an uninstall
(`install.uninstall-litter-1547.test.js` preserves `secrets/` on purpose), and no code path ever
removes it. New exposure for `cloudflare`/`tokendoor`/`githubdevice` (their old write-in-place
made no second copy); `sendertoken` has carried it since #1776. Filed separately from #1787 so a
delete path did not ride into a security fix unreviewed.

## Why not a glob sweep (the module's own warning)

`secureDir` acts on the directory; a glob throws away the pid/started the temp name carries. Two
concurrent writers then race -- A's sweep unlinks B's in-flight temp between B's `wx` create and
B's rename, B's rename fails ENOENT, B burns its three attempts and lands in the destructive
in-place fallback. That trades inert litter for a live path into the exact write #1787 closed.

## The fix

`reapOrphanTemps(dir)`, called from `writeSecret` once per target directory per process
(`reapedDirs` Set), before this call adds its own temp. It matches the anchored
`.kosmos-<pid>-<started>-<seq>.tmp` suffix (unique to this module; a credential file cannot carry
it) and deletes a temp ONLY when it can prove it is dead:

- **our pid, a different `started`** -> a prior run of us (we are the only "us"): stale.
- **a foreign pid that is provably gone** (`process.kill(pid,0)` throws ESRCH): stale.
- **our pid + our STARTED** (an in-flight temp of this run): LEFT.
- **a foreign LIVE pid** (kill succeeds, or throws EPERM = alive but not ours): LEFT.

So it can never take a concurrent writer's in-flight temp -- the race the glob would have created.
A reused-pid orphan (dead writer, its pid now a live stranger) reads alive and is LEFT, erring
toward inert litter over a wrong delete. Best-effort and never fatal: every fs call is caught, and
the write runs whether or not anything was reaped.

## Tests

Each arm uses its OWN fresh directory (the reap is once-per-dir-per-process, so a shared dir would
let the first arm's sweep suppress the rest). Coverage:

- prior-run temp (our pid, `started` 1) reaped -- deterministic.
- dead-foreign temp reaped (a short-lived child's now-dead pid; the arm asserts ESRCH as a
  precondition so a reused pid re-runs rather than silently passing).
- **SAFETY** a LIVE foreign pid (pid 1, launchd) is LEFT -- the concurrency guarantee.
- **SAFETY** a real credential file with no temp suffix is never touched -- the regex anchor.
- the reaper does not break the write it runs before.

Mutation-verified: removing the `reapOrphanTemps` call reddens the three presence arms; widening
the predicate to reap a live pid reddens the live-foreign arm; widening the regex to a bare name
reddens the credential arm. Full `securewrite.test.js`: 26 pass, 0 fail.
