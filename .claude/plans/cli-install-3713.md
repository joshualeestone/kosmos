# Connect installs the Gemini CLI and the Grok CLI (kosmos#3713)

Found by the #3708 review: Kosmos installed the terminal agent for Claude and OpenAI only, so on
a fresh computer Gemini's and Grok's Connect stopped at "not installed". Josh (09-24): connect
directly and make it work exactly like GPT does.

## Call
- **Engine (engine/runners.js).** Pinned manifest entries through the SAME install() as OpenAI's
  Codex: the npm registry tarball, checked against the registry's own sha512, no npm client.
  - Gemini CLI **0.61.0** (`@google/gemini-cli`): one tarball for every Mac, a self-contained
    `bundle/` (449 files, no node_modules, listed 2026-09-25). Its entry is `#!/usr/bin/env node`
    and a fresh Mac has no node on its PATH, so the stable path is a LAUNCHER (`launcher: 'node'`)
    that execs the bundle with the node the board runs on (its shipped runtime). Paths are
    single-quoted with embedded quotes escaped.
  - Grok CLI **1.0.41** (`@xai-official/grok-darwin-arm64`, and `-darwin-x64` for Intel Macs):
    the per-CPU package holds one brotli-compressed binary, `bin/grok.br`. Its vendor postinstall
    only decompresses it and sets the exec bit (read 2026-09-25); install() does that step
    (`brotliFrom`) after the checksum passes, then the usual --version prove.
  - Both versions are npm's latest and the ones this Mac ran #3296 and #3391 on. Each tarball was
    downloaded and matched its registry sha512 (sizes pinned as measured).
  - resolveBin: env override, then the managed copy, then the vendor's npm-global copy.
  - managedBin takes the provider (it hard-coded 'openai').
