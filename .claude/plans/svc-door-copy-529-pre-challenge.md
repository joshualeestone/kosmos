---
pre_challenge: true
method: challenge-loop
branch: svc-door-copy-529
diff_hash: 44fb52abb3068f5c0da8eba15ac6cd7989e70a7742537b0a9e9284b0f7ad1eb2
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T19:09:05Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (all blind, independent, alternating Sonnet / Opus reviewer models)
**Converged:** Yes (iteration 6, Opus, produced zero new BLOCKER/WARNING/CONVENTION)
**Fixed:** all findings from iters 1-5 | **Deferred:** 0 | **Asked (awaiting user):** 0

Change under review: kosmos#529 copy residual. The Connections tab's 18 token-service pills
(Discord, Brave Search, Exa, Tavily, Serper, GitLab, Fly.io, DigitalOcean, Hetzner, Netlify,
Render, Notion, Linear, Airtable, Neon, Postmark, SendGrid, Better Stack) had no capability
one-liner, unlike the core four (GitHub/Vercel/Cloudflare/Gmail); they rendered as bare
service names. Added a one-liner for each in SVC_DOORS, matching the core four's shape and
scoped honestly against each service's tokendoors.js hint. Discharged three "placeholder until
Mona Lisa says it" render-comment flags (the door copy was reviewed and blessed). Pinned the
new sentences in web.svc-doors.test.js. Copy-only web/ change (Browser-check trailer).

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
- [WARNING] Linear one-liner said "the projects you allow" but LINEAR_API_KEY is workspace-wide
  (no hint) -> FIXED: "across your workspace" (honest breadth).
- [WARNING] Neon one-liner said "the data you give them access to" but NEON_API_KEY is
  account-wide (no hint) -> FIXED: "the databases in your Neon account".
- [CONVENTION] Netlify dropped Vercel's "your"; DigitalOcean/Hetzner and Postmark/SendGrid were
  near word-for-word -> FIXED: restored possessive, differentiated the pairs.
- [WARNING] the test pin covered only 8 of 18 -> FIXED: pins all 18.
  Audited all 18 against tokendoors.js hints: only Linear and Neon claimed scoping their token
  lacked; the rest have a real hint (Notion/Airtable/Hetzner/GitLab) or make no scoping claim.

#### Iteration 2 (Opus)
- [WARNING] the test pin asserted key presence only, so a blanked line would pass -> FIXED:
  asserts a non-empty sentence.
- [WARNING] the SVC_DOORS comment implied "you allow/share" is generally honest -> FIXED:
  narrowed to hint-carrying services only, so a future editor cannot add false reassurance.

#### Iteration 3 (Sonnet)
- [WARNING] Notion said "read and write" but its hint says "may read" (read-only), a
  same-screen contradiction -> FIXED: "read the pages you share with them".
- [WARNING] Airtable named the unit "tables" but Airtable scopes by base -> FIXED: "the bases
  you share".
- [WARNING] the non-empty guard rejected only exactly-empty; whitespace-only passed -> FIXED:
  a regex requiring real content (control-verified it rejects '' and ' ').

#### Iteration 4 (Opus)
- [WARNING] Discord's "the channels you allow" invoked the hint-gated allow/share framing, but
  its hint is navigational (a token location, not a scoping step) -> FIXED (first attempt):
  "the channels you add it to" (the actual mechanism).

#### Iteration 5 (Sonnet)
- [WARNING] "the channels you add it to" still implies a restriction the navigational hint below
  it cannot corroborate -> FIXED (terminal): dropped the scope claim, "post updates and read
  messages for you", matching the broad no-scope pattern of the other navigational/no-hint
  services. The SVC_DOORS comment was left unchanged to avoid a moving-target loop.

#### Iteration 6 (Opus)
- Zero new BLOCKER/WARNING/CONVENTION. All 18 one-liners cross-checked against their hints
  (scope, capability, unit) are honest; XSS-safe (esc on all three render paths); test pin
  sound (all 18, non-empty, scoped to SVC_DOORS); no em dashes; no behavioral change.
  CONVERGED.

### Verification
- Full validation suite (validation-log.sh) PASSED; the recorded hash matches this proof's
  diff_hash (44fb52ab). The suite is 5264/5264. (The code was unchanged after convergence;
  the plan and proof docs were added last and re-validated.)
- web.svc-doors.test.js pins all 18 pill sentences (present and non-empty, scoped to the
  SVC_DOORS object, control-proven it fails on origin/main where the 18 were absent).
- Copy-only web/ change: the render path (SVC_DOORS[name] -> esc -> door) is unchanged and
  already exercised for the core four; a Browser-check trailer records this, accepted by the
  #1720 gate.
