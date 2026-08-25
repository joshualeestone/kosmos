---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: detail-width
diff_hash: 0af2e469b7f25bdad51012029ea1201ca9b54ed5350c8308c6b098d7a1fcc4bc
timestamp: 2026-08-25T15:40:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: detail-width

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night (traced by Splinter to a
missing skills directory at session start). Self-reviewed instead, and
this branch is the one where self-review caught a genuine, real defect
mid-verification rather than at the end -- recorded below in full,
because the miss and the recovery are both worth keeping.

## Iteration 1 (single pass, self)

[STRENGTH] **The `#panel-settings`/`#panel-detail` selectors were
combined, not duplicated.** Both pages now share one rule at each of the
three specificity tiers (base, 60rem, 56rem restatement) the existing
Settings-only version needed, rather than a copy-pasted second block that
could drift from the first the next time either page's width changes.

[STRENGTH] **`.dhead` was not left uncapped.** It would have been an easy
miss: `.dbody` is what the request named, and `.dhead` is a sibling, not
a child, so capping only `.dbody` would produce a header that spans the
full window while the grid beneath it centres to 746px -- visually
disagreeing with itself. Found by reading the actual DOM structure
(`.detail` > `.back`, `.dhead`, `.dbody`) rather than assuming the named
element was the only one that mattered.

[BLOCKER] (found and fixed before this proof, the significant one)
**A browser-checks run I trusted as confirmation was stale.** I started
`bash tools/browser-checks.sh render-agent-nav` in the background right
after finishing the `#panel-detail` width fix, then, WHILE it was still
running, wrote the second fix (the tab-view header merge). When that
background run finished and I looked at its `render-projects` screenshot
for a single-project view, it showed the OLD, un-merged layout: title
and description above the grid, "Conversation" label still visible. My
first read of this was that the header-merge fix had a real bug.
Before accepting that, I set up a direct, minimal reproduction:
started the actual server from this worktree with a fresh sandbox
(bypassing the cached/background-run sandbox entirely), created a project
through the live API, and used Playwright to open it and inspect the DOM
and computed styles directly. That reproduction showed the fix working
correctly (`head.parentElement === mid`, the "Conversation" label
computing to `display: none`), at both a normal width and a narrow one.
The discrepancy was explained by timing: the background browser-check's
subprocess started reading `web/index.html` before the header-merge edit
was saved to disk, so its screenshot was of a state that no longer
existed by the time I looked at it -- not a defect in the shipped code.
Re-ran the full browser-checks suite fresh, after both edits were saved,
before writing this proof: all page checks passed.

**Why this is a BLOCKER and not a WARNING**: I nearly reported a working
fix as broken, and nearly went looking for a bug that was not there,
because I trusted a screenshot's timestamp implicitly rather than asking
whether it could have been taken against stale source. The fix for the
class of mistake (a check run in the background while the thing it is
checking keeps changing) is to always re-run verification fresh,
immediately before writing the proof, not to trust whatever completed
last -- which is what the second, fresh `bash tools/browser-checks.sh`
run (this time run to completion before any further edits) exists to
guarantee.

[WARNING] (checked, not assumed) **The `placeProjectHead` test
(`web.layout-picker.test.js`, "piece nine") explicitly pinned the OLD
"move it back for tabs" behaviour** I deliberately removed. Running the
suite without updating it would have either failed loudly (good) or,
worse, silently passed if the test happened to only assert the
consolidated-forward direction and never re-checked the tabs-backward
one closely enough. Read the test in full before touching the
implementation, confirmed exactly which assertions pinned the retired
behaviour, and rewrote them to assert the new invariant (never un-merges,
idempotent across repeated calls, including simulating a third call to
represent a later tab-view boot) rather than deleting the coverage.

[WARNING] (checked, not assumed) **Title size for the tab-view merge**
needed a real number, not a guess. The consolidated rule's own comment
implies 1rem; hand-checking CSS specificity (an ID-scoped rule elsewhere,
`#pj-one-view .dname`, beats the class-only 1rem attempt regardless of
declaration order) shows the ACTUAL rendered consolidated title size is
1.25rem. Matched the tab-view rule to 1.25rem -- what Josh actually sees
today in consolidated, not what a piece of dead CSS was written to
produce.

## Verification

- `node --test web.settings-width.test.js web.layout-picker.test.js`:
  17/17 pass, post-rebase.
- `npm test` (full suite): 0 failures, exit 0.
- `bash tools/browser-checks.sh` (full suite, run fresh after all edits
  were saved, not the stale mid-flight run described above): all page
  checks passed.
- Direct Playwright reproduction against a live server from this
  worktree (not the unit tests, not a cached browser-check sandbox):
  confirmed the DOM merge and the CSS hiding the "Conversation" label at
  1280px and 700px viewports, with screenshots reviewed by hand.

### Final Ledger

1 BLOCKER found and fixed before this proof (trusted a stale background
verification run instead of re-checking against current source). 2
WARNINGs investigated and resolved (a test pinning retired behaviour,
rewritten rather than left red or silently weakened; a font-size decided
by measuring actual specificity rather than guessed from a comment). 0
findings remain open.
