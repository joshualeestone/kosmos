# gemini-observed-3296 - observed account-status badge for Gemini agents

Card: joshualeestone/kosmos #3296 (the observability follow-on slice)

## Problem
The observed account-status badge (#2413/#1921) - the last-observed real-call outcome that
positively greens a working sign-in checkLive can only leave grey - covered anthropic + openai
only. Gemini agents got NO observed badge: `observed.js` PROVIDER was `{ANTHROPIC, OPENAI}`, and
`/api/accounts` returned gemini rows un-overlaid (server.js comment: "they get NO observed-overlay
badge here (the observability follow-on, OUT of this slice)"). status.js carried explicit NOTEs
(geminiCompletionAt "belongs with the launcher slice") deferring exactly this. Now that the gemini
account layer exists on origin/main (geminiaccounts.listLive + /api/accounts gemini rows + live
checks, #3509), this is buildable and NOT gated on Josh's Google oauth credential (it works off any
credentialed gemini account + a witnessed session completion).

## What it does (mirror of the codex/OpenAI #2413 arm, positive-only)
- `engine/observed.js`: add `GOOGLE: 'google'` to the frozen PROVIDER enum (one line; PROVIDER_VALUES
  is derived, so the guard updates in one place; injectivity holds - google is space-free and no
  prefix of anthropic/openai/xai).
- `engine/status.js`: add `geminiCompletionAt(sess)` + `geminiLastCompletionAt(agent)` (sibling of
  codexCompletionAt; the completion signal is `sess.contextUsedAt`, already returned by
  geminisession.read); add a snapshot observation arm `else if (isNamedOurs && isGeminiPane)` that
  records `observed.saw(GOOGLE, pane.name, OK, at)` gated on freshness; export
  geminiLastCompletionAt. POSITIVE-ONLY: only a witnessed completion greens; a dead-credential
  reconnect scrapes WORKING but never completes a turn, so it never false-greens. The `!isGeminiPane`
  guard on the ANTHROPIC arm keeps a gemini pane out of a false ANTHROPIC ok.
- `server.js` /api/accounts: add a GOOGLE observed-overlay loop mirroring the OpenAI one - a fresh
  observed ok greens the gemini row (badge 'working'); otherwise the row is returned untouched and
  renders from its live-check `connection.state`. The `if (o.provider !== GOOGLE) continue;` filter
  is the join-isolation guard.

## Backend-only (no web/ change)
The account-page badge render is provider-generic (`web/index.html`: `const badge = a.connection &&
a.connection.badge` then a switch on the string; provider name comes from the server row). A gemini
row carrying `connection.badge==='working'` renders the green pill with no HTML change. Confirmed by
scoping - so this does NOT touch the styling lane or the browser-check gates.

## What I rejected / did NOT do
- GROK (xai): the identical slice one provider over (#3391). Left as a follow-on so this PR is one
  provider, reviewable, and mirrors how #2413 shipped codex separately. server.js leaves grokRows
  un-overlaid and observed.js has no XAI member yet.
- Negative/red badges for gemini: POSITIVE-ONLY (matching the codex arm) - no rejected/red until an
  observed on-pane gemini auth-failure signal exists, so the overlay can never produce a false "not
  connected".
- No new session plumbing: gemini already returns contextUsedAt; the completion helper just reads it.

## Weakest premise
The completion signal is `sess.contextUsedAt` (the newest token-reporting gemini turn). If a future
gemini-cli stopped emitting per-turn tokens, the badge would stay grey (the safe direction - no false
green), never wrong. The freshness window self-heals a stale sign-in. Verified against a real
gemini session shape (geminisession.runner-3296.test.js fixtures) in the new tests.

## Tests (all green)
- `engine/status.gemini-observed-3296.test.js` (4): completion-timestamp resolve/null; a fresh
  witnessed completion records a GOOGLE ok (never anthropic/openai); recording decoupled from the
  scraped state; a stale completion records nothing (self-heals).
- `server.gemini-badge-3296.test.js` (4): control (connected, no badge); a fresh GOOGLE ok greens
  the row; isolation (GOOGLE ok never touches claude, anthropic ok never greens gemini); grey
  preserved on a stale ok.
- `engine/observed.google-3296.test.js` (4): GOOGLE recognised; injective across providers; space
  in name; unrecognised provider still refused.
Existing overlays unaffected: observed.test.js 23/23, status.codex-observed 5/5,
server.openai-badge 5/5, server.badge-observed-1921 14/14.
