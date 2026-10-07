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
