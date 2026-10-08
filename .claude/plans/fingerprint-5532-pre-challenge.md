---
pre_challenge: true
method: challenge-loop
branch: fingerprint-5532
diff_hash: d6d3ec8474a805ae0dbd968b7b4ec2e114337649920ce9fa800dfa5241c9f5d0
validation: passed (Mortals full suite at 17ba054db, hash d6d3ec8474a8)
subdir_audit: passed
timestamp: 2026-10-08T16:20:26Z
iterations: 23
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 23, each a fresh blind reviewer, alternating Opus (odd) and Sonnet (even).
**Converged:** Yes. Iteration 17 (Opus) found nothing new; nits taken after it were re-reviewed by 18 to 20, and iteration 20 (Sonnet) found nothing new. A main merge then changed the diff (main's #5548 orphan guard needed the exports excused); iterations 21 to 23 reviewed it, and iteration 23 (Sonnet) found nothing new.
**Total findings (ledger lines):** 0 BLOCKERs, 49 WARNINGs (40 numbered, the rest duplicates), 4 CONVENTIONs, 20 NIT lines.
**Self-generated:** many of the later findings were on lines an earlier fix of this loop wrote (marked SELF in the ledger); two of my own claims were corrected in the plan (review 5's salt case, review 14's "dropped at once").
**Validation:** engine/computerprint-5532.test.js and engine.reachable.test.js (17 pass), the machine and logstamp pins, both browser-check gates, and the full suite on Mortals at the head named above. No web/ change.

Kept as decided, with reasons in the plan: the synchronous ioreg read (it blocks the board wherever it runs, so the first caller reads at start before the board listens, accepts the block, or makes it asynchronous first; review 22); the tests-only hooks on the export (a name guard, not a proof; a runtime test-detection gate would differ between Node versions); declining the ioreg -k filter (it cannot tell a VM with no id from a broken read).

## Ledger (verbatim, iteration by iteration)

#### Iteration 1 (Opus) on d3fbd84eb
- [WARNING] (1) a failed read was cached for the whole run. FIXED (cache only success; real-path test; both guards removed reddens).
- [WARNING] (2) hardwareId exported: any caller could log or send the raw id. FIXED (not exported; guard test on other engine files; mutation reddens).
- [WARNING] (3) the guarantee needs caller and coordinator rules. DOCUMENTED (never store the print under a data root; missing print after a pin = mismatch, told Pete).
- [WARNING] (4) the stability assertion could not fail, and a failure would print the id. FIXED (fresh reads, boolean compare).
- [NIT] seams and cache (FIXED); sync read (KEPT, decided); home-path-shaped fixture (FIXED).
#### Iteration 2 (Sonnet) on 86444cda5
- [WARNING] (5) no negative cache: a hung ioreg blocks every call. SELF (iter-1). FIXED (60 s wait; mutation reddens).
- [WARNING] (6) the reader guard covered only top-level engine/*.js and two spellings. FIXED (repo-wide tracked files, more spellings, swap guard; planted-file proof).
- [NIT] parseIoreg exported (kept, documented); _testRunner in exports (marked + guarded); salt odd length (FIXED); test order (cache reset by _testRunner).
#### Iteration 3 (Opus) on 323e91747
- [WARNING] (7) cross-company unlinkability rested on the coordinator's salt alone. FIXED (company id in the hash; test with one salt, two companies; mutation reddens).
- [WARNING] (8) guard claimed "any spelling" but checked five literals. FIXED (more spellings; claim reworded).
- [NIT] exclusion not anchored (FIXED); fresh read options (FIXED); now as a seam (documented tests-only).
#### Iteration 4 (Sonnet) on 3f8db9b35
- [WARNING] (9) test seams (run/platform) were reachable from production callers, skipping cache and wait. SELF (iter-1 seams). FIXED (seams only through the tests-only hook; fingerprint.length pinned; mutation reddens).
- [WARNING] (10) the print as an oracle / personal data. DOCUMENTED (stable within one company; cannot link companies).
- [NIT] non-darwin recorded a failure (FIXED, mutation reddens); guard needs git (commented); slash/reg-query spellings (the guard says known spellings only).
#### Iteration 5 (Opus) on fd71020ac
- [WARNING] (11) rule 1 did not forbid logging the print. FIXED (rule widened; to be carried onto the caller card).
- [NIT] resolvable pseudonym (documented); HMAC (changed before any pin); upper-case salt (accepted; mutation reddens); wall-clock retry (monotonic); catch comment (added).
#### Iteration 6 (Sonnet) on 2e9bf0cd9
- [WARNING] dup of (10)/(11): pseudonym and no-logging must reach the callers. ACTION: on the card for the wiring.
- [WARNING] (12) failedAt 0 as a sentinel skipped the wait for a failure at clock 0. FIXED (null; test; mutation reddens).
- [NIT] UUID/SALT exports (kept for tests); static assert messages (kept); tracked-files-only guard (documented).
#### Iteration 7 (Opus) on 4d64b3f85
- [WARNING] (13) a failed read on the real computer would send a print-less request, read as a copy under rule 2. FIXED (printState ok/none/waiting; callers defer on waiting; mutation reddens).
- [WARNING] (14) the coordinator side can resolve prints too. CORRECTED (comment and plan).
- [WARNING] (15) rules 1 and 2 are prose with no caller. PINNED (test.todo for the first caller; on the card).
- [CONVENTION] (16) stale sha256 formula in the doc comment and plan. FIXED.
- [NIT] "only fingerprint() leaves" (reworded); cleanup order (FIXED); guard spellings anchored (FIXED).
#### Iteration 8 (Sonnet) on 11df7fcb7
- [WARNING] (17) 'waiting' forever on a Mac with no parseable id. SELF (iter-7). FIXED ('none' when ioreg ran without an id; mutation reddens).
- [WARNING] dup (kept sync read): callers off the hot path (card).
- [WARNING] (18) 'none' must never be pinned or compared. ASKED Pete to confirm.
- [NIT] header wording (FIXED); guard skip outside git (FIXED); real-Mac test timeout (kept).
#### Iteration 9 (Opus) on 34d6dfa17
- [WARNING] (19) an always-failing ioreg deferred forever. SELF (iter-7). FIXED (GIVE_UP_AFTER; mutation reddens).
- [WARNING] (20) 'ok' without a print (bad salt/company) would send print-less. SELF (iter-7). FIXED (printFor, one answer; mutation reddens).
- [WARNING] (21) one garbled ioreg answer set "no id here". SELF (iter-8). FIXED (hardware block present, no UUID key; mutation reddens).
- [CONVENTION] merged comment line (FIXED).
- [NIT] withReader order (FIXED); tests-only hooks on exports (kept, decided).
#### Iteration 10 (Sonnet) on 5da4923ec
- [WARNING] (22) malformed salt or company deferred forever. SELF (iter-9). FIXED ('error' with a reason; mutation reddens).
- [WARNING] (23) the no-pin residual was only in the plan. FIXED (stated in the header).
- [WARNING] (24) the no-id check matched the class name anywhere. SELF (iter-9). FIXED (header line only; fixture; mutation reddens).
- [WARNING] dup (review 4): tests-only hooks on exports.
- [NIT] guard listing by count (FIXED: known files); shared counters (kept, one computer).
#### Iteration 11 (Opus) on dc6aebba3
- [WARNING] (25) exported fingerprint() and the header's "send no print on null" contradicted rule 2. SELF (iter-7/9). FIXED (bare function private; header; mutation reddens).
- [WARNING] (26) the company id's source was unstated: from a coordinator answer, prints could be linked across companies. FIXED (header + card rule; for the first caller).
- [WARNING] (27) the guard missed `ioreg -l` handed to parseIoreg. FIXED (\bioreg\b and parseIoreg in the guard).
- [NIT] give-up boundary (FIXED, mutation reddens); test title vs linux (FIXED); validate before platform (FIXED); no rotation (stated).
- [CONVENTION] plan summary stale (FIXED).
#### Iteration 12 (Sonnet) on a78d6b25a
- [WARNING] (28) a dump cut short after the block header read as "no id here" at once. SELF (iter-10 rule). FIXED (two in a row; tests; mutation reddens).
- [NIT] guard message names the allowed file (FIXED); real-ioreg skip when blocked (not taken: a real failure); UUID/SALT exports (kept for tests); todo must not go stale (on the card).
#### Iteration 13 (Opus) on 57f0ce2f5
- [WARNING] (29) the salt lower-casing was a no-op and the plan's "mutation reddens" for it was false (my own overclaim, review 5). SELF. CORRECTED (removed; plan corrected; test pins Node's behaviour).
- [WARNING] (30) the guard skipped swift/java/py and gethostuuid/IOKit spellings. FIXED (extensions + spellings; planted .swift proof).
- [NIT] header "not exported" (made exact); todo names printFor (FIXED); raw id in memory (documented); retry after give-up (decided, documented).
#### Iteration 14 (Sonnet) on ce9a01bec
- [WARNING] (31) loose guard words would redden on another lane's comment. SELF (iter-11/13). FIXED (anchored; planted mention passes, planted invocation fails).
- [WARNING] (32) none-then-print flip undocumented. DOCUMENTED (nothing pinned, so no mismatch; Pete confirmed).
- [WARNING] dup: never-log rule is a todo until a caller.
- [NIT] drop the dump after parsing (FIXED); review refs in comments (kept); duplicate validation (kept, harmless).
#### Iteration 15 (Opus) on 5d5a73960
- [WARNING] (33) the guard skipped extensionless scripts, yml, plist, gradle. FIXED (shebang detection; planted proof).
- [WARNING] (34) privacy rules prose-only with a green todo. FIXED (armed: loader allowlist guard; planted proof).
- [WARNING] (35) post-give-up retries stalled the board every minute forever. FIXED (doubling backoff to an hour; mutation reddens).
- [WARNING] (36) give-up counted reads, not time. FIXED (GIVE_UP_AFTER_MS on the clock; mutation reddens).
- [NIT] out='' wiped nothing (my review-14 overclaim; WITHDRAWN); "this Mac" in a message (FIXED); tests-only hooks (kept).
#### Iteration 16 (Sonnet) on e7ac09cc7
- [WARNING] (37) a dump cut off identically twice still reached "no id here". SELF (iter-12 rule narrowed it, did not close it). FIXED (whole block with closing brace; test; mutation reddens).
- [NIT] sync read off the request path (card); guard covers known spellings only (stated); tests-only hooks (kept).
#### Iteration 17 (Opus) on 4c6a47837
- CONVERGED: no new BLOCKER, WARNING or CONVENTION (the one warning repeats the decided synchronous read; on the card and now in the allowlist comment).
- [NIT] the m-flag end anchor did not match the comment (FIXED, mutation reddens); json/xml (FIXED); loader guard skip (FIXED); sleep not counted (documented); parseIoreg name (not taken).
#### Iteration 18 (Sonnet) on 37c2593e6
- [WARNING] dup (review 4): tests-only hooks on exports.
- [WARNING] dup (review 13): raw id in memory; -k hardening DECLINED (cannot tell a no-id VM from a broken read).
- [WARNING] (38) the whole-block regex could backtrack. SELF (iter-17). FIXED (linear; 5 MB in 5 ms; mutation reddens).
- [NIT] shared validation (kept); review refs (kept); plan superseded notes (a current-design section added).
- [CONVENTION] dup (review 13): parseIoreg weakens the claim (header already says so).
#### Iteration 19 (Opus) on c71ecc956
- [WARNING] (39) the loader guard missed .js suffixes, paths and import(). SELF (iter-15). FIXED (wider pattern, self-checked spellings, planted proof).
- [WARNING] dup (review 4, sixth time): tests-only hooks on exports. Kept, reasoning recorded.
- [WARNING] (40) a junk id value made every board start wait ten minutes. FIXED (whole block, no valid id = no id; mutation reddens).
- [NIT] synchronous read (decided); raw id in memory (documented).
#### Iteration 20 (Sonnet) on 53bbef9cb
- CONVERGED: no new BLOCKER, WARNING or CONVENTION after dedup.
- [WARNING] dup: the first caller's no-logging and company-source tests (the empty ALLOWED list enforces it).
- [WARNING] dup: the "no id here" residual (reviews 12/16/19; the case raised is judged fine).
- [WARNING] dup: the synchronous read (decided, review 1).
- [NIT] review numbers in comments (kept); test-only exports (kept); real-Mac arm in a sandbox (kept, a real signal).
#### Iteration 21 (Sonnet) on aa80f142f (after the main merge)
- [WARNING] (41) the four excuses sat in the by-name EXCUSED map, which hides a same-named orphan elsewhere, and printFor's "remove then" was unenforced. FIXED (seams in SEAMS_5548; printFor in a by-file FIRST_CALLER_5532 with a test that reds once it has a caller; a temporary caller module reddened it).
- [WARNING] DEFERRED, measured false: a no-id computer does not re-read every minute forever; its failed reads start the ten-minute give-up, then the wait doubles to an hour.
- [NIT] whole-block check unreachable from the real runner's truncation; real-hardware arm cannot compare to an independent source; .md readers not guarded. Kept.
- [CONVENTION] plan file named <branch>.md: the tooling accepts it. Not a defect.
#### Iteration 22 (Opus) on afecf66d6
- [WARNING] (42) "call printFor in the background" is wrong advice: execFileSync blocks the whole board wherever it runs. FIXED (allowlist comment and plan corrected).
- [CONVENTION] (C5) the plan's review log stopped at review 19. FIXED.
- [NIT] header claimed no exported function READS the hardware (printFor does). FIXED (claims none RETURNS the id). noIdStreak not reset on success; one cut read flips none to later. Kept.
#### Iteration 23 (Sonnet) on 17ba054db
- CONVERGED: no new BLOCKER, WARNING or CONVENTION after dedup.
- [WARNING] dup of the no-id residual: "a dump cut just after a nested } reads as whole". Measured: real ioreg -rd1 prints nested values inline (one lone "}" line, the block close), and a cut dump never reaches the check (execFileSync throws).
- [NIT] first post-give-up wait is 2 minutes; fingerprint() repeats printFor's validation; early plan entries superseded. Kept.
