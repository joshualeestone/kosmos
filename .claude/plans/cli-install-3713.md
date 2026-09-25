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
  size, Download / Not now) instead of the dead-end sentence; progress comes from the engine's own
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
  at 05:30; answer recorded below when it comes.
- The Gemini launcher bakes the board's node path at install time. If an update moved the runtime,
  the launcher would fail its next run (Connect's probe still reads present). Updates replace the
  runtime in place today.

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
