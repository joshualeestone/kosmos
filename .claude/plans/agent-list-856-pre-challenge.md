---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: agent-list-856
diff_hash: 513690eb92412572f272c843f5adcdd0321f4636f748d46b22fa48e900b394ce
timestamp: 2026-08-25T17:47:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: agent-list-856

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead. This
one got extra care rather than a rushed pass -- it was deliberately
deferred earlier in the session specifically to avoid repeating the
#862 cut-blocking mistake (an unscoped CSS rule that regressed a pinned
check), since a five-to-seven column grid restructuring interacting
with the consolidated rail's compact stacking is exactly that class of
risk.

## Iteration 1 (single pass, self)

[STRENGTH] **Real live-server visual verification, not just unit tests.**
Built a fixture using `test-support/fleet.js`'s `agent()`/`line()` (the
same builder `render-tasks.js` uses for its own live-server check),
never a hand-typed pane line -- fixture-discipline's rule for committed
tests, and simply the right tool even for a throwaway script since
`line()` fills every `PANE_COLUMNS` field and throws if the engine
grows one. Screenshotted both the tab-view list and the consolidated
rail against a real spawned server. Confirmed: seven columns render in
the right order with no overlap in tab view; name/title/status stack in
three rows with no overlap in the rail, task/model/percentage correctly
hidden.

[BLOCKER] (found and fixed before this proof) **First fixture attempt
used the wrong list-view toggle selector** (`[data-view="list"]`, which
does not exist) and silently no-opped, so the first screenshot was
still the grid view. Caught by actually looking at the screenshot
rather than trusting the script "ran without error" -- found the real
selector (`.vt[data-layout="list"]`) by grepping the markup.

[BLOCKER] (found and fixed before this proof) **First test draft for
the seven-column order test compared indices across `lrow()`'s TWO
templates** (an early-return off-branch, then the running branch),
which would have silently passed or failed for the wrong reason. Scoped
the comparison to the running branch only, anchored on
`const m = cardStOf(a);`.

[BLOCKER] (found and fixed before this proof) **The off-row
slot-existence test only checked 5 of the new 7 slots**, silently never
validating `.ltitle`/`.lmodel` existed or behaved correctly for a
stopped agent. Added both to the loop plus explicit content/emptiness
assertions.

[STRENGTH] **Consolidated rail given a title row rather than left with
the old two-row stack**, matching an existing but previously-unwired
comment in that section of CSS -- checked the comment predates this
branch (git blame) before treating it as intent to fulfil rather than
a stale note to ignore.

## Verification

- `node --test` / `npm test` (full suite): 0 failures, exit 0.
- `bash tools/browser-checks.sh` (full suite, this exact commit,
  2674496, frozen by the harness's own worktree-freeze guard against a
  concurrent branch move): all page checks passed.
- Real Playwright verification against a live spawned server, described
  above -- both tab-view list and consolidated rail confirmed visually,
  not just by markup/CSS inspection.

### Final Ledger

3 BLOCKERs found and fixed before this proof (wrong selector silently
no-opping a screenshot; a test comparing across two unrelated function
branches; a test silently checking 5 of 7 required slots). 0 findings
remain open.
