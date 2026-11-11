# win-edit-hooks-8348: the Codex edit hook on Windows (kosmos#8348, Codex slice)

**Posture:** production

On Windows, edits by a Codex agent leave no changed-by record and no undo copy. Two causes, both read from code and
then measured on the Windows box with codex-cli 0.149.1 win32-x64 (the pin), `codex exec` against a local fake
Responses server (no account). The measurements are listed below.
1. Nothing on the Windows launch path installs the PreToolUse hook. Only the Mac supervisor calls codexhooks.js.
2. bin/codex-report-bridge.js resolves the patch paths with posix rules. A Windows Codex reports cwd as `C:\...`,
   which posix calls relative, so no keep call is made even when the hook runs.

## Measured (Windows box, 2026-11-11)
- No trust record: the hook does not run, and nothing is printed (`codex exec` skips it silently). With a record: it runs.
- Hooks run through POWERSHELL. `%ComSpec%` stayed literal and `$PSVersionTable` expanded.
- `"C:\...\node.exe" "C:\...\bridge.js"` fails: PowerShell reads a leading quoted string as an expression.
  `& 'C:\...\node.exe' 'C:\...\bridge.js'` runs. This is the form geminisettings.js uses on win32 for the same reason.
- The payload has the same shape as on the Mac: tool_name apply_patch, tool_input.command = the patch, cwd = `C:\...`.
- Trust key: `[hooks.state.'<hooks.json path>:pre_tool_use:0:0']`, a TOML literal-string key, in the on-disk spelling
  with backslashes. Forward slashes, a `\\?\` prefix, all lowercase and a lowercase drive letter do not run. With
  CODEX_HOME given lowercased, the on-disk spelling still runs (Codex canonicalizes; = fs.realpathSync.native).
- A hook that fails (its bridge path is gone) shows "hook: PreToolUse Failed", and the patch is still applied.
- trusted_hash uses the same formula as the Mac (codexhooks.trustHash).

## Change
- engine/codexhooks.js: `commandFor(bridge, {platform,node})` gives the win32 call-operator form, with an absolute
  node (the installing node, the bundled runtime). `stateHeading(file, platform)` gives the literal-string key on
  win32. `isOurs` recognises the win32 shape. `install(home, bridge, version, opts)` refuses a quote-bearing path on
  win32 (`unsafeForWin32`, the same set as geminisettings). On win32 it never overwrites a hooks.json that is not
  ours, because there the home is the ACCOUNT's, not a private per-agent home.
- engine/win32codexsup.js: at a codex agent's start, install the hook into its NAMED Codex home (s.configDir), after
  asking that codex for its version. An agent on the default ~/.codex gets no hook: that home belongs to the person.
  A refusal is reported as an event and never stops the agent.
- bin/codex-report-bridge.js: a drive-letter or UNC cwd takes path.win32 rules. Every other cwd is unchanged.
- engine/codexhooks.win32-8348.test.js: pure arms on any host, plus the real Codex for Windows with the real bridge
  and a stub board, a broken-hash control, and an arm with the home lowercased. Checked: without the bridge fix it
  fails.
- tools/windows-tests.js: the reason codexhooks-5812 stays excluded on Windows is now accurate.

## Decided
- Codex only in this PR. Grok and Antigravity need a signed-in account on the box to measure (the card asks for a
  real Windows run each), and this box has only Claude and Gemini. They stay open on #8348.
- Named homes only, and never the person's own: with CODEX_HOME (or AGENT_WORKFORCE_CODEX_HOME) set, the default
  account's agent carries that folder as its configDir (create.js codexHomeOverridden), so installCodexHookFor
  compares the folder canonically with codexupdate.defaultHome() and ~/.codex and skips a match.
- Named homes only. Rejected: writing into the person's ~/.codex (their own Codex would then run our hook) and adding
  a private per-agent Codex home on Windows (a much larger change to auth and runtime). What would change my mind:
  Windows agents moving to private homes, as the Mac did in #4592.
- The shared account home: on win32 a refusal leaves our files in place, so one agent's trouble (a failed version
  probe, a busy lock, a path we will not quote) cannot take the hook from another agent already running on the same
  account. A different Codex version that the probe did read is the whole account's Codex, so then our hooks.json is
  taken back, as on the Mac.
- An interactive Codex on the same named home. The Mac refuses to put the hook into a home that resolves to the
  person's own account (agent-supervisor.sh, Review 5), because a TUI Codex shown a hook whose record does not count
  stops on "Hooks need review". On Windows Kosmos never runs the TUI (every turn is `codex exec`), and the named home
  is the `~/.codex-<label>` folder Kosmos's sign-in made. Codex Desktop and a plain `codex` use `~/.codex`, which gets
  no hook. The only way to reach the named home interactively is to set CODEX_HOME to it by hand. Even then, the
  record is the one that Codex version computes for this exact command, so a TUI of the same version trusts it. A
  TUI of another version would show its review screen to a person who is sitting there and can answer it. That is
  not an unattended agent stuck. Rejected: refusing every named home, which would leave the whole feature with no
  Windows coverage. What would change my mind: Kosmos running Codex interactively on Windows, or Codex Desktop
  reading named homes.
- The same trust key spelled as a basic string with doubled backslashes counts as written by hand and is left alone,
  as any hand-edited record is on the Mac; the refusal says the hook may not run. Not rewritten: Codex itself writes a
  Windows path key as a literal string (measured: it wrote `[projects.'c:\users\...']`), so only a person makes the
  doubled spelling, and their edit is theirs.
- Start-up order: the version probe is asynchronous and runs after presence is stamped. The install itself runs in
  the supervisor (the Mac runs it as a CLI) and takes the config.toml lock synchronously, so under contention (two
  agents on one account starting together) it can hold that supervisor up to the lock's 2 s wait, once, at start.
  Accepted: a short stall at start, no lost work. Only an agent with a named
  home waits on it, and only its first turn waits (bounded by the probe's 15 s), so that turn's edits are recorded.
- Updates and temp extracts: an installed Kosmos runs its engine from %LOCALAPPDATA%ProgramsKosmosapp, and an
  update swaps the new build into that same path (win32apply; older builds move aside), so the bridge path written
  stays good across updates. An engine running from a temp extract (a release cut, a check) must not write its temp
  path into a durable home: install refuses that with the #1582 rule geminisettings.js already applies, now one shared
  function (geminisettings.ephemeralIntoDurable).
- Lifecycle: nothing on Windows removes the hook from an account home after an uninstall or a move. The Gemini hook
  in a named Gemini home is left behind in the same way today; the uninstaller cleans only Claude's settings (#5999).
  Measured with the real Codex: a hook whose bridge is gone shows "PreToolUse Failed" and the edit is still made, so
  a leftover costs one failed node start per edit, not the agent. Cleaning both up at uninstall is kosmos#8361, not
  this PR.
- A Codex version other than 0.149.1 gets no hook, and says so only in its supervisor log. Guarded instead of
  surfaced: a test fails when the Windows Codex pin (runners.CODEX_WIN32) moves without HASH_VERIFIED_FOR moving with it,
  as codexhooks-5812 does for the Mac pin.
- The weakest part: the live on-board check ("changed by" shown on a real project file) needs an OpenAI sign-in on
  the box. The real-Codex test proves the hook, the bridge and the keep call, but not the board's display. That check
  is owed on #8348 itself, which stays open (this PR only addresses it), on the next Windows staging build with an
  OpenAI account signed in on the box.
