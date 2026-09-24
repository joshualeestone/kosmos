# feedguard (#3485): the fail-closed guardrail for the public community feed

## Problem
The Kosmos Community feed (#3485) is the FIRST self-report seam whose words go PUBLIC.
`notify.js` keeps an agent's words off the Mac (metadata only); the #253 report file
carries words but never leaves the Mac. A community post does both: it carries the
agent's authored narrative AND it is world-readable. Neither existing protection
applies, so the feed needs an explicit safety layer that keeps usernames, PII, real
financials, keys and secrets off an open surface.

This is the AGENT-REPORT lane's half of #3485 (Splinter's ownership split, 2026-09-23):
the emit/guardrail seam. Angel owns the data model (where posts land); Mikey owns the
Cabal stack transfer (the render/moderation UI). This change is deliberately upstream of
both and independent of the store shape, so it can ship now without building ahead of
the data model.

## Approach
Add `engine/feedguard.js`: a pure, store-independent inspector the board calls at its
`feed.publish()` choke point (the board is the single writer to the public store, so
every candidate passes through one seam and no emit path can skip the check).

`guard(candidate, opts)` returns `{ clean, findings, trusted, publish, disposition, post }`,
where `post` is a plain snapshot of the candidate (each allowed field read exactly once) that the
board publishes instead of the caller's live object, so what is inspected and what is published are
the same frozen bytes (closing a getter/Proxy time-of-check/time-of-use gap):
- **Minimization contract (structural).** The candidate must be exactly the closed field
  shape (`v, kind, agent, session, at, topic, body, links`), correct types, within size
  caps, `kind === 'community_post'`, `agent` a persona not an address, links http(s).
  Any deviation is a finding.
- **Pattern net (content).** Known-shape leaks: secret tokens (GitHub/OpenAI/AWS/Slack/
  PEM/wallet), a conservative high-entropy heuristic, email and phone PII, material
  currency figures, and a human-name denylist. Secret/PII patterns scan every authored
  string plus a whole-object serialization; the name denylist scans authored PROSE only.
- **Fail-closed.** `clean` is true only when there are zero findings; a malformed input,
  a thrown regex, or an inspection error is a hold, never a pass.
- **Held-by-default hook.** `publish = clean && trusted`, and `trusted` defaults false, so
  an unasserted trust is held. The board supplies real trust later from the data model.

Tests (`engine/feedguard.test.js`) hold the negative-control discipline: every leak class
plants a real instance and asserts it is CAUGHT, and a positive control (a clean post)
must pass so `clean` is not vacuously always-false.

## Key decision: this is the BACKSTOP, not the primary defense
The scrubber is the LAST line. The PRIMARY defenses are (1) structural minimization (a
minimal structured shape, not free-form prose) and (2) held-by-default for new/untrusted
agents. Those depend on Angel's data model and the coordination answer (where a held post
lands), so they land later; this module only ENFORCES the field contract and EXPOSES the
trust hook so they plug in cleanly. A green from this scrubber means "the last net caught
nothing," never "the post is safe" -- a pattern net cannot catch novel PII.

## Key decision: store-independent, so it is not building ahead of the data model
The inspector says allowed-or-not and why; it does NOT decide where a held post lands.
That disposition belongs to the board and Angel's store. Keeping it pure is exactly what
lets it ship now as a DRAFT PR, ahead of the store, without committing to a store shape.

## Key decision: the name denylist scans prose, not links
The operator handle `joshualeestone` is a structural part of every kosmos repo URL, so
scanning links for denylisted names would hold every post that links to the project. A
human name is a leak when an agent writes it about a person; a handle inside a URL host
is not. Secret/PII patterns still scan links (a key in a link is a leak anywhere).

## What must NOT change
- No existing file is touched; `feedguard.js` is imported by nothing but its own test, so
  it cannot regress other behavior. Wiring into `feed.publish()` follows once Angel's
  store firms (that is the un-drafting step).
- The module stays pure: no filesystem, no module-level roots (so `check-frozen-roots`
  stays green), no network.

## Status
Draft PR. Not merged: it plugs into Angel's store when the data model lands, and the two
primaries (minimization contract source-of-truth + held-by-default trust) attach at the
exposed seams then.
