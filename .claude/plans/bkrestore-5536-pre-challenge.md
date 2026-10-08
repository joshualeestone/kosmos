---
pre_challenge: true
method: challenge-loop
branch: bkrestore-5536
diff_hash: ebd93329f9e507f6cd7b6c4830ca22d87fc59c29460d0d10d501fad5afe4da05
validation: passed
subdir_audit: passed
timestamp: 2026-10-08T06:28:47Z
iterations: 22
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 22
**Converged:** Yes (iteration 22 returned no BLOCKER, WARNING or CONVENTION)
**Total findings:** 48 actionable (0 BLOCKERs, 47 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 45 | **Deferred:** 3 | **Asked (awaiting user):** 0
**Validation:** full suite on Mortals for this exact hash (mortals-validate, entry status clean, 16752 tests, 0 fail, shell shards all passed, 2026-10-08 06:28Z); measured against base 66ea6162f, so the merge against today's main is measured by PR CI.
**Reviewer models:** opus on odd iterations, sonnet on even (11 each).
**Self-generated:** the 6c-bis blame lookup was NOT run per finding, so no counted figure is claimed. By reading, these findings sat in this loop's own earlier fixes: 4.2 (reversed 2.1's invisible-character refusal), 5.1, 9.2, 11.1 (10's work budget), 13.3, 15.3, 17.1, 21.1 (19's tag refusal not carried into reports), 21.2.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] backuprestore.js - Windows-unsafe names (`.`, ADS colon, CON, case collisions) restored --> FIXED 884b66a3c
- [WARNING] no duplicate or file-versus-folder collision check --> FIXED 884b66a3c
- [WARNING] chunk names reached fetchChunk unchecked --> FIXED 884b66a3c
- [WARNING] fetchChunk sync-only; an async reject crashed the process --> FIXED 884b66a3c (async + sink)
- [WARNING] size never checked; shrinkWarning trusted device fields --> FIXED 884b66a3c
- [WARNING] whole files held in memory --> FIXED 884b66a3c (streaming sink, commit after verify)

#### Iteration 2 (sonnet)
- [WARNING] lone surrogates collided after UTF-8 encoding --> FIXED d61a6b9da
- [WARNING] no cap on a fetched object before decrypting --> FIXED d61a6b9da
- [WARNING] sink contract unstated --> FIXED d61a6b9da
- [WARNING] collision wording overclaimed --> FIXED d61a6b9da

#### Iteration 3 (opus)
- [WARNING] final sigma escaped the collision key --> FIXED bdcc1a924
- [WARNING] two sink duties only in an internal comment --> FIXED bdcc1a924

#### Iteration 4 (sonnet)
- [WARNING] quadratic collision check (4.6 s for 400 deep entries) --> FIXED bf4d080a3 (trie)
- [WARNING] invisible-character refusal dropped real emoji names --> FIXED bf4d080a3 (fold instead)
- [WARNING] C1 and line separators passed --> FIXED bf4d080a3
- [WARNING] zero-byte chunks allowed unbounded fetches --> FIXED bf4d080a3

#### Iteration 5 (opus)
- [WARNING] segment rules only on the raw segment (`..` + ZWSP) --> FIXED dbe2bc78e
- [WARNING] `nul .txt` passed --> FIXED dbe2bc78e
- [WARNING] 8.3 short names defeat a path-tracking sink --> FIXED dbe2bc78e

#### Iteration 6 (sonnet)
- [WARNING] no bound on the manifest object or entry count --> FIXED 9dd5f1dd6

#### Iteration 7 (opus)
- [WARNING] a Uint8Array manifest read as tampering --> FIXED 018464a68

