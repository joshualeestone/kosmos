# fileaccess-drop-diag-3188 -- scoped board diagnostic for #3188 (tmux folder access)

## Problem
Josh 6.70: "We are still not asking for tmux folder access -- big issue" (#3188). The
first-run flow does not fire the macOS FOLDER/file-access TCC prompt attributed to tmux.

## What I measured on origin/main (this is a diagnosis card, not a build-the-feature card)
The full folder-access-under-tmux chain ALREADY EXISTS end-to-end:
- UI "Allow Access" (web/index.html) -> `/api/file-access-prompt` (server.js) ->
  `promptrequest.request('file-access')` -> drops `file-access-prompt-request` in
  `store.ROOT` -> native watcher `consumeRequest("file-access-prompt-request")`
  (native-app/main.swift:1225) -> `spawnAxHatchUnderTmux(..., "--kosmos-app-fileaccessprompt")`
  -> `fileAccessReading()` enumerates Documents/Downloads/Desktop UNDER tmux, attributed to tmux.

My earlier card note (needs a NEW native Swift hatch + a new `tmux-file-access` kind) was
WRONG and is retracted on the card. #3188 is a confirmed instance of the launchd-ambient-env
meta-sweep #3189 (with #3113 tmux binPaths, #3136 default-account probe).

The defect is NOT localizable from source: `resolveBundledTmux` has the correct
`tmux/bin/tmux` fallback (old #2189 bug fixed), and `store.ROOT` (drop) vs the native
`storeFileURL` (watch) resolve identically and are pinned by a cross-language test -- and a
store.ROOT divergence would also break the a11y seam, which it does not. So, exactly like
#3136 (which ICK could only diagnose by instrumenting the running board), the localizing
step is a scoped, server-log-only diagnostic on the running 6.70/6.71 board. Confirmed with
Splinter: he has no file:line; #3189 was a class grouping, not a localization.

## What finished looks like
A scoped diagnostic ships that, on the running board, prints which engine-observable rung of
the file-access chain fails when the user clicks Allow Access, so the actual one-line fix is
targeted rather than guessed. No user surface, no token, no browser. Inert for every existing
caller. Then Splinter's fresh-board verify reads the log and the targeted fix + diag-strip
follow (the #3136 arc).

## Change
- `engine/promptrequest.js`:
  - `request(kind, opts)` gains an optional `opts.diag`. When set, the return also carries
    `diag: { name, root, file, nativePresent, wrote }` -- the drop rungs. With NO opts the
    return is byte-identical to before (`{ok:true}` / `{ok:false, because}`), pinned by the
    existing `assert.deepEqual` tests. Reads `store.ROOT` once so the drop and the diag agree.
  - new `wasConsumed(kind)` -> `{ name, present }`: whether the request file still sits in
    `store.ROOT` (the native watcher deletes on consume). Pure, never throws.
- `server.js` `/api/file-access-prompt`:
  - requests with `{ diag: true }`, logs a server-side-only line (root/nativePresent/wrote/
    ok/because), and schedules a bounded (5s, unref) post-drop check that logs whether the
    native watcher consumed the request (the store-dir-divergence / app-not-running rung).
  - STRIPS `diag` off the wire: sends the clean `{ok, because}` the caller already reads, so
    no store path reaches the browser. `FILE_ACCESS_CONSUME_PROBE_MS = 5000` (native poll 1.5s,
    stale-drop 30s, so 5s covers 3+ cycles and stays well under stale).
  - a11y / tmux-a11y routes are untouched (pass no opts).

## Scope (deliberate)
- Diagnostic only. It does NOT change behaviour of the prompt chain; it observes it. The
  targeted fix is a follow-up gated on reading the board log (same as #3136).
- Rung 5 (the native hatch actually raising the TCC prompt under tmux) is native/fresh-Mac
  and is Splinter's verify arm; this instrument covers the engine-observable rungs 1-4
  (drop path resolved, native presence, write success, native consume).
- Temporary: stripped in a #3188 follow-up once the board log localizes the rung, per #3136.

## Test plan
- `node --test engine/promptrequest.test.js` (12: 7 regression incl. the byte-identity
  deepEqual guard, + 5 new: diag drop rungs, native-absent, unknown kind, wasConsumed,
  route-strip). All green.
- Post-deploy (Splinter routes): read the board stdout for the `file-access-prompt #3188 diag:`
  lines when Allow Access is clicked on a fresh-Mac install; localize the failing rung.
