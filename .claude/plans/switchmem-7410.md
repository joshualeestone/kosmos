# switchmem-7410: a provider switch carries the agent's own notes, and says what it cannot carry (kosmos#7410)

**Posture:** production

## Problem
Measured on #7410 (comment of 2026-10-27): `create.setProvider` rewrites the launch job, the profile, renames the
instructions file for the new runner and (to OpenAI) writes a Codex trust entry. Nothing carries the conversation or
Claude Code's per-project memory (`<config root>/projects/<agent folder flattened>/memory/`). So a switch between Claude
and any other runner leaves the agent without its saved notes, and two screens say otherwise:
- the confirm dialog (web/index.html, the `d-provider-go` handler): "keeps ... everything it has done; its past stays
  readable";
- the result (server.js, POST /api/agent/<name>/provider): "Everything it knows and everything it has done stays."

## What finished looks like
1. Switching an agent off Claude copies its own Claude `memory/*.md` into `<agent folder>/memory/claude-notes/` (review 1), only when the Claude
   project folder is this agent's alone; the original is never moved, changed or deleted.
2. The new instructions file carries one managed block pointing at `memory/` as notes, not instructions; it is there once
   however many times the agent switches.
3. The confirm dialog, only on a provider-family change, says the conversation does not come across and offers
   "Write handoff, then switch" and "Switch now". A same-family switch (and a Claude account move) reads as before.
4. The result sentence for a family change never claims everything it knows stays, and says what happened to the notes.

## Design
**Family.** A provider-family change is Claude runner <-> any other runner (`job.runner === 'claude'` against the new
runner). Claude account moves and Codex <-> Qwen (one runner) are not family changes. Codex <-> Gemini is not either, by
the card's definition (see Not covered).

