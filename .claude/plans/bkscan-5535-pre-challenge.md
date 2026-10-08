---
pre_challenge: true
method: challenge-loop
branch: bkscan-5535
diff_hash: 913c72c2c2553afc680414313bb6e8c1e56acdeb695bf82a135fdb5710cb04cd
validation: passed (engine/backupscan.test.js 38/38, including real system wallpapers, icons, sounds, a .mov and dyld that must be kept, and this repo's own screenshot; plus engine/secretmask.test.js, backupformat, hpke, engine.reachable and every engine/ and tracked-file walker, all green. Every security guard was mutation-checked by the author and by reviewers in scratch copies: each one's removal turns a test red, except guards labelled defence in depth. New module, no caller until the slice-3 walker)
subdir_audit: passed
timestamp: 2026-10-08T04:09:21Z
iterations: 12
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 12 (opus and sonnet alternating; each a fresh blind security reviewer; rounds 4 to 12 mutated guards and swept real files)
**Converged:** Yes (iteration 12: no BLOCKER, WARNING or CONVENTION; 1 NIT, taken)
**Asked:** 0
**Full per-round detail, every decision and every stated residual:** .claude/plans/bkscan-5535.md

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] UTF-16 text stored a key readable --> FIXED: decoded, scanned as text, re-encoded
- [BLOCKER] compressed bytes scanned blind (.docx, git objects, PDF Flate) --> FIXED: magic-based skip, .git/ denied
- [BLOCKER] line-by-line fallback lost split held values --> FIXED: no fallback; a withheld scan skips the file
- [WARNING] PGP keys; deny-list gaps and over-breadth; byte loss on redaction --> FIXED (loss stated and pinned)

#### Iteration 2
**Reviewer model:** sonnet
- [BLOCKER] x3, one class (UTF-32 BOM, false BOM, late NULs: the scanned view differed from the stored bytes) --> FIXED: a final raw check on the bytes about to be stored
- [WARNING] magic false positives and gaps; deny-list gaps; vacuous fixtures --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] content could hide a password behind the masking placeholder --> FIXED: placeholder content skipped; mapping only for our own output
- [WARNING] real images over-skipped --> FIXED: printable-run scanning, per-format generic kinds
- [CONVENTION] a test title claimed an untested case --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] long_token ignored in every binary (Azure/SendGrid in a db) --> FIXED: only for media/fonts
- [WARNING] a key split by one control byte --> FIXED: a third view for non-media binaries
- [WARNING] untested guards --> FIXED; a wrong XMP-id diagnosis found and removed

#### Iteration 5
**Reviewer model:** opus
- [WARNING] exemptions not per format; weak magics spoofable --> FIXED: per-format sets, strict magics
- [WARNING] media-only guards untested; [CONVENTION] compressed fixtures missing --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] audio over-skipped (10 of 17 system sounds) --> FIXED: audio kind
- [WARNING] ISO brand and font magics untested --> FIXED

#### Iteration 7
**Reviewer model:** opus
- [WARNING] Ogg over-skipped; audio arms unpinned --> FIXED: Ogg/FLAC/BMP/ICO/WASM, arms pinned

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] three deny entries untested --> FIXED, with near-miss controls

#### Iteration 9
**Reviewer model:** opus
- [WARNING] chance zip signature in media; XMP keys in video over-skipped; long_token on paths --> FIXED / STATED (#5558)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] round 9's XMP fix leaked a key inside the packet --> FIXED: only xmpDM:key removed

#### Iteration 11
**Reviewer model:** opus
- [WARNING] round 10's fix leaked a key inside the value --> FIXED: only the attribute name removed; four tests pin it

#### Iteration 12
**Reviewer model:** sonnet
- [NIT] credential-named CSV exports --> FIXED: denied by path

### Strengths
- [STRENGTH] fail closed everywhere; a final raw check on stored bytes closes the "scanned a different view" class
- [STRENGTH] real files from this Mac are must-keep fixtures, so over-skipping is measured, not assumed
