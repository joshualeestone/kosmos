# #2511 part 2: drop the #2509 legacy-leaf board.token WRITE mirror

**Branch:** `drop-legacy-mirror-2511` · **Card:** kosmos#2511 (needs-release)

## Background

#2439 renamed the store leaf `AgentWorkforce` -> `Kosmos` and `fs.rename`d the whole
dir. A `kosmos` CLI whose bundle PRE-dated #2439 resolved the OLD leaf and read
`board.token` from a path the migration had emptied, presented no token, and #1976's
enforcing report route refused it. That self-report + liveness freeze was kosmos#2509.

The stopgap was `mirrorTokenToLegacy()`: a WRITE mirror that wrote the live board token
back into the pre-#2439 leaf so an old CLI bundle reading that leaf still authenticated.

#2511 has two parts:
- **Part 1 (durable fix): already shipped.** Installed bundles resolve the post-#2439
  store natively, so the compat shim is no longer the mechanism keeping old boxes alive.
- **Part 2 (this branch): remove the WRITE mirror.** It is a live credential being
  written into a deprecated leaf, and it is no longer needed.

## The change

In `engine/boardauth.js`:
- Removed `mirrorTokenToLegacy()` (the function and its shim docblock).
- Removed its call in `ensureToken()`, which now `return ensureTokenPrimary()`.
- **Kept** the READ-side fallback in `readToken()` (a token that lives only on the legacy
  leaf is still found), the legacy -> primary backfill, `legacyTokenPath()`, and
  `store.LEGACY_APP` / `store.dataRootFor`. Only the WRITE-back is gone.

## Why it is safe now

Renet enumerated the fleet: both currently-ONLINE macs are post-#2439, so removing the
mirror breaks no board running right now. The only residual is a long-dormant mac
returning later with a stale pre-#2439 bundle; a cut / auto-refresh updates it on
reconnect, and the retained READ fallback + backfill cover a token that only exists on
the old leaf once new code runs.

## Residual risk (deliberately accepted)

A box running OLD code that reads the legacy leaf directly, in the window before it
re-updates, would find nothing there and could freeze exactly as in #2509. This is NOT
fixable in the new bundle (old code does not run new code); it is bounded to long-dormant
offline boxes and is reversible in a commit. Documented in the code comment at the removal
site and in the PR body. Change is gated `needs-release` so it rides a cut where dormant
boxes auto-refresh.

## Tests

`engine.boardauth-leaf-2509.test.js` (repo root):
- Replaced the mirror-writes-both test with a no-write-mirror test (asserts
  `board.token` is NOT created on the legacy leaf).
- Made primary-wins assert the stale legacy copy is left UNTOUCHED.
- Both are RED-CAPABLE against a re-added mirror.
- Kept the read-fallback / backfill / no-resurrect arms.

Run the guard test explicitly by filename: `node --test engine.boardauth-leaf-2509.test.js`
(a `node --test engine/*.test.js` glob misses this repo-root test; a bare zsh glob matching
nothing also silently makes `node --test` run the whole suite).

## Weakest premise

The fleet enumeration was a snapshot from `tailscale status` + SSH reachability at one
instant; a box asleep at that moment could hold any bundle version. "All clear" covers
only what was online and answering, which is why the residual above is called out rather
than claimed impossible.
