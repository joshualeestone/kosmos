# Plan: determinate installer download bar (kosmos#3233)

Retrospective plan, recorded to satisfy the pre-PR plan-file gate. The code was
authored and committed before this challenge-loop gate run (a handoff); this file
captures the design so a reader does not have to reconstruct it from the diff.

## Problem

The installer "Setting up" page (`install/pkg-scripts/installing.html`) showed an
indeterminate swoosh for the whole ~50MB Kosmos bundle download, so a slow download
looked identical to a stalled one (Josh: the bar is a swoosh, not a %). This is the
open half of #920 (wire setup.sh's download phase to the page).

## What finished looks like

The bar fills determinately from the live download bytes/total during the bundle
download, and falls back to the existing swoosh when no total is known. No megabytes
number is ever shown (#920: a baked number rots). No new runtime dependency, no local
server.

## Design decisions (deliberate, do not reverse)

1. **No megabytes text.** Only the bar's fill (the SHAPE of the wait) is driven from
   live bytes/total. A number baked into an install page reads as a promise and is
   wrong within weeks as the bundle grows.
2. **No server / no new runtime.** A helper would need node (arrives WITH the bundle)
   or `/usr/bin/python3` (only the CLT stub on a fresh box). Instead: `setup.sh`
   (`/bin/sh`) writes a tiny JS file (`window.__kosmosInstallProgress`) into
   `~/Library/Caches/Kosmos/install-progress.js`; the page (co-located there by
   postinstall) RE-INCLUDES that script cache-busted, because a `file://` page cannot
   `fetch()`. This is strictly less invasive than a server and leaves the delicate
   page-open flow (#662/#663/#2073) untouched.
3. **The emit is best-effort and fully isolated from the download.** It can never
   abort or alter the `curl`, its `verify_download` checksum gate, or its error path.

## Pieces

- `install/setup.sh`: derive the total (a bounded content-length HEAD), run a
  best-effort background byte-watcher that writes `install-progress.js` once a second
  during the download, tear it down on both the success and failure paths.
- `install/pkg-scripts/installing.html`: a `.bar.determinate` style; a poller that
  re-includes `install-progress.js` cache-busted and drives the bar when a total is
  known; `settle()`/`__kpStop()` clears the inline width so the settled 100% wins.
- `install/pkg-scripts/postinstall`: clears any stale `install-progress.js` at page
  setup so a repeat install cannot show a leftover percentage.

## Isolation, made intrinsic (challenge-loop hardening)

Under `set -euo pipefail` (active again inside the background watcher subshell even
though the `install_kosmos ... || die` call site suspends it in the main body), every
added step is guarded so a failure cannot take the install down: the content-length
HEAD assignment (`|| _kp_total=""`), both watcher teardown paths (`kill/wait || true`),
`_kp_emit` itself (`case` not `[ -n ] &&`, `|| true` on the write, always returns 0),
and the watcher is bounded by parent liveness (`kill -0`) so a hard kill cannot orphan
it. Download/checksum/error semantics are byte-for-byte unchanged.

## Tests

- `install.installing-page.test.js`: mechanism assertions against comment-stripped
  code (determinate style, cache-busted re-include, clamp/positive-total guard,
  settle→__kpStop width-clear, per-poll script-node cleanup).
- `tools/test-install-progress-emit-3233.sh`: extracts and drives the REAL `_kp_emit`
  under `set -euo pipefail`, eval-validates the emitted JS (valid + injection-safe),
  and pins the isolation guards; wired into `test:shell`.

## Not in scope (Mona's design half / deferred)

- The bar's visual + copy refinement, and the cross-browser (`Safari` + `Chrome`)
  confirmation of the `file://` cache-busted re-include.
- A fully-async total fetch (perf, ~0 practical impact since reachable() just
  succeeded), and the bar's reduced-motion / `aria-valuenow` a11y polish.

## Owner's decisions (not assumed here)

None block this change. The in-app 214MB Claude Code download bar (a separate wire of
the existing `engine/connect.js` `onProgress`) is a separate card if wanted.
