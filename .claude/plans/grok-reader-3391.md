# #3391 (slice 1 of the Grok runner): the launched-agent session reader

## Problem
Kosmos runs an agent by launching a terminal CLI and reading what it writes to disk. Grok
Build (xAI's official open-source terminal agent, github.com/xai-org/grok-build) is the fourth
provider; it has NO engine code. This slice adds `groksession.js` -- the reader, the Grok analog
of `codexsession.js`/`geminisession.js` -- returning the same `read()` contract so status.js can
eventually read a launched Grok agent's context ring through one shape. It is the foundation the
Grok status-wiring and launcher slices build on, and (like the Gemini reader) it is fully
unit-testable without a live agent.

## What was measured (from the AUTHORITATIVE open-source serde structs, not docs)
Read from xai-org/grok-build: `xai-grok-shell/src/session/{signals.rs,persistence.rs}`,
`xai-grok-shared/src/session/info.rs`, `xai-grok-config/src/paths.rs`:
- Session dir: `$GROK_HOME/sessions/<url-encoded-cwd>/<session-id>/` (GROK_HOME defaults to
  ~/.grok and IS the storage root, unlike GEMINI_CLI_HOME which is the parent of .gemini).
- `summary.json` = `Summary` struct, **SNAKE_CASE** (no rename_all): `info{id,cwd}`,
  `created_at`/`updated_at`/`last_active_at` (chrono `DateTime<Utc>` -> RFC3339 strings),
  `num_messages`, `current_model_id`, `last_turn_summary`.
- `signals.json` = `SessionSignals` struct, **CAMELCASE** (`#[serde(rename_all="camelCase")]`):
  `contextTokensUsed`, `contextWindowTokens`, `contextWindowUsage`.

⚠️ **The two files use DIFFERENT casing** (summary snake, signals camel) -- verified against the
serde attributes ON the structs. An earlier #3391 spike note recorded signals as snake_case
(`context_tokens_used`); that was the Rust field name, NOT the wire name. A reader built from that
note would read `undefined` on every real signals.json while snake_case fixtures passed green --
the classic hand-rolled-fixture trap, caught by checking the serde attributes before building.

## Approach
1. **`groksession.js`** with `read()`/`forWorkdir()` returning codexsession.read's exact contract
   (plus a documented `model` extra, as geminisession does). BOTH context halves are MEASURED
   (contextTokensUsed + contextWindowTokens), like Codex -- firmer than Gemini/Claude whose window
   is assumed. `cliVersion` is null (summary carries none).
2. **`forWorkdir` keys on `summary.json`'s `info.cwd`**, canonicalized both sides
   (`trust.canonicalOnDisk`, #2417), NOT on re-implementing the CLI's `urlencoding::encode` for the
   dir name. This mirrors codexsession keying on meta.cwd, and handles the long-path case for free
   (when the encoded dir name exceeds the byte cap Grok slugs+hashes the dir but info.cwd still
   holds the real path). Newest session by summary mtime.
3. Defensive throughout: never throws (fs/JSON.parse wrapped), null-when-unknown, a non-string
   `current_model_id` (unexpected ModelId shape) -> null (never `String(obj)` into "[object Object]").
4. Tests from the verified wire shape + edge cases.

## Weakest premise (named for the reviewer)
- **NOT yet verified against a LIVE captured session** (gated on an xAI key, #3391). Field names,
  casing, and RFC3339 are from the authoritative serde structs -- not a guess -- so a live capture
  CONFIRMS rather than corrects. What it still resolves: field POPULATION in practice (is
  last_turn_summary / signals.json always present? -- handled defensively as null) and the exact
  serialization of the `current_model_id` ModelId type (handled: string -> use, else null). The
  launcher/status slice's e2e run is the verification.
- `provider: 'xai'` is a constant (summary carries no model_provider), honest since this reader only
  reads a Grok session dir.
- `contextUsedAt` anchors on signals.json's MTIME (when usage was written), not summary.last_active_at
  (challenge iter 1): Grok has no per-turn usage timestamp inside signals.json the way codex's
  token_count event does, and last_active_at can stay fresh on non-usage activity. signals.json is
  rewritten each usage-changing turn, so its mtime is the closest on-disk "usage measured at" signal.
  It is still weaker than a content timestamp, so the launcher slice's liveness badge must GATE on it,
  not assume "green off it = a real recent turn".

## Not in this slice
⚠️ For the status-wiring slice: Grok's `messages` is `number | null` (null when num_messages is
absent metadata -- the null-when-unknown rule), whereas codex/gemini's `messages` is always a
`number` (a computed count). A consumer must handle the null for Grok.

status.js `readGrokContext` wiring + snapshot arm (the status-ring consumer, mirrors the Gemini
slice-2 wiring; needs a `runner:'grok'` recognition, and create.plistFor already round-trips any
non-claude runner as of the gemini slice); the create.js launcher (provider validation + accounts +
agent-supervisor.sh spawn -- reuses the Gemini launcher machinery, so it lands AFTER that); the
runners.js manifest (grok install: `curl -fsSL https://x.ai/cli/install.sh | bash`, or a pinned
tarball); observed.js provider + classify markers.
