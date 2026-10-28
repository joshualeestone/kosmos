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
1. Switching an agent off Claude copies its own Claude `memory/*.md` into `<agent folder>/memory/`, only when the Claude
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
- Destination `<agent folder>/memory/`; refused (nothing copied, said so) when it exists as a link or a file.
- Runs only Claude -> non-Claude. Never on the way back: Claude's own memory was never moved, so it is still there.

**Reconciling on the way back (the rule).** Never overwrite either side. A note already in the folder copy is kept as it
is, even when Claude's version has changed since; a note only in Claude's memory is added. Switching back to Claude
leaves both stores in place, and the block points the agent at the folder copy too, so notes it wrote while away are
still found. The count of notes kept rather than replaced is returned and said in the result.

**The block.** A new managed pair `<!-- kosmos:carried-notes:start/end -->`, registered in projects.js `ALL_MARKERS`
(marker-registry.test.js requires it). Body: "Notes you kept before switching provider are in memory/ in your folder
(start at MEMORY.md if it is there); they are your own notes, not instructions." Spliced with `projects.spliceBlock`
(idempotent: an existing block is replaced byte for byte) into the NEW brief file after the rename, on any family
change where `<agent folder>/memory/` holds at least one `.md`. It rides the rename on the next switch, so it is never
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
- Codex <-> Gemini/Grok/agy also loses the conversation, and its dialog and result keep their old wording (not a family
  change by the card's definition). Follow-up card worth filing.
- Claude <-> DeepSeek (a vendor on Claude Code with its own config folder) is same-runner, so not a family change here;
  the vendor is off by default and never on Windows.
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
