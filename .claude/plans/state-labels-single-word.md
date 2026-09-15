# Plan: single-word board state labels (Josh 2026-09-15)

## Source
Josh in #chaoskosmos-design, 2026-09-15 09:46 CDT, @-addressed to me:
"lets swap 'Needs you' to 'Issue' and 'Has a question' to 'Question', then the
buttons wont wrap to two lines and it will keep a single word indicator for all states"

## What finished looks like
- The board card state pill reads "Issue" (was "Needs you") and "Question" (was
  "Has a question"), so every state indicator is one word and none wraps to two lines.
- Every VISIBLE surface that shows that same state reads consistently: the summary
  count tiles, the list-row indicator, the projects-list rollup pill, the project
  member row.
- The #2808 de-alarm behavior is unchanged: the calm class-2 "Question" and the red
  class-1 "Issue" stay DISTINCT (the two labels differ, which the de-alarm contrast
  relies on).
- The needs_you STATE KEY and all engine logic are untouched (engine uses the
  snake_case key, never the display string).
- Node suite green, all affected browser-checks green (including both CI-allowlisted).

## Changed surfaces (all STATE_COPY-driven, the state pill/label)
1. STATE_COPY (web/index.html:13824/13830): needs_you 'Issue', question 'Question'.
2. Summary count tiles st-attn (13304) and st-pjattn (11040).
3. List-row warning aria-label (LROW_WARN, 15035).
4. Projects-list rollup pill (pjPillOf, 37174).
5. Project member row status: flows through stateCopyOf().label automatically.

## Deliberately LEFT unchanged (scoping, not oversight)
- NOTE on the shared warning mark (#2577): `ONODE_WARN` (the org/map node's corner
  triangle) is DERIVED from `LROW_WARN` by a class swap, so my LROW_WARN aria edit
  ("Needs you" -> "Issue") correctly propagated the badge's aria to "Issue" as well.
  That is intended #2577 behavior ("one mark means the same thing on a tile, a pill,
  a row and a node"), not an accidental change: the shared MARK stays consistent. What
  is deferred is only the node's own TEXT (the link aria and the `.pjoc` caption below).
- The agent org-chart node aria + the projects-map node caption/aria (pjMapNode,
  the `.pjoc` span and its "Open <name>, needs you" aria): hardcoded separately from
  STATE_COPY, in the projects-MAP view Josh did not reference. NOTE, honestly: the
  `.pjoc` line is a VISIBLE caption (no white-space:nowrap in a min-width:70px node),
  so it could itself wrap, which is the same symptom Josh flagged for the pills, so
  the no-wrap rationale is not the whole story. It is deferred anyway because: (1)
  Josh's instruction referenced the board card state pills ("your design above", the
  wrapping buttons), not the map view; (2) the map caption uses in-sentence lowercase
  grammar ("needs you / N agents / idle") where a single-word "issue" is a separate
  design call; and (3) Josh is ACTIVELY reworking the projects / consolidated / map
  views for 6.68 (his 2026-09-15 message), so changing the map node captions now
  collides with that imminent rework. A fast-follow, or subsumed by the 6.68 map work.
  render-projects-map and render-org-rings therefore stay green with no change here.
- The nav-section "(needs you)" visually-hidden hints (detail/settings nav): these
  mean "this section needs your attention", a DIFFERENT concept from the agent state.
- Engine-source comments that mention "Needs you" (PigeonPete confirmed all ~28 are
  comments, non-functional; chasing them is churn).

If Josh wants the org-chart/map descriptive text single-worded too, that is a fast
follow-up in a separate change.

## Coordination
- Angel owns the #2808 class-2 plumbing; she sent the subsystem map and confirmed
  the de-alarm logic is label-independent. I told her I am driving the whole change
  (both halves) so she does not also edit :13830.
- PigeonPete owns the #2129 class-1 logic; I gave him a heads-up before editing the
  class-1 label. He confirmed his logic keys on the state key, not the string, and
  flagged the real blast radius (the browser-check trap) which I handled.

## Tests updated (assertions that read the real STATE_COPY)
- server.test.js: pjPillOf label (6931), detail badge innerHTML (8910), the #2711
  pjMember stub STATE_COPY (7429, label inert but mirrored for accuracy).
- web.needsyou-dealarm-2808.test.js: class-2 label (58) 'Question', class-1 (65) 'Issue'.
- web.project-status-1303e.test.js: pillOf label (38) 'Issue'.
- render-needsyou-dealarm-2808.js: anchored /^question$/i and /^issue$/i (113/117) + log.
- render-project-needsyou-2699.js: /^issue$/i (101).
- docs/browser-checks/README.md: the two affected rows.

## Verification
- Full node suite: 7566 pass, 0 fail, 138 skipped.
- Browser-checks headless: render-needsyou-dealarm-2808, render-project-needsyou-2699,
  render-projects-map, render-trust-restart-0644, render-talk all pass.
- No display "Needs you"/"Has a question" string left outside comments.

## Next
challenge-loop -> PR (Addresses the design instruction; @Angel + @PigeonPete FYI) ->
CI green -> merge on green (Kosmos beta, squash, no --admin).
