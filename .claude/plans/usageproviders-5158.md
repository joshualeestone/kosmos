# usageproviders-5158: Codex, Gemini CLI and Grok usage beside Claude (slice 1)

Card: kosmos#5158. GO: Josh 2026-10-03 11:23 ("we can start on the token usage stuff now and just see how far we get"),
via Splinter. Merges ride after Monday unless a slice is small, fully validated and browser-checked before the 0.7.22 pin.
Constraint (Splinter): the saved usage format does not change without a migration that keeps history.

## What finished looks like
Settings > Token Usage counts Codex, Gemini CLI and Grok agents' tokens beside Claude's: per day, per model and per
agent, in the same four buckets, each counted exactly once. Every saved day that exists today reads exactly as before.
Prices are slice 2 (unpriced models are already listed as unpriced, never guessed).

## History: no format change
- `usage/<day>.v2.json` (Claude per model) and `<day>.folders.v1.json` (Claude per launch folder) are untouched: never
  rewritten, never renamed, never re-derived. Claude prunes old transcripts, so a re-derived past day can only lose.
- The other providers get their own frozen file per day, `usage/<day>.providers.v1.json` = `{ models, folders }`, written
  once a day is past, exactly like the Claude pair. On first open after the update, a past day with no providers file is
  scanned from the providers' session files (which this Mac keeps) and frozen; the Claude files are not involved.
- Read time merges the two: model names never collide across providers (claude-*, gpt-*, gemini-*, grok-*); per-folder
  rows add bucket by bucket.

## Counting each provider exactly once (measured on this Mac, 2026-10-03, numbers only)
| Provider | Files | Unit counted | Buckets | Once-only rule |
|---|---|---|---|---|
| Codex | every account home's `sessions/**/rollout-*.jsonl` (`openaiaccounts.list()` dirs) | change in `total_token_usage` between `token_count` events, per file | input = in - cached; cache_read = cached; cache_creation = cache write (when present); output = out (reasoning is inside it: total = in + out, measured) | a repeated event changes nothing; a total that goes DOWN starts a new run (counted from that event's total) |
| Gemini CLI | every account's storage home (`<dir>/.gemini`, default `~/.gemini`) `tmp/*/chats/session-*.jsonl` | each `gemini` message's `tokens` | input = input - cached + tool; cache_read = cached; output = output + thoughts (total = in + out + thoughts + tool, measured) | message `id`, scan-wide (a message is written twice: measured) |
| Grok | every account home's `sessions/*/*/usage.json` (`grokaccounts.list()` dirs) | each `turns[i]` | input = in - cachedRead - cacheCreation; cache_read; cache_creation; output = out (reasoning inside: total = in + out, measured) | `sessionId` + `turnNumber` |

Day: the row's own timestamp (Codex row `timestamp`, Gemini message `timestamp`, Grok `endedAt`), as UTC, like Claude.
Model: Codex the latest `turn_context` model before the event; Gemini the message's `model`; Grok per `modelUsage` key.
Launch folder (for per-agent): Codex `session_meta.cwd`; Gemini the session's project root; Grok the session's cwd.

## Decisions
- A separate module (`engine/usageproviders.js`) with one reader per provider, so the Claude path is not edited.
- Reasoning/thinking tokens are counted as output (that is how all three providers bill them) rather than a fifth
  bucket; the four-bucket rule stands.
- Antigravity is slice 3 (protobuf, no timestamps). Not counted here, and the page does not say so (a line about a
  provider most people do not use reads as noise); recorded as a gap in the PR instead.
- Weakest premise: Gemini's `input` includes `cached` (true for the Gemini API; every local sample had cached 0, so it is
  unmeasured here). If wrong, Gemini input is undercounted by the cached amount.

## Review 1 (opus): 5 WARNINGs, all taken
- A failed or partial provider scan would have been frozen as the truth: `scanProviders` now returns `complete`, and a
  past day is frozen only from a complete scan (shown either way).
- No test covered the order Claude's history depends on: an end-to-end `dailyUsageByModel` test asserts Claude's two
  files carry no provider rows and the providers file does; its mutant (merge before the Claude freeze) fails it.
- A forked Codex rollout replays the parent's totals: its first total is the baseline, not usage (from Codex's design;
  no fork exists on this fleet to measure).
- Account homes came from list(), which drops signed-out and forgotten accounts: now found by folder name
  (`.codex-*`, `.removed-codex-*`, and the Gemini/Grok equivalents), deduped by real path.
- Every request read every session file: files last written before the first wanted day are skipped (not the Codex
  YYYY/MM/DD folders, which name the day a session started).
- NITs taken: Grok turn with no number keyed by index; Grok cache-write assumption commented; Gemini reply-only id
  comment; server.usage.test.js unsets the provider home variables; Codex `archived_sessions` read. Not taken: Gemini
  slugs with no `.project_root` (none on this fleet) fall to "elsewhere".

## Review 2 (sonnet): 4 WARNINGs, all taken
- A fork can replay several of the parent's totals: every total stamped before the fork's own `session_meta` time is a
  baseline (first-only stays the fallback if a replay restamps); test with two replayed totals; its mutant (first-only)
  fails it.
- A rollout in both `sessions` and `archived_sessions` (a copy, a restored home) counted twice: read once by file name.
- A permanently broken file kept every day unfrozen: a bad file blocks freezing only while fresh (10 minutes), else it is
  skipped and logged.
- The unreadable-file test depended on file permissions (false under root, a no-op on Windows): it uses a half-written
  Grok file instead, fresh and aged.
- NITs taken: stat errors and an unlistable home mark the scan incomplete; the '' folder for a Gemini session with no
  project root is commented; a test name says what it covers.
