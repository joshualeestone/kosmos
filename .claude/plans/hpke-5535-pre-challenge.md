---
pre_challenge: true
method: challenge-loop
branch: hpke-5535
diff_hash: 3f0de1ec91b047fcd9a229c9c5386d74000596120c3df5118d90e7b5962faf7f
validation: passed (engine/hpke.test.js 11/11 against RFC 9180 A.2.1 copied byte for byte, plus every test that walks engine/ or tracked files: engine.reachable, cli.update-ifnewer-4382, comment-deferral, fixture-discipline, web.aimodels-name-5114, web.machine-absence-claims, web.list-depth-3679, web.place-names-5127, bundle.execbit-4134, no-name-refs-3071, no-brand-refs-1881, tools.no-phone-home-4253, all green. Red-checks: a corrupted base_nonce label reds exactly the key-schedule test; removing the canonical-key guard reds exactly its test. New module with no caller until slice 3, so nothing in the product path changes)
subdir_audit: passed
timestamp: 2026-10-08T02:18:32Z
iterations: 3
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, sonnet, opus; each a fresh blind reviewer with a cryptography brief)
**Converged:** Yes (iteration 3: no BLOCKER, WARNING or CONVENTION; 5 NITs, all taken)
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] hpkeSeal/hpkeOpen were never checked against a vector (a shared wrong key or sequence would pass round trips) --> FIXED: hpkeOpen opens RFC sequence 0; control: sequence 1 does not
- [WARNING] the all-zero check used Buffer.equals on the SECRET DH output, and the plan called it public --> FIXED: crypto.timingSafeEqual; plan corrected
- [NIT] the RFC 7.1.4 check never runs on Node 26 (OpenSSL refuses first) --> FIXED: stated as a backstop in code and plan
- [NIT] vector seams exported in production (nonce-reuse hazard) --> FIXED: hpkeVectorSeamsForTests refuses outside a test process
- [NIT] HKDF-Expand had no 255*Nh guard --> FIXED
- [NIT] "each with its own control" overstated; truncations stopped before the AEAD --> FIXED: shared control named; a truncation that reaches the AEAD

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a non-canonical pkR (bit 255 set or u >= p) sealed a message nobody could ever open (raw pkR in kem_context vs the recipient's canonical rebuild); measured --> FIXED: refused at seal time; red-checked
- [WARNING] the seam guard is an execArgv heuristic, and the test called the seams at load --> FIXED: fetched inside each test; excuse states the heuristic
- [NIT] I2OSP truncated silently --> FIXED: range check
- [NIT] empty plaintext unpinned --> FIXED: test
- [NIT] plan counts and names stale --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [NIT] generated-key loop checked only bit 255 --> FIXED: each key seals and opens
- [NIT] no accepting-edge or compare-only boundary --> FIXED: p - 2 seals, 2^255 - 1 refused
- [NIT] high-bit enc unpinned --> FIXED: a null case
- [NIT] the RFC 7748 departure unstated --> FIXED: in the comment
- [NIT] plan called p and p + 1 canonical --> FIXED

### Strengths
- [STRENGTH] every RFC 9180 A.2.1 intermediate is pinned, so a wrong label or concatenation fails at its own step
- [STRENGTH] hpkeOpen never throws (measured with null, strings, Proxy and huge inputs) and binds the raw enc
- [STRENGTH] a backup that would write and never restore is now a loud error at seal time
