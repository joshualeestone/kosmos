---
pre_challenge: true
method: challenge-loop
branch: bkformat-5535
diff_hash: f9991819a1b8520115ed2abc772f9558bbbf87ea12412bf23f45fd335011ed21
validation: passed (engine/backupformat.test.js 15/15, engine/hpke.test.js 11/11, engine.reachable, and every test that walks engine/ or tracked files (cli.update-ifnewer-4382, comment-deferral, fixture-discipline, web.aimodels-name-5114, web.machine-absence-claims, web.list-depth-3679, web.place-names-5127, bundle.execbit-4134, no-name-refs-3071, no-brand-refs-1881, tools.no-phone-home-4253), all green. Mutation checks, each red then restored: chunk-name AAD, the HMAC re-check in openVerifiedChunk, the Ed25519 device-key guard, openManifest's plain-object return, the public-key check, the naming-key length, the gear seed (golden vector). New module with no caller until slice 3)
subdir_audit: passed
timestamp: 2026-10-08T02:50:58Z
iterations: 6
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (opus, sonnet, opus, sonnet, opus, sonnet; each a fresh blind reviewer with a cryptography and storage-format brief; rounds 4 to 6 mutated guards in scratch copies)
**Converged:** Yes (iteration 6: no BLOCKER, WARNING or CONVENTION; 2 NITs, both taken)
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] a manifest with undefined (or a Date, Map, array hole) sealed and signed but could never open --> FIXED: strict canonicalJson plus a read-back check before sealing
- [BLOCKER] a forged chunk (HPKE base mode has no sender auth) opened --> FIXED: openVerifiedChunk (decrypt, then HMAC re-check) is the only restore entry
- [WARNING] no domain tag in signed bytes --> FIXED
- [WARNING] manifest size leaked file counts --> FIXED: framed and padded
- [WARNING] small files matchable by size --> FIXED: 4 KiB frame floor
- [NIT] canonical names, exact frame size, comments, tests --> FIXED; streaming chunker DEFERRED to slice 3 (the walker reads files)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a one-hole array read back as [] and symbol or hidden properties were dropped --> FIXED: refused
- [WARNING] a top-level null manifest opened as null (the failure value) --> FIXED: plain objects only
- [NIT] a lone surrogate aliased two contexts --> FIXED: pinned id alphabet
- [NIT] padme's Math.log2 --> FIXED: integer bit math, checked against a float reference

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a non-Ed25519 device key (P-256, Ed448, RSA) sealed manifests that could never verify --> FIXED: Ed25519 only, signature length checked
- [NIT] a mislabelled test row, plan counts, openManifest return type --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the verify key-type guard and openManifest's plain-object return had no test that caught their removal --> FIXED: a public-key check with its test; hand-built, validly signed manifests with bad content
- [NIT] a chunk could be sealed under a wrong name --> FIXED: sealNamedChunk is the uploader's only entry

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the naming-key length check (stops forging names with an empty key) was the only untested security guard --> FIXED: tested, mutation red
- [NIT] unreachable guards unlabelled; plan counts --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [NIT] no golden vector for format 1's boundaries --> FIXED
- [NIT] chunkBuffer accepted any opts --> FIXED: validated

### Strengths
- [STRENGTH] integrity is anchored in the HMAC name, not in HPKE base mode, and restore cannot bypass it
- [STRENGTH] every path where something sealed but could never restore was found and closed (three of them), each with a test
- [STRENGTH] tests build frames and manifests by hand, independent of the module
