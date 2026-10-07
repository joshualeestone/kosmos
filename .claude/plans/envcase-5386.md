# #5386: env deletes and sets outside childEnv match every spelling

Stacked on PR #5384 (winpolicy-5358), which adds engine/win32env.js (envDelete, envSet). Rebase onto main (this
branch's own commits) once #5384 merges; review loop and proof run on a diff of only these files.

## Call
- The six sites a reviewer of #5384 listed copy process.env for a child and delete or set a name by its exact
  spelling: subscription.checkLive, orgchartfile (the Claude read), codexsigninlive, grokaccounts (sign-in), create
  (the claude probe), boardrestart (kosmosRestart). Each now goes through envDelete / envSet.
- Reads of process.env itself are left alone: on Windows process.env looks names up case-insensitively; only a
  COPY keeps them as spelled.
- On a Mac (case-sensitive), removing other spellings of a name the child reads in one spelling changes nothing it
  reads; setting writes the usual spelling, as before.

## Tests
- engine/subscription.test.js: an oddly spelled Claude_Config_Dir does not reach a default-account check; a named one
  is one key.
- engine/envcase-5386.test.js: no plain `delete env.` / `delete env[` in the modules that build a child's env, with a
  control that the scan can fail.

## Weakest premise
How often a real Windows environment carries a non-canonical spelling of these names.

## Added after #5384 merged (2026-10-07)
- Moved onto main: replayed only this card's commit (b71ada0ab) with rebase --onto, since #5384 was squash-merged.
- win32codex.runCodexTurn's fallback (no opts.env: process.env plus the account CODEX_HOME) now sets CODEX_HOME through
  envSet, so an inherited Codex_Home cannot sit beside it (#5384 review 20 named it). Test in win32codex.test.js with an
  oddly spelled inherited name; planting the old fallback turns it red. win32codex.js joins the no-plain-delete scan.
  Production callers pass env through win32codexsup, so this is the fallback path only.

## Review 1 (opus), 2026-10-07
- More sites, same class, found by widening the scan rather than by a list: openaiaccounts.js (both Codex sign-ins:
  a key or a subscription could land in the default CODEX_HOME), orgchartcodex.js (its allow-list keeps USERPROFILE and
  HOME in any spelling, then set them beside it; CODEX_HOME too, for uniformity), remote.js (the board token file),
  worlds.js (restorePreWorldRoots and preWorldEnv; the marker is moved to its usual spelling with envCanon before the
  check, so an oddly spelled marker still restores the roots). connect.installEnvFor builds a fresh object: unchanged.
- The guard now scans EVERY non-test engine module for a delete, an assignment, a spread-literal set or an
  Object.assign set of the account-scoped names (CLAUDE_CONFIG_DIR, CODEX_HOME, GROK_HOME, XAI_API_KEY,
  KOSMOS_AGENT_TOKEN, KOSMOS_BOARD_TOKEN_FILE, GEMINI_API_KEY, GEMINI_CLI_HOME). Controls: each form caught, comments
  and process.env not; and main's own subscription.js is flagged. Run against main's engine/ it lists 14 sites in 10
  modules, five of them sets the old delete-only scan could not see. Not seen: a name built at runtime.
- worlds: a behaviour test with oddly spelled world variables (red on main's worlds.js).
- On a Mac or Linux these helpers also remove a genuinely different variable that differs only in case (a lowercase
  codex_home, say), so the child's environment does change there. Harmless for these names, which nothing uses in
  another case; stated so nobody reads "no change on a Mac".
- Not changed (reasons): sandbox.js deletes TMUX/TMUX_PANE (no tmux on Windows); win32channel, runners and update add
  Kosmos-only names Windows never supplies; win32signin already deletes BROWSER in every spelling.