- **Screens.** First run and Settings: a missing tool opens a download box (the tool named, its
  size, and Download; first run also has Not now, while Settings' way out is its own provider
  picker, the same as for every other step there) instead of the dead-end sentence; progress comes from the engine's own
  job phase and byte counts; once installed, the key box (or Grok's sign-in-or-key choice) opens by
  itself. One driver, keyedRunnerInstall, for both screens. The "Kosmos cannot install it for you
  yet" sentences are gone.
- **The agents' own guide (engine/connections.js)** said Kosmos does not install Gemini's and
  Grok's terminal agents and that Grok takes a key only; both corrected.

## Rejected / not done
- **Windows.** No Gemini or Grok agent can launch on Windows yet (create.js refuses, win32launch has
  no substrate), so installing their tools there would lead to a Connect that works and an agent
  that cannot start. install() refuses win32 before a byte moves, as it does today. The Windows
  install follows the Windows launcher.
- A second installer path, or running npm: the manifest+install() path is the verified one.
- The subtitles from #3708 stay ("Google · API key today", "xAI · subscription or API key
  today"): still true, and the card says change them only if they become more true.

## Weakest premises
- **The live proof.** The permission layer denies me running freshly downloaded vendor binaries,
  so I could not watch the real Gemini bundle or Grok binary answer --version. The install's own
  prove step does that on the person's machine and refuses a build that does not run, so a bad
  build fails safe; someone else must see one real Connect succeed.
- **Grok 1.0.41 and the subscription sign-in.** #3661 runs `grok login --device-auth
  --leader-socket`. The 1.0.41 binary contains both flag strings (5 and 1 hits, control 0), and it
  is the only grok this Mac has had, but Renet's 09-23 note called 1.0.41 API-key-only. Asked her
  at 05:30. Later evidence in her own #3661 code: engine/grokaccounts.js records "What `grok login`
  writes into GROK_HOME (measured, grok 1.0.41)", so the sign-in was run on 1.0.41 when #3661 was
  built. **Renet's answer (06:23):** MEASURED on 1.0.41 (her #3391 plan, 09-24): `grok login
  --device-auth --leader-socket` starts, prints the device URL and code, honours GROK_HOME and leaves
  the live ~/.grok alone; her 09-23 "API-key only" is superseded. NOT RUN on any version: a person
  confirming the code through Kosmos so that auth.json lands and an agent runs on it (needs-operator
  on #3391). So 1.0.41 is the right pin, and the subscription half on a fresh install is started but
  unconfirmed to completion. `--leader-socket` is for the login only.
- The Gemini launcher prefers Kosmos's runtime beside the runners folder, then the node recorded at
  install; if neither is there it reads missing and Connect reinstalls it (review pass 1).

## Tests
- engine/runners.gemini-grok-3713.test.js (6): Grok expanded from .br byte for byte and run from
  the managed path; a .br that will not expand is refused with nothing installed; Gemini's launcher
  runs the bundle with NO node on PATH; a node path with a space and a quote; a launcher whose node
  cannot start is failed at prove; the pins and the Windows refusal. Perturbed: no expand step,
  symlink instead of launcher, no managed rung, no Intel build: each reds.
- engine/runners.test.js: the #3296/#3391 "no managed rung" tests replaced by the #3713 ladder.
- docs/browser-checks/render-keyed-install-3713.js (11, new) and render-firstrun-keyed-connect-3658.js
  (download arms); render-grok-subscription-3391.js (the missing-grok wording).
- engine/connections.test.js: the guide says both connect ways and no "does not install".

## Review pass 1 (opus): 0 blockers, 5 warnings, 5 nits. All fixed except NIT 1 (answered above).
- W1 the launcher baked absolute paths: a moved Homebrew node left it present and unrunnable with no
  way back. Now the bundle is found relative to the launcher, Kosmos's runtime node beside the runners
  folder comes first, and resolveBin reads a launcher that cannot find a node as missing
  (launcherHasNode), so Connect reinstalls it. Tested with a deleted "Cellar" node; perturbed red.
- W2 the key and Grok sign-in routes took a tool mid-install. They now also ask runners.installing()
  (a live job). A first version, runners.ready(), called resolveBin inside the module and so walked
  past the stub the server tests put on runners.resolveBin (two tests went red); job state is kept
  separate so presence still comes through that seam.
- W3 Windows was offered a download the engine always refuses. Now it says plainly that Kosmos cannot
  install it on Windows yet, on first run and in Settings. Tested with the win32 meta; perturbed red.
- W4 leaving first run left the download box "open", its watcher polling on, and (found by the new
  arm, not the reviewer) made the next Connect a "second press" that closed it. frClose and frGo
  now close the box; the watcher also checks first run is showing. Perturbed red.
- W5 focus fell to the body after Not now, after Add found the tool missing, and after a finished
  Settings download. Not now returns to Connect; the download step takes focus; a finished download
  focuses the next step.
- NIT 2 a return during a running download now joins it without another click (tested).
- NIT 3 a bad Grok archive says "could not be unpacked", not "check disk space" (tested).
- NIT 4 the expand uses stream pipeline, which closes both ends on error.
- NIT 5 the helper moved out of the slice web.runner-install-refusal.test.js lifts.

## Review pass 2 (sonnet): 0 blockers, 2 warnings, both fixed
- W the Grok sign-in's missing-tool sentence (shared by first run and Settings) still promised a
  download on Windows: the one missing-tool path pass 1's Windows fix did not reach. It is now
  grokMissingTool(), which says it plainly on Windows. Arm in render-grok-subscription-3391.js;
  perturbed red.
- W Settings' download box could start twice: the background presence probe landing after Add had
  opened the box and Download was pressed re-armed Download and clicked it. The engine joins the
  running job, so no second download, but a second request and watcher. The box now remembers
  which provider it shows, and a repeat for the same one only refreshes the words. Arm with a
  slowed /api/runners in render-keyed-install-3713.js; perturbed red.
- Measured clean: the launcher script against managedRoot for an installed and a from-source board,
  launcherHasNode, installing() in both routes, the API-key-path Windows coverage, frGo/frClose.

## Review pass 3 (opus): 0 blockers, 2 warnings, 1 nit, all fixed
- W first run's Add still opened the download box on Windows when the tool went missing after the
  box opened (the one first-run missing-tool path pass 1's Windows fix did not reach). Now it says
  plainly that Kosmos cannot install it on Windows yet. Arm r9; perturbed red.
- W "Choose Grok again and Kosmos will offer to download it" led nowhere in Settings (re-choosing the
  chosen provider fires no change). The shared Grok sign-in driver now takes an `onMissing` hook: on a
  Mac a sign-in that finds no grok opens the caller's own download box (Settings' box; first run
  closes the key box and opens its box in its place). Windows, or a caller with no hook, keeps the
  plain sentence. Arms in render-grok-subscription-3391.js and r8; perturbed red.
- NIT after a download during a Grok sign in again, focus went to Grok's choice, which is hidden in
  that mode. It goes to whichever Grok control is showing. Arm r10; perturbed red.
- Measured clean: grokMissingTool on every caller; ACCT_KEYED_WHICH cleared on every path that
  hides Settings' box (open, close, provider change, the three reauth entries, a finished download).

## Suite
Both full runs (4c86126b..86ab7d68 and 5bb22c04): every node test passed (9212 and 9215, 0 failed).
The one red both times was tools/test-kosmos-addr-reclaim-3079.sh, which listens on a FIXED port
(17629) while three other agents' suites were running here; alone it passes 12/12. Pre-existing, not
this branch's; filed as #3716.
