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
- `#d-task` (line ~22863): keep `taskLine(a)` as the content but hide it for needs_you only:
  `dtask.hidden = !dtask.textContent || (a.state === 'needs_you')`. Scoped to needs_you, NOT to
  every reported state: the Talk "waiting on an answer" box is gated on needs_you, so a reported
  BLOCKED agent's substantive reason has no other surface and must stay; the non-reported
  rate_limited/auth_failed reason stays too. `taskLine` itself is UNCHANGED, so the cards that
  share it are unaffected.
- `#d-why` (line ~22913): add a needs_you clause, keeping the #1841/#1996 behavior for other
  reported states:
  `why.hidden = !why.textContent || (a.state === 'needs_you') || (a.stateReported === true && !reason.includes('\n'))`.
  So needs_you hides single- and multi-line (its message is in the waiting box), a non-needs_you
  reported single-line hides (#1841, d-task carries it), a non-needs_you reported multi-line stays
  (#1996, d-task truncates), and the NON-reported "why we cannot vouch" explanation (#569) is
  untouched - it is the sole surface for that.
- `#d-meta` (line ~22828): build the subtitle as `[Title(bold), Provider, Account?, Model,
  nameDerived-disclosure?]` joined with the existing ' . ' middot. `a` is an agent CARD, so the
  provider and account come from the SHARED derivations the Runs-on box uses, not top-level
  account fields: Provider = `providerOf(a) === 'openai' ? 'OpenAI' : 'Anthropic'` (providerOf
  reads `a.runner`), Account = `acctParenthetical(a)` (reads the nested `a.account`; returns ''
  when nothing identifies it, so the segment degrades out with no dangling separator). Only the
  Title is bolded.

## Decisions / weakest premises
- Separator: kept the file's existing middot ' . ', not a new bullet glyph. Josh wrote a bullet in
  his format sketch, but the middot is the tested app convention (server.test.js pins it and uses
  it to locate the meta-line slice). Noted to Josh as switchable. WEAKEST PREMISE: he may want the
  literal bullet; a one-glyph change if so.
- "Redundant" scoped to NEEDS_YOU specifically (the case in the screenshot), NOT all reported
  states. The Talk "waiting on an answer" box is gated on needs_you, so it only compensates for
  needs_you; hiding the quote for every reported state would swallow a BLOCKED agent's substantive
  reason with no other surface (caught by blind review). Non-needs_you reported states and the
  non-reported rate_limited/auth_failed reason all keep their line. WEAKEST PREMISE: "I only want to
  see Title and Model" read literally would drop more; I judged his complaint is the needs-you
  redundancy. Easy to widen if he wants.
- Account data model: Account uses the shared acctParenthetical(a), which reads the nested
  `a.account` the same way the Runs-on box does. Account resolution is still broken for
  Codex/subscription (#2811); acctParenthetical returns '' when nothing identifies the account, so
  the segment is simply omitted until #2811 lands - it never shows a wrong value. WEAKEST PREMISE:
  none material - the derivation is the app's own, not a new assumption about the object shape.

## Verification
- server.test.js (holds the meta-line, #d-task, and #d-why string-extract tests) updated to the new
  arrangement, each new assertion paired with a control that can fail; all 268 green.
- Full suite via challenge-loop 6.0/6g.
- The detail view cannot be rendered from the build session (needs the running board with a
  needs-you agent + various states); Josh reviews live per his standing rule.

## Out of scope
- Fully removing #d-why's non-reported can't-vouch line (kept - it is a distinct #569 feature, not
  the redundant quote Josh flagged).
