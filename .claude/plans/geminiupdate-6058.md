# geminiupdate-6058: a Gemini agent no longer updates the gemini CLI under Kosmos (kosmos#6058)

## Why
gemini-cli updates itself. Launched from an npm-global install it replaced 0.61.0 with 0.63.0 about ten seconds
after a Gemini agent started (measured on the card, 2026-10-13). Kosmos pins 0.61.0 (`engine/runners.js`
MANIFEST.gemini): the hooks, the trust dialog, the session format and the model fallback were all measured on it.

## Change
- `engine/geminisettings.js` `ensurePrepared`: writes `general.enableAutoUpdate: false` and
  `general.enableAutoUpdateNotification: false` into the settings file it already prepares for a Gemini agent,
  unless the person has already made the choice (the rule is under Decided).
- `engine/geminisettings.test.js`: five tests.

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
- **Two choices, and neither is overridden.** INSTALL is `enableAutoUpdate`; CHECK is
  `enableAutoUpdateNotification`. Either one off stops the install, because no check means nothing to install. So
  they cannot be filled one at a time: my first version wrote "no check" beside a person's "keep installing" and
  switched their updates off through the other key (review 2). The rule:
  - they chose about INSTALL, either way: nothing is written. Off, the pin is safe. On, it is theirs.
  - they chose only about the CHECK: installs are switched off, their check setting is left as it is.
  - they chose neither: both are switched off, so the pane shows no banner either.
- **The older spelling counts as the person's choice.** gemini still reads `general.disableAutoUpdate` and
  `general.disableUpdateNag` and migrates them to the two keys above, inverted (`migrateDeprecatedSettings`; I read
  the mapping in the 0.61.0 source after review 1 found it). With the new key also in the file the CLI keeps the
  new one and deletes theirs. So a boolean under the old name is a choice, like the new name.
- **Never forced.** On the default account this file is the person's own `~/.gemini/settings.json`, and the
  module's rule is never to overwrite what a person chose (the auth type has the same rule). Rejected: forcing
  installs off. It would keep the pin against a person's stated choice about their own tool, and would flip it
  back every time a Gemini agent is made.
- **Settings, not an environment switch.** The CLI has one (`IS_BINARY=true` skips the updater), and it is scoped to
  the agent's own process, which is what I wanted. Rejected because the same variable also changes how the CLI
  reads its own arguments and relaunches itself (`isStandardSea`, `getSpawnConfig`), none of which Kosmos has
  measured.

## What this costs, said plainly
On the default account the person's OWN `gemini`, run by hand outside Kosmos, also stops updating itself, because it
reads the same file. They turn it back on by setting the key to true, which Kosmos then leaves alone.

## Weakest premise
That a file with these keys absent is the common case. Three kinds of file get no protection, and their agents can
still move the shared gemini: one where the person chose to keep installing (`enableAutoUpdate: true` or the old
`disableAutoUpdate: false`) and has not switched the check off; one with comments in it (the CLI reads those, Kosmos's `JSON.parse` does not, so the whole file is left
alone, as before this change); and one this change wrote that a running gemini then saves over (below). I have no
count of any of them.

## Residuals
- **Gemini agents that already exist on a Mac get this only when the next Gemini agent is created on the same
  account**, because the settings are prepared at creation (the same residual #5812's hook has, and the deferred
  re-apply at launch from #3136 would close both). Until then an existing agent can still update the CLI.
- **A gemini that was already running when the keys were written can delete them.** The CLI saves its settings by
  comparing the file with the copy it loaded and removing what that copy lacks (`applyKeyDiff`; review 1 read it).
  So an existing agent, or the person's own gemini, that was started earlier and then saves a setting takes the
  two keys out again, until the next Gemini agent is created. The #5812 hooks in the same file have the same
  exposure. A re-apply at each launch (#3136, deferred) would close this and the residual above together.
- The Kosmos-managed copy of gemini (the card's open question: does it try to update, and what happens with no
  npm?) is not measured here. The check is skipped before the CLI looks at how it was installed, so the keys apply
  to it the same way. From reading, not from a run.
- A settings file that outranks this one can turn it back on: gemini merges the user file under a trusted
  `.gemini/settings.json` in the agent's own folder and under a system settings file. Kosmos writes neither.
- Windows: an agent's settings get the keys at creation, as on a Mac. A headless Windows turn never checks for
  updates anyway (the check lives only in the CLI's interactive entry, read by review 1). Not run on Windows.

## What would change this
A gemini release that renames or drops both keys (the settings file would then be silently ignored, and the pin
would move again): the measurement above is how to find out, on the new version.

## Verify
- `engine/geminisettings.test.js` and `engine/geminisettings.toolhook-5812.test.js`: 33 pass, 0 fail. One of the
  five new tests is a table of eleven files a person might have, each with what must be there afterwards.
- No test goes through a caller (`create.js`'s write at an agent's creation): the five tests call `ensurePrepared`
  with a file, as the module's other tests do.
- Every `engine/*gemini*.test.js` and `engine/win32keyed*.test.js`: 187 tests, 183 pass, 0 fail (4 skipped).
- The live two-arm measurement above.
- NOT RUN: the full suite (queued).

## Review 1 (2026-10-13, default model), at 33e212558
0 BLOCKER, 2 WARNING, 0 CONVENTION, 7 NIT. Not converged.
- **WARNING, taken:** the older spelling of each key. With `disableAutoUpdate: false` in a person's file my change
  wrote `enableAutoUpdate: false` beside it, the CLI kept mine and deleted theirs: the opposite of "never overwrite
  what a person chose". A boolean under the old name now stops the write; a test with a control.
- **WARNING, stated (not fixable here):** a gemini already running can delete the keys when it saves its settings.
  In Residuals, with the #5812 hooks' same exposure.
- **NIT, three stated:** a workspace or system settings file outranks this one; what Windows does and does not do;
  a file with comments in it is left alone whole.
- **NIT, taken:** the array arm of one test could not fail (JSON drops a key set on an array); removed. A line that
  only restated the constant; removed. The quoted update message, as the CLI prints it.
- **NIT, stated:** no test through a caller.
- The reviewer confirmed from the 0.61.0 source what the plan says the two keys do, that both default to true, that
  the only install command is the one `handleAutoUpdate` runs, and that a legacy key never overrides a new boolean
  key. It could not rerun the live measurement (it must never launch gemini) and found it consistent with the source.

## Review 2 (2026-10-13, sonnet), at b407a0f96
0 BLOCKER, 1 WARNING, 0 CONVENTION, 1 NIT. Not converged.
- **WARNING, taken, and my own test had blessed it:** I filled the two keys one at a time. For a person with
  `enableAutoUpdate: true` and nothing else, I wrote `enableAutoUpdateNotification: false`: the check then never
  runs and nothing installs, so their choice was overridden through the other key. My test asserted their key was
  "left alone" and never asked whether their gemini still updated. The plan also said such files "get no
  protection", which was wrong. The rule is now the three lines under Decided, with a table test, and a second
  test that asks the question I had not: after the write, can the CLI still install?
- **NIT, taken:** the plan's count of tests.
- The reviewer walked `migrateBoolean` for every pairing of old and new key, and checked the Residuals sentence by
  sentence against the source (the key-deleting save, the merge order, the check living only in the interactive
  entry): each is consistent.
