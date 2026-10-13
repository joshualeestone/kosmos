# geminiupdate-6058: a Gemini agent no longer updates the gemini CLI under Kosmos (kosmos#6058)

## Why
gemini-cli updates itself. Launched from an npm-global install it replaced 0.61.0 with 0.63.0 about ten seconds
after a Gemini agent started (measured on the card, 2026-10-13). Kosmos pins 0.61.0 (`engine/runners.js`
MANIFEST.gemini): the hooks, the trust dialog, the session format and the model fallback were all measured on it.

## Change
- `engine/geminisettings.js` `ensurePrepared`: writes `general.enableAutoUpdate: false` and
  `general.enableAutoUpdateNotification: false` into the settings file it already prepares for a Gemini agent.
  Each key only when it is ABSENT.
- `engine/geminisettings.test.js`: four tests.

## What the CLI does with them (read in the installed 0.61.0 bundle)
- `checkForUpdates` returns nothing when `enableAutoUpdateNotification` is false: no check is made, so nothing is
  installed and no banner is drawn in the agent's pane.
- `handleAutoUpdate` installs only when `enableAutoUpdate` is true; with it false and the notification on, it prints
  "Please run npm install -g ... to update" and installs nothing.
Either key alone stops the install. Both are written so the pane also shows no banner, and so one key a later
release renames still leaves the other.

## Measured (2026-10-13, about 10:54 CDT, this computer, the real gemini 0.61.0 with 0.63.0 available)
Two real interactive launches, each in its own throwaway home (`GEMINI_CLI_HOME`, the per-account shape Kosmos uses)
and its own detached tmux session, 30 s each, then 15 s more before reading the installed version:
- CONTROL, only `enableAutoUpdate: false` in the file: the screen shows "Gemini CLI update available! 0.61.0 →
  0.63.0" and "Please run npm install -g @google/gemini-cli@latest to update". So the check DOES run in this launch
  state, and it did not install.
- FIXED, the file exactly as `ensurePrepared` writes it: no update words on the screen at all (0 lines), and the
  prompt is up.
- The installed gemini read 0.61.0 before and after.
This also settles the card's weakest premise: `general.*` IS read from the settings file under the agent's own home.
The arm with nothing set (which updates) is the one the card's author measured; I did not rerun it, because it
changes the shared install.

## Decided
- **Only when absent.** On the default account this file is the person's own `~/.gemini/settings.json`, and the
  module's rule is never to overwrite what a person chose (the auth type has the same rule). A person who set
  `enableAutoUpdate: true` keeps it. Rejected: forcing false. It would keep the pin against a person's stated
  choice about their own tool, and would flip it back every time a Gemini agent is made.
- **Settings, not an environment switch.** The CLI has one (`IS_BINARY=true` skips the updater), and it is scoped to
  the agent's own process, which is what I wanted. Rejected because the same variable also changes how the CLI
  reads its own arguments and relaunches itself (`isStandardSea`, `getSpawnConfig`), none of which Kosmos has
  measured.

## What this costs, said plainly
On the default account the person's OWN `gemini`, run by hand outside Kosmos, also stops updating itself, because it
reads the same file. They turn it back on by setting the key to true, which Kosmos then leaves alone.

## Weakest premise
That a file with these keys absent is the common case. A person who already set `enableAutoUpdate: true` gets no
protection, and their agents can still move the shared gemini. I have no count of such files.

## Residuals
- **Gemini agents that already exist on a Mac get this only when the next Gemini agent is created on the same
  account**, because the settings are prepared at creation (the same residual #5812's hook has, and the deferred
  re-apply at launch from #3136 would close both). Until then an existing agent can still update the CLI.
- The Kosmos-managed copy of gemini (the card's open question: does it try to update, and what happens with no
  npm?) is not measured here. The two keys stop the attempt wherever the CLI came from, since the check is skipped
  before it looks at how it was installed.
- Windows: `win32keyed.js` calls the same `ensurePrepared` on a keyed turn, so the keys are written there too.
  Not run on Windows.

## What would change this
A gemini release that renames or drops both keys (the settings file would then be silently ignored, and the pin
would move again): the measurement above is how to find out, on the new version.

## Verify
- `engine/geminisettings.test.js` and `engine/geminisettings.toolhook-5812.test.js`: 32 pass, 0 fail.
- Every `engine/*gemini*.test.js` and `engine/win32keyed*.test.js`: 187 tests, 183 pass, 0 fail (4 skipped).
- The live two-arm measurement above.
- NOT RUN: the full suite (queued).
