# #3296 (slice 1 of the Gemini runner): the launched-agent session reader

## Problem
Kosmos runs an agent by launching a terminal CLI, keeping it alive, and READING what
that CLI wrote to disk -- it never calls an API. Claude and Codex each have a reader
(`status.readContext` for Claude's `.jsonl`, `codexsession.read` for Codex's rollout).
Gemini has a DISCOVERY reader (`geminisession.projects`/`agentFiles`, #2243/#2410) but
NO session reader, so a launched Gemini agent's board row would read "Not yet read"
forever -- the exact #2257 symptom Codex had before `codexsession.read`.

This slice adds that reader. It is the foundation the create.js launcher (spawn) and the
status.js wiring (context ring + liveness overlay) build on, and it is fully testable
without a live agent, so it lands first on its own.

## What was measured (not taken from docs)
Captured live on 2026-09-21 from Gemini CLI 0.61.0-preview.0 with Josh's key (all on
kosmos#3296, 3 capture comments):
- Session transcript: `<.gemini-home>/tmp/<slug>/chats/session-<ts>-<id>.jsonl`, an
  INCREMENTAL JSONL log -- a `session_meta` header line, then a mix of `{"$set":{...}}`
  snapshot/bookkeeping ops and bare message objects. Messages arrive in BOTH
  `$set.messages` arrays and bare lines.
- `<slug>` is the projects.json VALUE for the launch cwd (verified: projects.json maps
  the abs cwd -> the same slug the tmp/<slug>/ dir uses).
- A `gemini` message carries `tokens {input,output,cached,thoughts,tool,total}`;
  `tokens.input` is the last turn's prompt = window occupancy (the analog of codex's
  `last_token_usage.input_tokens`).
- `content` is EITHER a bare string OR a `[{text}]` array.
- `GEMINI_CLI_HOME` is the ROOT; the CLI creates `.gemini` BELOW it (bundled
  configuration.md + confirmed by the capture writing to `<GEMINI_CLI_HOME>/.gemini/`).

## Approach
1. **Settle the HOME() off-by-a-segment finding.** `geminisession.HOME()` returned
   `GEMINI_CLI_HOME` verbatim, but the real CLI writes to `<GEMINI_CLI_HOME>/.gemini/`.
   Fix: append `.gemini` to the `GEMINI_CLI_HOME` branch so HOME() ALWAYS resolves to
   the `.gemini` storage dir. The default (`homedir/.gemini`) and our own
   `AGENT_WORKFORCE_GEMINI_HOME` (verbatim) already point there, so only the middle
   branch changes. No test exercised it (all use `AGENT_WORKFORCE_GEMINI_HOME`), so it
   shipped silently wrong -- a bugfix, not a relied-on behaviour. The discovery path
   (`projects`/`agentFiles`) rides HOME() too, so this also corrects discovery for an
   operator who relocates their Gemini home via `GEMINI_CLI_HOME`.
2. **Add `forWorkdir(dir, home)`** -- resolve `dir` -> slug via projects.json
   (canonicalizing BOTH sides with `trust.canonicalOnDisk`, the #2417 discipline), then
   the newest `session-*.jsonl` under `tmp/<slug>/chats/`. Newest by MTIME (a Gemini
   filename is minute-precision then the sessionId prefix, NOT chronological within a
   minute), name as tiebreak. Returns `{file, slug}` or null; never throws.
3. **Add `read(dir, home)`** returning `codexsession.read`'s EXACT contract
   (`{found, file, sessionId, provider, cliVersion, contextWindow, contextUsed,
   contextUsedAt, messages, lastAt, lastAgentMessage}`) so status.js reads all three
   providers through one shape. De-dupes messages by id (they arrive in both `$set` and
   bare lines). `contextWindow`/`cliVersion` are structurally null for Gemini (the
   transcript does not state them -- the honest Claude case); `contextUsed` = the last
   gemini turn's `tokens.input`. One EXTRA field, `model`, since Gemini names it
   per-message and codex/Claude consumers ignore extra fields.
4. **Tests** built from the real captured shape + edge cases (dedup, canonical twin,
   empty chats, no-turn, mtime ordering, HOME resolution, explicit-home).
5. **Correct two stale `<GEMINI_CLI_HOME>/projects.json` comments** in discover.js and
   discover.gemini.test.js to reflect the fixed semantics.

## Weakest premise (named for the reviewer)
- `provider: 'gemini'` is a constant here rather than read from the transcript (Gemini's
  header carries no `model_provider` the way codex's does). It is honest -- this reader
  only ever reads a Gemini session dir -- but if a future multi-backend Gemini variant
  emerges, revisit.
- (RESOLVED in challenge iter 1) Message ordering originally used first-seen (append-log)
  order to pick "last gemini". That premise is now removed: `read()` selects the newest
  gemini turn by parsed TIMESTAMP (insertion index as tiebreak), so an out-of-order
  `$set.messages` snapshot still yields the genuinely newest turn. Tested directly.
- `messages` is a provider-local activity count and NOT comparable to codex's `messages`
  (codex counts raw response_items incl tool calls; this counts de-duped user/gemini
  conversation entries incl the synthetic session_context seed). Documented at the return
  site so a future cross-provider consumer does not read them as the same unit.

## Not in this slice (subsequent PRs, same card)
create.js launcher arm (spawn with `--skip-trust --approval-mode yolo --model <id>`,
pre-seeded api-key auth so the first-run auth menu never renders the key into a scraped
pane, per-account `GEMINI_CLI_HOME`); status.js `readGeminiSession` wiring into the
context ring + liveness overlay + snapshot; runners.js MANIFEST (pinned tarball+checksum).
