# #2833 - View-agent header: drop the redundant reported quote; reformat the subtitle

## Card
#2833 (Josh, 0.6.57 live review, 2026-09-11). His words: "i dont want to show the text that i
highlighted in blue on the view agent screen. its redundant and adds clutter. I only want to see
the Title and Model there.. and what would actually be bad ass if it was like
Title . Provider . Account . Model". The blue-highlighted text (screenshot
~/.claude/card-images/josh-0.6.57-restart-ux/E-view-agent-redundant-text.png) is a needs-you
agent's self-reported message, quoted under the name, which duplicates the "waiting on an answer"
box in the Talk section below.

## What finished looks like
On the view-agent (agent detail) screen, under the name, a REPORTED agent (e.g. needs-you) no
longer shows its self-reported message as a quote - only the badge and the subtitle. The subtitle
reads Title . Provider . Account . Model (middot separators), with the Account segment omitted when
there is no human-readable account identity. A NON-reported reason (rate_limited's "Looks like a
usage limit") still shows, since it is Kosmos's own honest reason with no waiting box to duplicate.

## Approach (web/index.html, paintDetail)
- `#d-task` (line ~22863): keep `taskLine(a)` as the content but hide it for reported states:
  `dtask.hidden = !dtask.textContent || (a.stateReported === true)`. This removes the redundant
  needs-you quote while preserving the rate_limited/auth_failed reason (non-reported), which has
  its own locking test. `taskLine` itself is UNCHANGED, so the cards that share it are unaffected.
- `#d-why` (line ~22913): change the suppression from `stateReported && !multiline` to
  `stateReported`, so a reported MULTI-LINE because does not reappear here once #d-task is gone.
  The NON-reported "why we cannot vouch" explanation (#569) is untouched - it is the sole surface
  for that.
- `#d-meta` (line ~22828): build the subtitle as `[Title(bold), Provider, Account?, Model,
  nameDerived-disclosure?]` joined with the existing ' . ' middot. Provider = `a.providerName ||
  (a.provider === 'openai' ? 'OpenAI' : 'Anthropic / Claude')`. Account =
  `acctChosenName(a) || a.email || (openai keyTail form)`, included only when non-empty
  (graceful degradation, no dangling separator) - deliberately NOT acctPrimaryName, which falls
  back to a dir path.

## Decisions / weakest premises
- Separator: kept the file's existing middot ' . ', not a new bullet glyph. Josh wrote a bullet in
  his format sketch, but the middot is the tested app convention (server.test.js pins it and uses
  it to locate the meta-line slice). Noted to Josh as switchable. WEAKEST PREMISE: he may want the
  literal bullet; a one-glyph change if so.
- "Redundant" scoped to REPORTED states (the needs-you case in the screenshot), NOT all states.
  Hiding #d-task entirely would regress the deliberate rate_limited-reason feature (its own test at
  server.test.js ~8802). WEAKEST PREMISE: "I only want to see Title and Model" read literally would
  also drop the rate_limited reason; I judged his complaint is the needs-you redundancy and kept the
  non-redundant reason. Easy to widen if he wants.
- Account data model: Account depends on account resolution that is broken for Codex/subscription
  (#2811). The segment degrades to omitted when unresolvable, so it shows a wrong value never - at
  worst it is absent until #2811 lands. WEAKEST PREMISE: a.email/a.name population on the detail
  agent object is assumed; if absent, Account simply never shows (safe).

## Verification
- server.test.js (holds the meta-line, #d-task, and #d-why string-extract tests) updated to the new
  arrangement, each new assertion paired with a control that can fail; all 268 green.
- Full suite via challenge-loop 6.0/6g.
- The detail view cannot be rendered from the build session (needs the running board with a
  needs-you agent + various states); Josh reviews live per his standing rule.

## Out of scope
- Fully removing #d-why's non-reported can't-vouch line (kept - it is a distinct #569 feature, not
  the redundant quote Josh flagged).
