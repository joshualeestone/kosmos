# Grok (xAI) status-ring wiring (#3391 / #3296 sibling)

## Problem
`engine/groksession.js` merged (#3395) but nothing consumes it. A launched Grok
Build agent does not write a Claude `.jsonl`, so `status.readContext` returns
NO_TRANSCRIPT and the board's memory ring reads "Not yet read" forever -- the
#2257 symptom, fourth provider. This slice wires the Grok session into the status
board's context ring, mirroring the Gemini slice (#3296 slice 2, PR #3394) exactly.

Engine-only, non-fenced, independent of the launcher (the Gemini ring landed
before the Gemini launcher for the same reason). All dependencies are in main:
groksession.read (#3395), the status.js sibling machinery (#3394).

## Changes
- `engine/status.js`
  - readJob runner-normalize (line ~947): recognize `'grok'`.
  - New `readGrokSession(agentName)` + `readGrokContext(agentName, sess)`, exact
    siblings of readGeminiSession/readGeminiContext. Grok DIFFERS from Gemini in one
    way: it STATES a real window (signals.json contextWindowTokens), so the
    measured-with-percentage ring path is genuinely reachable (Gemini's could only
    ever reach no-ceiling). The UNREADABLE branch is kept for sibling-symmetry but is
    unreachable today (groksession never emits UNREADABLE -- documented in-line).
  - Snapshot arm: `isGrokPane` (TAG-ONLY, grok fronts as node) + `grokSess`; the
    ANTHROPIC observation-arm exclusion gains `&& !isGrokPane`; the context ring gains
    the `isGrokPane ? readGrokContext(...)` arm. No observation arm yet (the XAI-provider
    account badge is the launcher slice).
  - Card runner field (line ~6616) + exports: `readGrokContext`.
- `engine/create.js`
  - `defaultAgentGrokHome()` (sibling of defaultAgentGeminiHome; GROK_HOME is the
    storage ROOT so no `.gemini`-style suffix) + export.
  - `plistFor` `isNonClaudeRunner` gains `|| runner === 'grok'`. WITHOUT this a grok
    plist never writes the runner slot and reads back as 'claude', so readGrokSession's
    runner gate would fail and the whole ring is dead for grok. The handoff's assumption
    that "plistFor already round-trips grok" was WRONG -- measured, caught here.
- Golden card #2519 family count 13 -> 15 (readGrokContext adds the UNREADABLE +
  NO_TRANSCRIPT NONE_BASE-family branches, same two the gemini arm added). Updated the
  assertion + every prose copy in the same commit: the two big inventory comments in the
  test file, the contextShapes comment, and docs/browser-checks/render-talk.js.
- New test `engine/status.grok-ring-3391.test.js` (8 tests), mirrors the gemini-ring
  test + grok-specific measured-with-ceiling cases (injection + end-to-end, plus an
  end-to-end no-ceiling case added in the challenge-loop pass).

## Verification
- `engine/status.grok-ring-3391.test.js` 7/7.
- render-talk-goldencard-2519.test.js 35/35 (family===15 confirmed).
- Directly-affected suites (create, status, all provider rings, groksession,
  geminisession, golden card): 429/429.
- Full JS suite via tools/run-tests.sh.
- frozen-roots clean.

## Decided / weakest premise
- **Weakest premise:** the readers are UNVERIFIED against a LIVE grok agent (no xAI
  key, no launcher yet). Names/casing/RFC3339 come from the authoritative serde
  structs, so a live capture confirms rather than corrects; the reader (#3395) already
  caught a camelCase fixture-trap this way. This is forward-compat scaffolding; the
  launcher slice's e2e run is the real verification.
- Kept the UNREADABLE branch though groksession never emits it -- structural symmetry
  with the three sibling arms + the golden-card count both want it, and it fires for
  free if a future groksession gains that path. Documented as unreachable-today.
- `defaultAgentGrokHome` deliberately does NOT honour the operator's GROK_HOME, exactly
  as the codex/gemini siblings ignore CODEX_HOME/GEMINI_CLI_HOME -- a default-account
  agent is pinned to the standard home; a per-account home rides job.configDir (launcher).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
