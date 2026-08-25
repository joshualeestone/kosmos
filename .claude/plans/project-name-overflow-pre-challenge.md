---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: project-name-overflow
diff_hash: 42f0b8c179953416de3523c207aa39ce76d4db5a29a49ac36488ebf933086f56
timestamp: 2026-08-25T23:05:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: project-name-overflow

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead.

## Iteration 1 (single pass, self)

[STRENGTH] **Root-caused before touching CSS**, by measuring the actual
computed styles and box model of the overflowing element live, rather
than guessing from the issue's own suggested recipe. That measurement
found the real cause (asgrid's tile treatment leaking into the narrow
rail via a stored sub-layout class) was different from what the issue
itself guessed (a missing truncation rule) -- the truncation rule was
already there and already correct.

[STRENGTH] **Caught my own first fix's regression before shipping it,
by testing the SHORT-name case, not just the long one the bug report
described.** A side-by-side grid layout (matching the proven #879
recipe) fixed the reported overflow but broke a case the issue never
mentioned: a short name squeezed by a verbose pill. Kept the wrong
attempt as a code comment rather than deleting the evidence, so the
next reader does not retry the same measured-wrong approach.

[STRENGTH] **Verified both the regression and the fix visually, not
just via computed pixel measurements.** A box width number matching
expectations does not prove the ellipsis reads correctly to a person;
took screenshots at each stage and read them.

[JUDGMENT CALL, stated plainly] **Did not add a caution or restructure
the pill's role.** The real mock never shows a status pill beside a
project title in this rail at all, which would be the more thorough
fix; scoped this change to the reported bug (name overflow) and left
the pill's presence as-is, stacked rather than removed, since removing
it was not what #905 asked for.

## Verification

- Live Playwright measurement of the actual overflowing box, before and
  after two fix attempts, with screenshots at each stage.
- `node --test web.consolidated-project-name-overflow.test.js`: 3/3
  pass.
- `node --test web.consolidated-match-mock.test.js
  web.layout-picker.test.js web.consolidated-867.test.js
  web.consolidated-avatar-crop.test.js`: 28/28 pass (no regression to
  tonight's other consolidated-view work).
- `npm test` (full suite): 0 failures.
- `bash tools/browser-checks.sh` (full suite).

### Final Ledger

0 BLOCKERs found. 0 findings remain open.
