# a11y-pill-honest-2085 - honest tmux Accessibility pill (#2085)

Owner: Ice Cream Kitty (native/coordinator). Splinter bumped to PRIORITY 2026-09-07 (Josh's #1
keystone: a lying "TMUX ACTIVATED" badge). Must ride the 0.6.47 cut.

## The bug (measured)

The S3 first-run "tmux" gate pill showed "Activated" based on the NATIVE APP's `AXIsProcessTrusted`
(the calling binary), NOT tmux's grant. On a fresh account the pill read ACTIVATED while tmux was
ungranted and absent from the Accessibility list (Josh, 0.6.42). `engine/a11ystatus.js` read() surfaces
that app-trust file; its own header documents the wrong-subject problem.

## Ground truth (measured 2026-09-07, #2085 comments)

- tmux DOES hold a real path-keyed Accessibility grant: `/Library/Application Support/com.apple.TCC/
  TCC.db` -> `kTCCServiceAccessibility  <tmux path>  auth_value 2 (ALLOWED)`. (Orthogonal to tmux
  disclaiming responsibility for its CHILDREN, which is why the under-tmux re-exec in #2125 still
  returned the app's state.)
- Accessibility is keyed on the calling binary; there is no clean API to ask "is tmux trusted" from
  another process. So the honest read is tmux's OWN path-keyed row in the system TCC db.
- Nothing provably needs tmux's grant at runtime (agents use tmux send-keys IPC, not the synthetic-
  input AX API); its load-bearingness is a separate, deferred question. This card only makes the
  status HONEST, it does not change whether tmux gates.

## The change (Option B: engine reads tmux's real grant)

- `engine/a11ystatus.js`: new `tmuxGrant(opts)` reads tmux's path-keyed `auth_value` from the system
  TCC db via `/usr/bin/sqlite3 -readonly` (never mutates), matched to the realpath of the resolved
  tmux binary (`create.binPaths().tmuxBin`, realpath'd - TCC keys on the real path, and the bin is
  often a symlink). Same `{checkable, trusted, at}` shape as read().
  - **Load-bearing invariant: NEVER a false green.** auth_value>=2 for THIS tmux path -> trusted:true;
    no row / auth<2 -> trusted:false (safe, actionable "Not activated"); ANY read failure (no FDA,
    missing/locked db, schema drift, no sqlite3, unresolvable path) -> checkable:false -> neutral
    "Checking...". A `try/catch` + a `{ok:false}` runner result both land in checkable:false.
  - Test seams: `opts.sqliteRunner`, `opts.tmuxBin`, `opts.tccDb`.
- `server.js`: `/api/a11y-status` returns `tmuxGrant()` instead of `read()`. Same shape, so the S3
  tmux gate poll consumes it UNCHANGED. read() is left intact for its other consumers.
- `web/index.html` (Mona's locked 3-state contract, delegated to me):
  - GRANTED (checkable+trusted) -> "✓ Activated" (green, s3-pill-ok) [unchanged]
  - NOT-GRANTED (checkable + !trusted) -> "Not activated" + Turn On (red, s3-pill-req) [folded from
    "Needs Activated"]
  - CANNOT-CHECK (checkable:false) -> "Checking..." (NEUTRAL, no button, NEW `.s3-pill-wait`)
  - `[data-checking]` show/hide rules; folded copy on BOTH rows; stale S3 comments updated.
  - Renet's `frPollGates` (his OK in-thread; his PR #2430 touches only discover.js tests, no conflict):
    ONE additive line - set `data-checking` on the 'uncheckable' state it already computes.
    granted/blocked/Next-gating UNCHANGED; fail-safe invariant preserved (uncheckable never blocks Next).

## Tests

- `engine/a11ystatus.test.js`: 9 new tmuxGrant cases (granted 2/3, denied 0, no-row, read-failure,
  throw, empty-tmuxBin fallback, + a REAL sqlite3 end-to-end against a TCC-shaped temp db and a
  schema-drift guard).
- `web.firstrun-a11y-1214.test.js`: updated to assert the 3-state copy ("Not activated", neutral
  "Checking...", "Needs Activated" is gone).
- `docs/browser-checks/render-gated-next.js`: new cannot-check assertion (data-checking, neutral pill
  only, never false green, never blocks Next). Not executed this session (Playwright not installed
  here); logic verified by reading + the unit tests cover markup and engine.

## Rejected / deferred (with reasons)

- **Option A (native app checks tmux):** AXIsProcessTrusted answers about the caller, so no clean
  native API to read tmux's grant; heavier (native-app/main.swift + rebuild). Option B is in-reach
  and needs no native change.
- **Prompt-only (never assert Activated):** honest but never shows green even when tmux is really
  granted, and Mona's contract has a real GRANTED state. Option B honors the full 3-state contract.
- **Un-gating tmux from Next entirely** (since nothing provably needs the grant): a separate product
  decision beyond "kill the false badge"; kept the existing gate semantics, now honest. Follow-up.

## Weakest premise

That the board process can read the system TCC db (needs Full Disk Access). If it cannot in a real
install, the pill shows "Checking..." (honest, never false, never blocks) rather than green even when
tmux is granted. Mitigated by the schema-guard (safe) and by the read working on the fleet box. A
follow-up could add Option A if the board lacks FDA in real installs.

## Delivery

agent-workforce PR for the Kosmos team; repo squash-merges. Rides the 0.6.47 cut.
