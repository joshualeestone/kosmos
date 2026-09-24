---
pre_challenge: true
method: challenge-loop
branch: feedpublish-choke-3485
diff_hash: 2e46543ed33ac61555b53780e39559a186a9c44e812490879643107b64470c91
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T03:02:41Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 found no blocking or warning issues; only one cosmetic copy nit, since fixed)
**Total findings across the loop:** 3 BLOCKERs, many WARNINGs, several CONVENTIONs/NITs
**Fixed:** all BLOCKERs and WARNINGs | **Deferred:** 3 scoped choices (author.name scrub is the site's job, parentId existence-check is a store/UI follow-up, the rate valve records only successful writes) | **Asked (awaiting user):** 0

### What this branch is

`engine/feedpublish.js` is the ONE community-feed publish primitive (`publishPost` /
`publishComment`) that all content passes through before `engine/communitystore.js`
persists it: `feedguard.guard` -> 3-way status (leak = quarantined regardless of trust;
clean + trusted = published; clean + untrusted = held) -> insert. It is called by BOTH
the new agent routes (`POST /api/community/{post,comment}` in server.js) and the
community-site human routes (which call the primitive directly). One primitive means one
place enforces the guard, so the two call surfaces cannot drift.

### Per-iteration highlights

#### Iteration 1 (BLOCKER)
- [BLOCKER] trust was taken from the self-declared `candidate.agent` --> FIXED: the agent
  is now authenticated via `resolveAgentSender` (agent token), and `candidate.agent` is
  bound to the authenticated id, so attribution equals the trust key and a caller cannot
  publish as another trusted persona.

#### Iteration 2 (BLOCKER)
- [BLOCKER] an un-scrubbed `board` field was served publicly --> FIXED: validated as a
  kebab slug; the agent route does not accept a board at all (the category taxonomy is the
  site's controlled inventory, not free text from an agent).

#### Iterations 3-5 (WARNINGs)
- never-throws symmetry between the two publish paths; STATUSES made single-source;
  quarantined -> held collapse for the submitter (so an untrusted submitter cannot use the
  response as a scrubber oracle); findings never echoed back; store-error classification
  (insertFailure: client 400 vs server 500, no raw path leak); per-agent rate valve (429);
  postId falsy check.

#### Iteration 6 (BLOCKER)
- [BLOCKER] an un-scrubbed `parentId` was served publicly --> FIXED: validated as a UUID.

#### Iteration 7 (WARNING + NITs)
- one documentation WARNING fixed; stale-doc fixes; remaining items were NITs.

#### Iteration 8 (CONVERGED)
- **Reviewer verdict:** "No blocking or warning issues found, well-converged work."
- One COSMETIC NIT only: the comment route's 429 body reused the post wording
  ("...posted...pausing community posts") for a comment. --> FIXED after convergence: the
  rate valve is one per-agent counter shared by both routes, so both 429 messages now read
  write-neutral and truthful ("...written to the community feed...pausing community posts
  and comments").

### Deferred (scoped, not defects)

- **author.name scrub** is the community-site's responsibility (Mikey's half), not the
  choke's.
- **parentId existence check** (does the parent post actually exist) is a store/UI
  follow-up; the choke validates the shape (UUID) and never leaks it.
- **the rate valve records only successful writes**, so a refused/failed write does not
  count against the per-hour cap. Deliberate.

### Validation

- My affected tests pass in isolation: `engine/feedpublish.test.js`,
  `server.community-choke-3485.test.js`, `server.community-valve-3485.test.js`
  (30 tests, 0 fail).
- Full suite (`tools/run-tests.sh`): 8440 tests, 8290 pass, 148 skipped. Two reds appeared
  under machine contention in `server.supervisor-refresh.test.js` (ENOTEMPTY rmSync temp-dir
  cleanup race) - a file THIS branch does not touch. Rerun alone: 4/4 pass. The runner's own
  footer flags this exact contention pattern. Confirmed flake, not a regression.
- subdir_audit: passed - this branch writes NO new boot-written file under ./Kosmos, so
  EXPECTED_ADDS in tools/test-install.sh is unaffected.
- No em dashes in any added line.

### Weakest premise

The un-scrubbed-public-field class (board, parentId) was found twice, one field at a time.
The residual risk is a THIRD such field that neither the guard nor a reviewer thought to
validate. Mitigation: the primitive strips the transport envelope and re-attaches only the
fields it explicitly validates, so a new field is not served unless someone adds it to the
allowed set on purpose. A follow-up that enumerates the served fields against a schema would
make the class impossible rather than caught-per-instance.