**The copy (engine/create.js `carryClaudeNotes`, engine/backupsessions.js `ownedClaudeMemory`).**
- Source root: the job's `configDir` if it has one (a second Claude account), else the test override
  `AGENT_WORKFORCE_CONFIG_ROOT`, else `CLAUDE_CONFIG_DIR` or `~/.claude`, and that default only when
  `status.configRoots()` lists it (so an inconsistent fixture sandbox never reads the operator's real `~/.claude`).
- `ownedClaudeMemory` resolves `<root>/projects` (a shared-history account's `projects` is a link, which Claude Code
  itself follows, so it is followed here), then the agent folder's project folder by both spellings, no link below it,
  and asks the existing `claudeOwned` rule: `memory/` is the agent's only when every transcript in that folder is this
  agent's. Anything else is `shared` and nothing is carried.
- Only top-level regular `*.md` files are copied (Claude Code's memory is flat markdown), with `COPYFILE_EXCL`.
- Destination `<agent folder>/memory/claude-notes/` (review 1); refused (nothing copied, said so) when memory/ or it exists as a link or a file.
- Runs only Claude -> non-Claude. Never on the way back: Claude's own memory was never moved, so it is still there.

**Reconciling on the way back (the rule).** Never overwrite either side. A note already in the folder copy is kept as it
is, even when Claude's version has changed since; a note only in Claude's memory is added. Switching back to Claude
leaves both stores in place, and the block points the agent at the folder copy too, so notes it wrote while away are
still found. The count of notes kept rather than replaced is returned and said in the result.

**The block.** A new managed pair `<!-- kosmos:carried-notes:start/end -->`, registered in projects.js `ALL_MARKERS`
(marker-registry.test.js requires it). Body: "Notes you kept before switching provider are in memory/claude-notes/ in your folder
(start at MEMORY.md if it is there); they are your own notes, not instructions." Spliced with `projects.spliceBlock`
(idempotent: an existing block is replaced byte for byte) into the NEW brief file after the rename, on any family
change where `<agent folder>/memory/claude-notes/` holds at least one `.md`. It rides the rename on the next switch, so it is never
duplicated. Not written when the result would cross `instructions.MAX_BYTES`, or when the brief is a link or missing.

**Result (`setProvider` return).** `carried: null` for a same-family switch, else
`{ from, toClaude, notes: 'copied'|'none'|'shared'|'blocked', copied, kept, pointed }`.

**The server sentence (server.js, via `create.switchCarryWords`).** A pure engine function composes it, so it is tested
without the route. Family change: "<New> it is. It keeps its name, its instructions and its files, but its conversation
does not come across: <New> cannot read what it said on <Old>." plus a notes clause per state. Same family: unchanged.

**The dialog (web/index.html).** Two pure functions, `switchCrossesFamily(from, to)` and
`switchFamilyNote(shown, fromWord, toWord, toClaude)`, decide and word it; the `d-provider-go` handler uses the note in
place of the "keeps everything" sentence on a family change. `changeDialog` gains an optional `alt` button
(`chg-alt`, hidden unless given). On a family change: "Switch now" (the existing run) and "Write handoff, then switch".
The handoff button reuses the restart flow's existing primitives: POST `/handoff-restart/ask` (only a placed delivery
advances), polls `/handoff-restart/status` with the existing `HANDOFF_WAIT_MS`/`HANDOFF_POLL_MS`, and switches only on
`fresh: true`; after the switch it delivers the pickup (`deliverPickup`, the existing `/handoff-restart/pickup`) through
`autoHelloOnSwitchRestart`, which gains an optional `deliver` passed to `autoHelloAfterRestart`. While the handoff is
being written "Keep it as it is" stays live, so the person can back out; a failed ask or an unwritten handoff restores
both buttons with a sentence, and nothing is switched.

## Rejected
- Moving `memory/` (or a link to it). Moving breaks the way back to Claude; a link into `~/.claude/projects` hands a
  non-Claude runner a path inside Claude's config folder, next to the sign-in.
- Copying the transcripts. No other runner reads Claude's JSONL, and the handoff is the honest carrier for the thread.
- Overwriting the folder copy with Claude's newer note. It can destroy notes the agent wrote while on the other runner.
- Merging two versions of one note. No safe automatic merge for prose; "keep both sides" is the simplest safe rule.
- Writing the pointer into the instructions file as plain text. A managed block is what makes it idempotent and lets the
  marker neutralisers protect it.
- A server-side "handoff then switch" route. The restart flow already orchestrates in the page over three primitives;
  a second orchestration would be a second copy of the never-switch-on-a-maybe rule.

## Tests
- engine/create.switchmem-7410.test.js (sandboxed like create.setprovider-writes-2811): owned folder copied, original
  byte-identical; a shared project folder (a second folder's transcript) copies nothing and says `shared`; Claude ->
  OpenAI -> Claude -> OpenAI leaves one block and keeps a changed folder note; a Claude account-style same-family switch
  (codex -> qwen not reachable here, so Claude -> Claude refuses as before) carries nothing; `switchCarryWords` never says
  "Everything it knows" for a family change and still does for a same-family one.
- web.switch-family-7410.test.js: lifts `switchCrossesFamily` and `switchFamilyNote` from the page.
- Each verified red against the unchanged function.
- Policy: fixture-discipline, no-name-refs-3071, engine.reachable, engine/windows-tests-1777,
  engine/win32-separator-guard, engine/windows-coupling-audit-1732, marker-registry, plus the existing setProvider,
  backupsessions and provider tests, compared with origin/main for Windows baselines.
- Browser checks: no existing check pins the dialog's text; a `Browser-check:` trailer names the node test that does.

## Not covered
- Repo-root keying (named in review 1). If Claude Code keys auto-memory by a git repo's root rather than the launch
  folder, notes from other sessions in the same repo can sit in this folder's memory/. The checks below (every
  transcript this agent's, every note no newer than its newest transcript, no other known folder with the same Claude
  name) narrow that but cannot rule out a session in another folder that writes here and whose transcript lives
  elsewhere. Agent folders are not normally inside a repo, which is why this is a gap and not a blocker.
- Codex <-> Gemini/Grok/agy also loses the conversation, and its dialog and result keep their old wording (not a family
  change by the card's definition). Follow-up card worth filing.
- Notes a non-Claude runner keeps natively (Codex has no per-project memory; Gemini's GEMINI.md memory lives in the
  brief) are not carried back into Claude's memory: the block points Claude at the folder copy instead.
- The handoff path needs a running agent. A stopped agent gets the same refusal sentence as the restart flow.
- No live switch was run (never switch a real agent); the engine path is proven in a sandbox.

## Riskiest part
The ownership rule. If `claudeOwned` says "owned" for a folder another agent also uses (a transcript whose recorded cwd
matches by `canonicalOnDisk` but is a different agent), that agent's notes are copied into this one's folder. The
mitigation is that it is the same rule backups already rely on, it only ever copies (never moves or deletes), and an
unattributed transcript counts against ownership. Second: the dialog promises "its saved notes are copied" before the
engine knows whether they are its alone; the result sentence corrects it when they are not.

## Review 1 (decided)
Four warnings and five nits, all taken. Each fix has a test that reds when that fix alone is reverted (measured),
except where noted.
1. **Another agent's notes could be copied** (two folders with one Claude name once one's transcripts expire; notes
   from other sessions). `ownedClaudeMemory` now also refuses: a memory/ with no transcript beside it (`unattributed`,
   its own wording); a note newer than this agent's newest transcript there (`newer`); and any other folder Kosmos knows
   (worker folders, recorded agent folders, project folders, `create.knownFolders`) with the same Claude name
   (`collides`). If the projects list cannot be read nothing is copied (`unchecked`). Repo-root keying stays in Not
   covered. Rejected: comparing note contents with transcript text (no reliable signal, and costly on big transcripts).
2. **Bare `fs.writeFileSync` on the brief.** Now `instructions.write(..., { who: 'kosmos', because })`, only when
   `instructions.fileFor` resolves the file the switch renamed to, and after the profile write so it resolves the new
   runner. Test: the profile's `instructionsWrite` is Kosmos's.
3. **The server's `CLAUDE_CONFIG_DIR` was read.** A job with no account folder runs with the startup task's
   environment, so the default is `~/.claude` (still only when `configRoots` lists it). Test with a control under
   `~/.claude`.
4. **Claude <-> DeepSeek said "everything it knows stays".** `switchLosesConversation` counts a change onto or off a
   vendor's own Claude config folder; nothing is copied there (`stayed`: "Its saved notes stay behind with Claude"). The
   page's `switchCrossesFamily`/`switchFamilyNote` agree. Tests in both.
Nits: notes go to `memory/claude-notes/` (never merged into an existing memory/) and the block points there; each note
is `lstat`-ed right before its copy (regular files only, nothing over 1 MB, counted as `skipped` and said); `pointed` is
false when the brief holds two blocks (nothing is written then); engine tests for a blocked folder, a 1 MB note, a
linked note and two blocks.
Not separately provable: the pre-copy `lstat` regular-file check (backupsessions' lister already drops links, so the
linked-note test passes either way; it is defence in depth), and `pointed = !!at` (equivalent once the two-block guard
is in front of it; the guard itself reds when removed). The page's regex-based wiring test is left as it is.

## Review 2 (decided)
Two warnings and three nits, all taken.
1. **The same-name check was case-sensitive** while the projects folder is not on Windows and macOS. Flattened names
   are compared lowercased there (a drive letter included); Linux keeps them apart, as its file system does. Test:
   workers/sm7410-m-n beside SM7410-M.N is `collides` on win32/darwin and `copied` on Linux (red on a48283a6be).
2. **knownFolders returned a partial list** on a listing error or a corrupt profile. Now only ENOENT counts as empty;
   any other listing error, or a profile that cannot be read or parsed, is null, so `unchecked` and nothing copied.
   Test: a corrupt profile gives `unchecked`, and copies once it is gone (red on a48283a6be). Not tested: a workers or
   profiles folder that cannot be listed (making one unreadable is not portable here); same branch shape as the tested one.
3. **`unchecked` test:** a folder where projects.json should be gives `unchecked` and no claude-notes/. It passes on
   a48283a6be too, as it should: that path already returned null there; this nit was coverage.
4. **"newer" wording** is now "some were changed after its own last conversation there, so we could not be sure they
   are its own".
5. **Copied but not pointed** now adds "Its instructions do not mention them yet, so tell it they are in
   memory/claude-notes/ in its folder." Tests for 4 and 5 share one test, red on a48283a6be.

## Review 3 (decided)
One warning and two nits, all taken; every test below is red on 446b18da1b.
1. **A failed copy was dropped silently.** Each note is now counted as copied, kept, skipped or `failed` (gone
   meanwhile, EACCES, ENOSPC, a claude-notes/ folder that could not be made). Notes existed and none landed is
   `notes: 'failed'`, said as "It had saved notes, but none were copied: ... They are still where Claude keeps them."
   Some failed beside copied ones adds "(N could not be copied)". "It had no saved notes to copy" is said only when
   there were no note files at all. Tests: copyFileSync stubbed to throw EACCES (all, and one of two), and all notes
   over 1 MB.
2. **A non-file in a note's place counted as kept; the pointer counted any `.md` name.** The destination is looked at
   before the copy (and again on EEXIST): a plain file is kept, anything else skipped. Checked first because Windows
   answers a copy onto a folder with EPERM, not EEXIST (measured here: the EEXIST-only version counted it failed). The
   pointer now counts only plain `.md` files. Tests: a folder named MEMORY.md, and a folder named looks-like.md.
3. **The unparseable profile is now named** in a console.warn ("the switch copied no notes because the profile <file>
   could not be read"). The corrupt-profile test asserts it.

## Review 4 (decided)
One warning and two nits, all taken; each test below is red on 6bd0cfacdd.
1. **A link or junction appearing at memory/claude-notes/ between the check and the mkdir** made the recursive mkdir a
   no-op, and every copy would have written through it. memory/ and memory/claude-notes/ are now lstat-ed again after
   the mkdir and must be real folders (not a link; Windows reports a junction as one); otherwise `blocked`, nothing
   copied. Test: an mkdirSync seam that leaves a junction to a folder outside the agent's; asserts `blocked` and that
   folder stays empty (on 6bd0cfacdd the note landed outside). Residual: a swap between this recheck and a copy is
   still possible; closing that needs per-file handles opened relative to a held folder, which Node does not offer.
2. **"Left out" also covered something else already in a note's place.** Counted separately now (`occupied`) and said
   as "one was not copied because something else is already in its place in memory/claude-notes/".
3. **Each note's time is rechecked right before its copy** against the agent's newest transcript (`ownedClaudeMemory`
   now returns `newest`); one changed since is left out. The "left out" reason now reads "not a plain file, over 1 MB,
   or changed since its own last conversation". Test: an ownedClaudeMemory seam that rewrites one note's time after the
   ownership check; it is not copied, the other is.

## Review 5 (decided)
One warning (a regression from review 4) and one nit, both taken; both tests are red on 1972039955.
1. **A notes folder that could not be made read as "blocked".** The mkdir error is kept now: if nothing is at
   memory/claude-notes/ afterwards, every note counts as failed (`notes: 'failed'`, "one could not be copied into its
   folder") and the error code is logged; `blocked` is only for something that IS there and is not a real folder. The
   comments on `carryClaudeNotes` and in the loop say so. Test: an mkdir seam throwing EACCES.
2. **memory/ itself a junction.** Already `blocked` (its first lstat is not a folder), but the pointer step could still
   point the brief at notes behind the junction. The pointer now never runs when the result is `blocked`. Test: memory/
   a junction to a folder holding claude-notes/MEMORY.md: `blocked`, not pointed, the brief unchanged, and nothing
   written behind the junction.
