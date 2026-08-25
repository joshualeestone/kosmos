---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: projects-list-860
diff_hash: c912c58103dd2276d7962bdc646442e4b8543539f9db99bced3db0ed707e158b
timestamp: 2026-08-25T18:41:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: projects-list-860

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead.

## Iteration 1 (single pass, self)

[STRENGTH] **Root-caused the actual overlap bug rather than papering
over the symptom.** Josh's report ("bleeding over on top of each
other") could have been patched by just capping visible face count or
adding a hard `max-width`, but traced it to the real CSS mechanism: a
grid item's default `min-width: auto` lets its content's natural size
exceed its track. Fixed with `min-width: 0` + `overflow: hidden`,
matching the actual cause rather than a workaround.

[STRENGTH] **Widened the agents column enough to fit its real worst
case (5 faces + count) rather than relying on clipping alone.** Clip-
only would have hidden avatars/count silently on a normal project with
several agents, which is a common case, not an edge case, for this
product.

[BLOCKER] (found and fixed before this proof) **A pinned test asserted
the literal old `grid-template-columns` value**, breaking on the
intentional width change. Updated it to the new values rather than
loosening the assertion, and added a new test pinning the truncation
and overflow-guard rules that weren't previously guarded at all.

[STRENGTH] **Checked the grid tile view's own truncation rule was not
touched by the list-row-only override**, since `.pc-t`'s base
`overflow-wrap: anywhere` rule exists specifically to keep a pasted URL
wrapping rather than sliding under the card edge (a named, pinned
200-char-description fixture). Added an explicit test asserting that
base rule survives, not just that the list-row override exists.

## Verification

- `node --test` / `npm test` (full suite): 0 failures, exit 0.
- `bash tools/browser-checks.sh` (full suite, includes `render-projects`
  which exercises the 200-char description fixture): all page checks
  passed.
- Real live-server Playwright verification: created a project via the
  real API with a long title, a long description, and five agents (the
  exact worst case in Josh's report). Confirmed title and description
  both truncate cleanly with no wrap, and all five faces plus the count
  render with clean separation from the status pill -- no overlap.

### Final Ledger

1 BLOCKER found and fixed before this proof (a pinned test asserting
the literal old column widths). 0 findings remain open.
