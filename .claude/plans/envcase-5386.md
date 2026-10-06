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