#### Iteration 8 (sonnet)
- [WARNING] 512 MiB manifest bound too high for a parse-whole manifest --> FIXED ee5d735bf
- [WARNING] no aggregate byte budget --> FIXED ee5d735bf
- [WARNING] sink duties untested here --> FIXED ee5d735bf (REQUIRED note in plan, comment on #5536)

#### Iteration 9 (opus)
- [WARNING] maxTotalBytes defaulted to unbounded --> FIXED 05ae775ad (required)
- [WARNING] capital sharp s escaped the fold --> FIXED 05ae775ad

#### Iteration 10 (sonnet)
- [WARNING] failed files cost nothing against the budget --> FIXED 04e115c7a
- [WARNING] caller mistakes read as tampering --> FIXED 04e115c7a

#### Iteration 11 (opus)
- [WARNING] work budget charged only verified plaintext (400 MiB junk under a 100-byte budget, measured) --> FIXED 8baae38c2
- [WARNING] maxBytes not handed to fetchChunk --> FIXED 8baae38c2

#### Iteration 12 (sonnet)
- [WARNING] dotfile paths restore --> DEFERRED: not a boundary (a compromised device controls any file's content); the restore root is, recorded as REQUIRED
- [WARNING] explicit NaN erased bounds --> FIXED 789095bb2

#### Iteration 13 (opus)
- [WARNING] ArrayBuffer fetch read as tampering --> FIXED 4103f33e2
- [WARNING] malformed ctx and private device key read as tampering --> FIXED 4103f33e2

#### Iteration 14 (sonnet)
- [WARNING] pooled work allowance spendable on junk --> FIXED 58af07f84 (per-object cap by file size)
- [WARNING] failed list uncapped --> FIXED 58af07f84

#### Iteration 15 (opus)
- [WARNING] an honest backup over a bound read as tampering --> FIXED 1b6f4a35b ({ overBound })
- [WARNING] legal Mac names reported as unsafe --> FIXED 1b6f4a35b (own reason, loss stated)

#### Iteration 16 (sonnet)
- [WARNING] dotfiles (repeat of 12) --> DEFERRED, same reasoning; its useful part added to the REQUIRED note (afb617327)
- [WARNING] absolute timing bound measured 4.3 s of 10 under load --> FIXED afb617327 (depth ratio, measured x4 trie vs x13 quadratic)

#### Iteration 17 (opus)
- [WARNING] reported text kept terminal escapes --> FIXED 8eef9b0ac
- [WARNING] memberSk unchecked --> FIXED 8eef9b0ac

#### Iteration 18 (sonnet)
- [WARNING] restored not named as manifest text --> FIXED ad65ff281
- [WARNING] sink duties not enforced (repeat of 8) --> DEFERRED, already resolved by the REQUIRED note and #5536
- [WARNING] Windows-forbidden characters missing from the conformance list --> FIXED ad65ff281

#### Iteration 19 (opus)
- [WARNING] Unicode tag characters (hidden text) restored --> FIXED fabf9a025

#### Iteration 20 (sonnet)
- [WARNING] verified manifest with no file list read as tampering --> FIXED 0263ff6e9 ({ malformed })
- [CONVENTION] do-not-wire gate only in the plan --> FIXED 0263ff6e9 (reachability excuse)

#### Iteration 21 (opus)
- [WARNING] reports still carried tag characters --> FIXED b22120b9a
- [WARNING] entries over the budget earned work allowance --> FIXED b22120b9a

#### Iteration 22 (sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** - no new actionable findings.

### Deferred
- Dotfile deny-list (12, 16): a filter in this module is not a security boundary; restoring into a fresh, person-chosen root is, and the next slice must test it.
- Sink duties untestable in this slice (18, a repeat of 8): recorded as REQUIRED at the top of the plan, on #5536, and in the engine.reachable excuse.
- Two guards I added and could not arm by mutation were removed rather than kept (a mid-file work check in 10, a pre-fetch spent-budget check in 19).

### NITs (non-blocking, across all iterations)
- shrinkWarning(older, newer, null) throws a bare TypeError (22)
- shrinkWarning sums sizes of entries restore would refuse; documented heuristic (22)
- sink.begin is called before a file's first fetch, so a failing file still gets a temp file (22)
- a repeated chunk name is fetched each time it appears (5)
- the catch-all reason "could not be written" also covers an unexpected throw from verification (5, 20)

### Strengths (across all iterations)
- The trust chain: manifest opened only with the snapshot-time device key; every chunk through openVerifiedChunk; size and sha256 before commit; abort on every failure path.
- Every refusal test has a working control, and every new guard was mutation-checked red during the loop.
- Bounded work against a hostile store: bytes charged before decrypting, per-object and pooled caps, maxBytes handed to the fetch, linear collision check.
