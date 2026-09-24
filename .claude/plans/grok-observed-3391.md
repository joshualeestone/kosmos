# grok-observed-3391 - observed account-status badge for Grok agents

Card: joshualeestone/kosmos #3391 (the observability follow-on slice)

## Problem
The observed account-status badge (#2413/#1921) now covers anthropic + openai + google (gemini,
shipped in #3296). Grok agents still got no observed badge: observed.js had no XAI member, and
/api/accounts returned grok rows un-overlaid. status.js carried an explicit NOTE (grokCompletionAt
"belongs with the launcher slice") deferring exactly this. This is the identical mirror of the
gemini slice, one provider over.

## What it does (mirror of the gemini/#3296 arm, positive-only)
- `engine/observed.js`: add `XAI: 'xai'` to the frozen PROVIDER enum (PROVIDER_VALUES is derived,
  so the guard updates in one place; injectivity holds - 'xai' is space-free and no prefix of
  anthropic/openai/google).
- `engine/status.js`: add `grokCompletionAt(sess)` + `grokLastCompletionAt(agent)` (the completion
  signal is `sess.contextUsedAt`, which groksession.read anchors on signals.json's MTIME - written
  once per completed turn); add a snapshot arm `else if (isNamedOurs && isGrokPane)` recording
  `observed.saw(XAI, pane.name, OK, at)` gated on freshness; export grokLastCompletionAt.
  POSITIVE-ONLY, mirroring codex/gemini; the pre-existing `!isGrokPane` guard on the ANTHROPIC arm
  keeps a grok pane out of a false ANTHROPIC ok.
- `server.js` /api/accounts: an XAI observed-overlay loop mirroring the GOOGLE one; a fresh ok greens
  the grok row, otherwise it renders untouched from its live-check state.

## Backend-only (no web/ change)
Same as gemini: the account-page badge render is provider-generic, so no web/ edit (no styling lane,
no browser-check gates).

## One difference from gemini worth noting
grok's `contextUsedAt` anchors on signals.json's MTIME (WHEN usage was written), not a timestamp
inside the file (gemini uses the newest token-reporting turn's timestamp; codex uses the token_count
event's own timestamp). groksession.read already handles this; grokCompletionAt just reads the field.
The test fixture therefore sets the completion time via `fs.utimesSync` on signals.json.

## Scope boundary (documented, identical to gemini)
Badges NAMED grok accounts only. A default-account grok agent (configDir null) records an XAI
observation that is harmlessly orphaned. The scope-safety does NOT rest on "there is no default
grok row" - grokaccounts.list() DOES surface a default row when the default dir holds a key. It
rests on accountForAgent returning null for a configDir-null agent, so a default agent's
observation has no row to join and is dropped, whether or not a default row is present. The
observation never leaks onto a named row and never crashes; it is forward-compatible. The
default-key door is a follow-on: accountForAgent's dir-less `isOpenaiRow` arm must be generalized
when it lands (specced in the server overlay comment).

## What I rejected / did NOT do
- Negative/red badges: POSITIVE-ONLY (no rejected/red until an observed on-pane grok auth-failure
  signal exists).
- No web/ change; no new session plumbing (groksession already returns contextUsedAt).

## Weakest premise
grok's completion signal is signals.json's mtime, a genuinely weaker anchor than the CONTENT
timestamp codex and gemini read (groksession.read's own header notes this). The two failure
directions are not symmetric, and it matters which the mtime protects:
- STALE (an old completion): the 5-minute freshness gate drops it, and the badge self-heals to
  grey. This direction is closed by the gate.
- FALSE-FRESH (a fresh mtime with no real completed turn): the freshness gate does NOT close this
  one, because the mtime IS fresh. What holds it shut is the premise that grok writes signals.json
  exactly once, at the completion of an authenticated turn. If that premise failed (a spurious
  rewrite bumping the mtime inside the window without a real auth'd completion), the failure would
  be a false GREEN, not grey.

So the load-bearing premise is "one signals.json write per completed authenticated turn", NOT the
freshness gate. Real-world risk is low (the write is positive-only and turn-coupled) and it still
self-heals once the mtime ages past the window, but this is the honest weakest premise: the badge
is only as trustworthy as that once-per-turn write, which is weaker than codex/gemini's anchor.

## Tests (all green)
- `engine/status.grok-observed-3391.test.js` (4): completion-timestamp resolve/null (mtime, ~tolerance);
  a fresh witnessed completion records an XAI ok (never anthropic/openai/google); recording decoupled
  from the scraped state; a stale completion records nothing (self-heals).
- `server.grok-badge-3391.test.js` (5): control; fresh XAI ok greens the row; isolation (both
  directions); grey preserved on a stale ok; SCOPE (default-account grok agent badges nothing, no leak).
- `engine/observed.xai-3391.test.js` (4): XAI recognised; injective across all four providers; space
  in name; unrecognised provider refused.
No regression: observed.test.js 23/23, server.gemini-badge 5/5, server.openai-badge 5/5.
