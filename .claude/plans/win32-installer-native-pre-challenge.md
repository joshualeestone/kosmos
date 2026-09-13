---
pre_challenge: true
method: challenge-loop
branch: win32-installer-native
diff_hash: DIFF_HASH_PENDING
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T17:17:48Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 review rounds (the coordinator's rounds 1-8), converged; round 9 is the wrap-up
(one CI-flake fix, two documented limits, the rebase, this proof).
**Converged:** Yes. The round 8 review found no SAFETY and no BUG; its round-7 SAFETY fix was reproduced
by reverting the guard, and the only round-8 item was a CI-flake fix plus two notes.
**Base:** origin/main `b31b7610` (#2997 winmac-strings-2984). Rebased onto it in round 9; the only overlap
was `web/index.html`, which merged cleanly with this branch's `machineRows` sign-in switch intact.

The branch makes a Windows zip behave like a per-user install with no admin prompt: a Start-menu shortcut
(IShellLinkW), an HKCU Apps-and-features Uninstall entry (Publisher omitted), `Kosmos.exe --uninstall`
(confirmed, node helper gated by `--yes`), a move out of Downloads/Desktop/OneDrive/Temp into
`%LOCALAPPDATA%\Programs\Kosmos`, and a Settings "Start Kosmos when I sign in to Windows" switch. The bulk
of the review effort went into the destructive paths (uninstall, move) never running under a live board.

Full design, decisions, per-round fixes, the live-check runbook (NOT run), and the accepted limits are in
`.claude/plans/win32-installer-native-20260913T052847Z.md`.

## diff_hash recipe

```
git -C <worktree> diff origin/main HEAD -- . ':(exclude).claude/plans/win32-installer-native-pre-challenge.md' | sha256sum
```

`origin/main` is `b31b7610`. The proof file itself is excluded, so the hash is stable across the commit that
writes it into this frontmatter. Verified equal to the `diff_hash` above after that commit.

## Round history (each fixed in the next round, then re-reviewed)

- **Round 0/1** — the slice built: engine helpers (`win32uninstall.js`, `win32relocate.js`), the launcher
  duties (`KosmosLauncher.cs`), the sign-in switch (engine + route + page + browser check). Round 1 review:
  12 findings (keep every Kosmos's projects/workers, re-anchor at boot, hand off from a stale copy, sweep
  interrupted moves, and more).
- **Round 2** — 8 findings: `anchorBundle` guards; a board its task did not start; one build verdict shared
  by compare and relocate; a stale copy outside a temporary place; a kept root equal to the data folder;
  stray `worlds` entries; hidden leftovers.
- **Round 3** — 1 SAFETY (a slow board read as gone), 2 BUG (an unreadable switch switched off silently; a
  board re-registering after removal), 1 TEST-GAP (a real `FileShare.None` locked file), 3 NIT (compare
  timeout; never downgrade the pointer; overclaiming comment).
- **Round 4** — 1 SAFETY (only 127.0.0.1 probed; `bindHost` moved to `engine/bindhost.js`, both loopbacks +
  the bind host probed), 2 BUG (switch left off on an unreadable second list; wrong advice when another
  program holds the port), 2 NIT.
- **Round 5** — 1 SAFETY (a real board reads as "not Kosmos" — deferred to round 8's shape), 4 NIT: resolve
  the bind host to this machine's own addresses only; a hand-started board outranks the task's board; drop
  the EADDRNOTAVAIL/ENETUNREACH "refused" mapping (fail closed on any non-ECONNREFUSED); "another program"
  only for a task known-not-registered.
- **Round 6** — 1 BUG: this PC's own non-loopback address refuses a closed port only after ~2 s (Windows
  retries the SYN), so one 2 s connect+answer limit read every such refusal as a timeout and the default
  `#1112` config always looked open. Split the probe into a 5 s connect limit and the 2 s answer limit
  (`CONNECT_TIMEOUT_MS`), new outcome `connect-timed-out`, hand-off path unchanged.
- **Round 7** — 1 SAFETY (present since round 5): a real board on a bind-host address answers a look before
  routing (400/403) with no identity header, read as "not Kosmos"; the uninstall deleted the runtime and
  chats under a live board. Fixed in the engine: any HTTP answer without a Kosmos identity from a bind-host
  address is a new `unidentified` outcome (may-be-open, ranked with a timeout); loopback keeps the
  identity-required rule. Plus 4 NIT (wait length; enforced look deadline; port-16180 test guards; link-local
  edges).
- **Round 8** — CONVERGED. No SAFETY/BUG. 1 CI-flake fix (two timing ceilings widened to hang-guards), 1
  plan note (case-C degradation under a remote bind), 1 follow-up (the no-connect-limit hang on the untouched
  hand-off path, left for #2983).

Every round: a revert control per fix (each edits ONE working file, runs the guarding test, restores by
hash; C# controls edit the `.cs`; the shipped-exe control builds a scratch exe from an edited copy), the
targeted suites, and a by-name/first-error-line comparison against a `git archive` of the base, all in the
full sandbox (APPDATA/LOCALAPPDATA/USERPROFILE in scratch, the schtasks preload on). No push, no PR, no proof
until now, at the coordinator's instruction.

## Control tally (round 9, the full set on the rebased base)

**123 of 123 red**, none invalid, every baseline green, the worktree clean afterwards (restores verified by
hash), no schtasks call blocked. Each control ran as its own step inside the shared heavy-run lock
(`heavy-run-mutex.ps1`: it waits for free commit memory above 1.2 GB and for the other builder's step), so
two heavy steps on this shared box can never grow into each other for memory.

## Comparison (round 9, vs a `git archive` of `b31b7610`)

101 selected suites plus this branch's new real-board suite, one test file per locked step, each in its own
full sandbox:

| | Tests | Pass | Fail |
|---|---|---|---|
| Base `b31b7610` | 1782 | 1627 | 154 |
| Branch | 1918 | 1764 | 153 |

- 0 new failures.
- The one base-only failure is `git ls-files` in an extracted archive (no `.git`), not a real regression.
- 2 tests differ only by an ephemeral port in the message (`absolute-form naming this server is routed`, and
  `tools.win-open-board-2007`'s end-to-end, which fails `spawn EFTYPE` identically on both sides).
- 151 shared failures (identical name and first error line on both sides).
- `web.win32-board-copy.test.js` passes on both sides (base fixed by #2997).
- No schtasks call was blocked on either side.

## Accepted limits (recorded, fail-closed)

- **Case-C under a `#1112` remote bind.** A hand-started board reachable ONLY through the bind-host address
  answers a look there with a pre-routing 400 → `unidentified` (rank 2), which the task's own loopback board
  (rank 0/1) outranks. So the first look sees the task's board and the uninstall switches it off, ends it and
  waits (case-B behaviour) before stopping, rather than stopping with no schtasks call at all (case-C). It
  stays fail-closed: the bind-host board keeps answering, the wait times out, the switch is restored, nothing
  is deleted.
- **A bind-host address running a non-Kosmos web service on the board's port** stops the removal and the move
  (`unidentified` → could-not-tell). Fail-closed.
- **A board bound only to an address set in another process's environment** cannot be seen from the
  uninstall's process; the board task's state is the backstop, and the removal still switches the task off,
  ends it and reads the list back.
- **This PC's Tailscale adapter does not answer its own link-local address**, so a board there reads
  `timed-out`; a bind host of that address stops the removal ("Kosmos is still open"). Fail-closed.
- **The uninstall and the move have no progress window** for the few seconds they run (follow-up).

## Real system

Untouched after every run: no real `Kosmos.lnk`, no real `HKCU\...\Uninstall\Kosmos` key, no `KosmosTest`
key, no `%LOCALAPPDATA%\Programs\Kosmos`, and `Kosmos\board` still running. Nothing ever reached the live
board on port 16180.

## Outstanding questions (ASKED)

None.
