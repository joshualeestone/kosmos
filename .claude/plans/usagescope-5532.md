# usagescope-5532: usage scoped to one Kosmos's own agents (#5532, Enterprise E0.3)

Umbrella #5529. The company rollup (branch rollup-5532) withholds `usage` because engine/usage.js reads every Claude
config folder on the computer (status.configRoots), so its totals include the person's other Kosmoses and their own
sessions outside Kosmos. This branch adds the reader the rollup needs to send usage for this world only.

## What this branch builds
- engine/usage.js `scanUsage` and engine/usageproviders.js `Acc` (Codex, Gemini CLI, Grok, Antigravity) also keep a
  per-(day, launch folder, model) split, `folderModels`, from the same rows they already count.
- engine/usage.js `worldUsageByModel(days, agentDirs)`: fresh scans of the window (Claude with the mtime cut, the other
  providers in full), keeping only rows whose launch folder IS one of the agent folders after realpath; a subfolder is
  not claimed, and a transcript with no folder is nobody's. Returns `{ byDay: { day: { model: bucket } }, complete }`;
  complete is false when a provider was only partly read (or threw).
- Nothing calls it yet. The rollup will, once a day, under `usageConsented` (rollup branch).

## Decided
- No freezing: the per-day files the usage screen keeps are untouched, and no new cache format. One read a day.
- Rejected: filtering the existing per-model totals by folder (they carry no folder).
- Weakest premise: an agent's usage is the usage launched from its own folder. A person running Claude Code by hand in
  an agent's folder is counted as that agent, as the usage screen already does.

## Tests
- engine/usage-world-5532.test.js with real transcripts in a sandboxed config root: only the agent's own folder
  counts (a personal session and a subfolder session are left out; the computer-wide scan sees all three as a
  control); providers scoped the same way; a partly read or failing provider gives complete: false; an agent folder
  given as a link, and a session launched through a link, both match. Each of four mutations reddens.
- Every existing test file that calls the scans (66 tests) passes.

## Review 1 (blind, opus)
- FIXED: Claude's half reports completeness too (scanUsage counts transcripts it could not stat or read; any makes the
  scoped result complete: false); a failing scan returns complete: false instead of throwing; a folder that is not
  absolute, on either side, is nobody's; in the SCOPED split only, a subagent with no top-level transcript counts for
  nobody (its own folder may be where a person's session had cd'd to). Tests for each, the window (1 and 2 days), and
  a subagent of the agent's own session from a worktree; all 73 existing scan tests pass.
- DOCUMENTED: a message in two transcripts counts once, for the copy whose path sorts first, so an agent can be
  under-counted (the safe direction); `deps` is for tests only.

## Review 2 (blind, sonnet)
- FIXED: an agent folder that is the home folder or a filesystem root claims nothing (it would take every session the
  person started there); an agent folder that no longer exists makes the count incomplete (its past sessions cannot be
  matched by real path). Test; both mutations redden; all existing scan tests pass.
- CONSENT WORDING (told PigeonPete): "usage from sessions launched in your agents' folders", since a person's own
  session started in an agent's exact folder is counted as that agent's (the weakest premise above).
- DUPLICATES / KEPT: the scan-wide dedup can undercount an agent (documented); a case-different spelling on a
  case-insensitive disk undercounts (the safe direction).

## Review 3 (blind, opus)
- FIXED: a skipped parent whose head read fails counts as unreadable, so the count says incomplete instead of being
  quietly short (test with an old, unreadable parent; mutation reddens).
- STATED in the doc comment (the caller rule the privacy guarantee rests on): agentDirs is this Kosmos's own roster,
  never a listing of the workers folder, which several Kosmoses on one computer share.
- FIXED: a duplicate root check removed; distinct folders resolved once, in parallel; a test pins that the usage
  screen's per-folder totals keep their behaviour for an orphan subagent.

## Review 4 (blind, sonnet)
- FIXED: a folder that exists but cannot be listed (projects/, a project, a subagents tree) counts as unreadable, so
  the count says incomplete; a missing projects/ folder is still "no sessions" (test; mutation reddens).
- FIXED: tests that need chmod or symlinks skip, with the reason, on Windows or as root.
- DUPLICATES: the agentDirs roster rule (stated, review 3; the rollup PR must build agentDirs from the roster in a test);
  a person's session in an agent's exact folder (the weakest premise; consent wording with PigeonPete).

## Review 5 (blind, opus)
- FIXED, in code rather than a comment: worldUsageByModel builds its folders from this Kosmos's roster itself
  (worldAgentDirs: register.known() through create.workerDir, as the usage screen does); a caller cannot pass a list
  (`deps.agentDirs` is for tests). An unreadable roster gives complete: false.
- FIXED: a folder that contains another agent's folder (the workers root, a person's ~/work) is a shared parent and
  claims nothing (test; mutation reddens).
- NOTED: days is meant to be small (every call is a fresh scan); Gemini's folder comes from .project_root, which may be
  a project root rather than the launch folder (a subfolder there could be claimed; one provider, measured later).

## Review 6 (blind, sonnet)
- FIXED: a dropped shared-parent folder makes the count incomplete (its own sessions are left out too; test).
- STATED as a residual in the code: ownership is by launch folder only; in the default world two Kosmoses' agents with
  one name share a folder, and a person's own session in an agent's exact folder cannot be told apart. Usage is sent
  only under consent words naming "sessions launched in your agents' folders".
- FIXED: the doc comment sits on worldUsageByModel again; the walk's onError note joins its function; an arity test
  replaced by a behaviour test (a list passed as the second argument is not used).
- DUPLICATE: the dedup undercount (documented).
