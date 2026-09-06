# perm-prompts-2189 — fire the real macOS permission prompts on demand (#1 / #2189)

## The problem (Josh, 0.6.39 fresh-account test, 2026-09-06)

The install-flow permission screens' grant buttons never fired the REAL macOS TCC
prompts — they only opened System Settings, and the prompts appeared much later at
Create-New-Agent → Import. And tmux is not even in the Accessibility list, so the
"Open Accessibility Settings" button shows a list with nothing to enable (#2189).

Expected: on the permission screen, clicking a grant button fires the real prompt
(files/folders; tmux/Accessibility) so the user hits Allow directly; we recheck and
show the pill green; Next gates on the real grant (#2, Renet).

Ownership seam (feedback doc): **Kitty = the native permission-trigger mechanism +
tmux injection**; **Renet = install-flow UI + click wiring** (her #2342, merged, calls
`/api/file-access-prompt` and `/api/a11y-prompt` and falls back to Settings on
`{ok:false}`/error).

This supersedes the 2026-09-05 needs-operator park on #2189/#2125: that park waited on
"the fresh-install verify measures whether the launch-time axprompt is sufficient." The
0.6.39 fresh-account test IS that verify and it returned insufficient, directing the
build.

## Why the engine cannot just fire the prompts

A TCC prompt must be attributed to **tmux** — the responsible process that owns the
folder grant and that the running agents use. Only the native app can run a trigger
under the bundled tmux (it already does at launch, via `spawnAxHatchUnderTmux`). So the
engine signals; the native app fires.

## The design

1. **engine/promptrequest.js** (new): `request(kind)` records a request file
   (`a11y-prompt-request` / `file-access-prompt-request`) in the shared store dir —
   but ONLY when a native app is present (a fresh a11y reading proves it). No native
   app → `{ok:false}` so the UI falls back to opening Settings and a button is never
   dead.
2. **server.js**: `POST /api/a11y-prompt` and `POST /api/file-access-prompt` (inherit
   the cross-site POST guard) delegate to `promptrequest.request` and return
   `200 {ok:true|false}` — matching Renet's `frFirePermission` contract (fires only on
   `res.ok && body.ok === true`, else falls back).
3. **native-app/main.swift**:
   - `startPromptRequestWatcher` (a 1.5s timer, started from `applicationDidFinishLaunching`)
     consumes each request file (deleting it first, so a slow hatch cannot re-fire) and
     spawns the matching hatch under tmux.
   - `a11y-prompt-request` → `--kosmos-app-axprompt` (fires the Accessibility prompt +
     adds tmux to the list) then a refresh `--kosmos-app-axcheck`.
   - `file-access-prompt-request` → a NEW `--kosmos-app-fileaccessprompt` hatch:
     `fileAccessReading()` enumerates Documents/Downloads/Desktop under tmux (which
     fires the Files-and-Folders prompt on first undecided access) and
     `writeFileAccessStatus` writes the verdict — the first writer for the file-access
     seam, so S2's poll/detection works.
   - `storeFileURL(name)` — one resolution of the shared store dir for the new
     file-access-status + request files. `a11yStatusURL()` left inline (proven path,
     its existing test pins its body).

## Weakest premise / what needs a fresh-Mac verify

Two unknowns, both for the fresh-Mac verify, both unobservable on a dev box (terminal
already holds Full Disk Access):

1. **Attribution** — whether the under-tmux read/prompt is attributed to tmux vs the
   app. Same load-bearing unknown as #2125's a11y writer. Routing through the app keeps
   the spawn tree identical to the proven launch path. Rejected: letting the engine
   spawn tmux (option b) — fewer native changes but a second unverified attribution
   variable.

2. **Timing / refresh (file-access only)** — the single-click "pill flips green" assumes
   `contentsOfDirectory` BLOCKS until the user answers the prompt (usual for file-APIs;
   unlike the async `AXIsProcessTrustedWithOptions`). If it is async instead, the probe
   writes `granted:false` and there is no periodic file-access refresh to correct it (a
   re-click recovers). The refresh is deliberately absent because the probe IS the
   prompt, so a periodic/launch-time probe would reintroduce permflood-2125's
   fresh-install prompt burst. If the verify shows the call is async, the fix is a
   bounded POST-CLICK re-probe with the measured timing — deferred until then.

The honest reading is emitted with no bias default precisely so Josh's fresh-account
test verifies both. **Prod-promote stays HELD** (feedback doc); this reaches Josh on
staging, which is the verify.

## Tests

- `engine/promptrequest.test.js`: records only when native present; fallback leaves no
  stray request; stale reading counts as absent; unknown kind refused; **cross-language
  contract** (the request-file names match the Swift `consumeRequest` calls).
- `native-app.perm-prompts-2189.test.js`: source-wiring (the AppKit binary can't boot in
  a unit test), sibling of the a11y-writer test — the writer path matches the engine
  reader, the mock seam both arms + real probe, the exact JSON shape, the hatch, the
  watcher started at launch + consuming both requests, delete-before-fire.
- Verified on the compiled binary (macos-floor target): the fileaccessprompt hatch
  writes `{granted:true}` / `{granted:false}` under the `KOSMOS_FILEACCESS_FORCE_GRANTED`
  mock.

## Not in scope

- The `web/index.html` caller is Renet's #2342 (merged). No `web/` change here.
- Load-found-agents-onto-screen-9 (rides the file-access grant) — Renet, after these
  endpoints land.
