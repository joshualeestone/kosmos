# #5386: env deletes and sets outside childEnv match every spelling

Was stacked on PR #5384 (which added engine/win32env.js); moved onto main after it merged. THIS TOP SECTION IS THE
CURRENT STATE; the dated sections below record how it got here.

## Call (current)
- Every engine module that copies process.env for a child deletes and sets the account-scoped and world names through
  envDelete / envSet / envCanon: subscription.checkLive, orgchartfile, codexsigninlive, grokaccounts, create (the claude
  probe), boardrestart (kosmosRestart), win32codex (fallback), openaiaccounts (both Codex sign-ins), orgchartcodex
  (HOME, USERPROFILE, CODEX_HOME), remote (board token file), worlds (preWorldEnv, applyAgentWorldEnv on a copy,
  restorePreWorldRoots).
- process.env itself keeps plain access: on Windows Node already matches its names in any case; on a Mac a differently
  spelled name is a different variable the live process must keep. worlds.js applies the helpers only to copies.
- On a Mac or Linux envDelete/envSet do remove a differently cased variable from a COPY (a lowercase codex_home, say),
  so a child's environment can differ from before; harmless for these names, which nothing uses in another case. The
  world-name canonicalisation (canonWorldNames, which PROMOTES an odd spelling into the usual name) runs on Windows
  only: on a Mac a lowercase agent_workforce_home is a different variable and must not move the store (review 7).
- Not changed, with reasons: sandbox.js (TMUX, no tmux on Windows); win32channel, runners, update (Kosmos-only names
  Windows never supplies); win32signin (already every spelling); connect.installEnvFor (fresh object); connect run()
  (spreads opts.env over process.env with HOME/USERPROFILE: relies on Windows spelling USERPROFILE exactly, as it
  does by default); devicedoor (env[spec.configVar], a runtime-built name, sandbox-only).

## Tests (current)
- engine/envcase-5386.test.js: a scan of EVERY non-test engine module for a plain delete, an assignment, a bracket
  assignment, a spread-literal set or an Object.assign set of the account-scoped and world names; controls for each
  form, for comments, reads and process.env; pinned lines from before this card stay flagged. Behaviour tests for
  preWorldEnv, applyAgentWorldEnv (default world, and a named world with an oddly spelled sandbox root), each red on
  the earlier code.
- engine/subscription.test.js and engine/win32codex.test.js: oddly spelled inherited names, one key after.

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

## Review 2 (sonnet), 2026-10-07
- worlds: applyAgentWorldEnv now canonicalises the world and marker names on a COPY before reading them (test, red
  without it). restorePreWorldRoots and preWorldEnv use win32env only on copies: on process.env Node already matches
  any case on Windows, and on a Mac a differently spelled name is a different variable the live process must keep.
- Guard: a bracket-assignment form (env['NAME'] = x) with a read control; the header states its regex limits (code
  after a comment opener inside a string; runtime-built names; it over-flags non-env properties of these names). The
  main-reading control is replaced by pinned lines from before this card, so it stays armed after merge.
- subscription.test.js's oddly spelled process.env name only discriminates on a case-sensitive host; the source scan is
  the host-neutral guard for that site.
- Inline require('./win32env') calls hoisted to one top-level require per module.

## Review 3 (opus), 2026-10-07
- applyAgentWorldEnv on a copy now canonicalises every name it and applyWorldEnv touch (world, marker, three roots,
  AGENT_WORKFORCE_HOME): a named world on a copy with Agent_Workforce_Data now derives from, records and restores that
  root (test; red with only the world and marker canonicalised). Production callers pass process.env today.
- The guard covers the world names too (#1704's bleed), with a control. boardrestart's require hoisted.

## Review 4 (sonnet), 2026-10-07
- worlds: one helper, canonWorldNames (copies only), now runs in preWorldEnv, applyAgentWorldEnv AND applyWorldEnv, so
  applyActiveWorldEnv given a copy (it calls applyWorldEnv, which is not exported), and worldWorkersDir's override laid over preWorldEnv's result, keep one
  spelling (test: preWorldEnv with no marker; red without it).
- The guard also covers ANTHROPIC_API_KEY, OPENAI_API_KEY, AGENT_WORKFORCE_HOME, KOSMOS_AGENT_SESSION and
  KOSMOS_BOARD_TOKEN (no exact-spelling site exists today); its header says a new name must be added to be guarded.
- Left: subscription.test.js's title (the plan already says it discriminates only on a case-sensitive host);
  orgchartcodex CODEX_HOME via envSet is a no-op in effect, kept for uniformity.

## Review 5 (opus), 2026-10-07
- BLOCKER fixed: engine/win32anchor.world-1704.test.js builds a stand-in engine from a hand-kept file list, which lacked
  win32env.js once worlds.js required it at load time ("Cannot find module './win32env'"). The list is now DERIVED: the
  seeds plus every column-0 require('./x') they reach, followed through (lazy requires inside functions are not). A
  guard asserts it carries store, launchidentity and win32env and not the lazy worldbootguard. My touched-module runs
  missed it because the file is not named after worlds; the full-suite validation at convergence is the gate for that.
- applyActiveWorldEnv given a copy: a test with a real temp world (red without canonWorldNames in applyWorldEnv).
- Header: quoted keys and keys after a nested {...} in a spread are unseen. Nits: setVar beside delVar; win32codex's
  require comment.

## Review 6 (sonnet), 2026-10-07
- The stand-in's load-time require reader now follows any require('./x') in either quote on a line starting at column
  0 (const/let/var, a bare call, a multi-line destructure's closing line), keeps .json names, and skips indented
  (lazy) and commented ones; a control pins each form. Packaging confirmed: the bundle copies every non-test engine/*.js.
- boardrestart's "three deletes above" comment updated to the envDeletes.

## Review 7 (opus), 2026-10-07
- canonWorldNames is Windows-only (seam setWorldCaseFoldPlatformForTests, excused in engine.reachable.test.js); a Mac
  test shows a lowercase agent_workforce_home and marker left alone (red without the gate). The world behaviour tests
  drive the win32 arm through the seam.
- applyWorldEnv's marker, overrides and world id go through setVar, so they hold one spelling on a copy without
  depending on the canonicalisation having run first.
- Scan: compound assignment (??=, ||=, &&=) and a world name by constant key (env[X.PRE_WORLD_ROOTS_ENV_VAR]) with
  controls. Require reader: only same-folder './x' modules, stated.

## Review 8 (sonnet), 2026-10-07
- delVar/setVar now share canonWorldNames's platform check (foldsCase): on a Mac or Linux the world code treats a copy
  exactly as main did (plain access), so a lowercase kosmos_world or agent_workforce_data is neither promoted nor
  deleted. The Mac test asserts the delete half too (red when delVar folds everywhere). The account-name sites outside
  worlds.js still fold on every platform, as stated above.
- win32anchor's require reader and its control share one regex constant.
