---
pre_challenge: true
method: challenge-loop
branch: s7a-6587
diff_hash: 802da21451c0746ad23e7c8c266b08f8837f63772ab56c0585414069a25fc17e
validation: passed (engine/servicekeys-6587.test.js 16 tests + engine.reachable.test.js 8 = 24/24; standing guards fixture-discipline, cli.sandbox-data-4796, no-brand-refs-1881, no-name-refs-3071 and the three bundle.* files 46/46 on the rebased tree; every fix's mutant measured red)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T08:02:30Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20
**Converged:** Yes (iteration 20 raised one NIT, recorded)
**Total findings (bracketed markers in the plan log):** 0 BLOCKERs, 23 WARNINGs, 5 CONVENTIONs, 22 NITs
**Fixed:** every WARNING and CONVENTION; NITs fixed or recorded with reasons | **Routed:** Rust parity points to Renet (relay #474) | **Asked (awaiting user):** 0

Reviewer models alternated opus (odd iterations) and sonnet (even). Iteration 17 overturned iteration 3's NIT (any pinned recovery key listed is refused, not only the signer).

### Per-Iteration Breakdown (from .claude/plans/s7a-6587.md)
#### Iteration 1 (opus)
- [WARNING] fixed: a listed key that is not a curve point was taken (my plan claimed this changed no answer; it changes whether the whole set is taken). Now refused by an ed25519-dalek-style decompression check (BigInt; y read from its low 255 bits mod p).
- [WARNING] fixed: JSON serde_json refuses, now refused here too. Bad UTF-8 (now a fatal decoder, with the BOM kept so it is refused); a lone surrogate escape; a number out of a double's range (1e400 read as Infinity); more than 127 nested containers (serde's recursion limit).
- [WARNING] routed to the relay: serde takes an entry spelled as a 3-element array, and a role spelled as `{"current": null}`. The JS refuses both, which is the right direction; told Renet Tilley for #474.
- [WARNING] fixed: a malformed held record skipped the rollback check. It now fails closed.
- [NIT] fixed: the .sig is trimmed with Rust's whitespace (U+0085 yes, U+FEFF no).
- [NIT] fixed: every refusal arm now also asserts its reason. The "four keys" arm no longer includes the root key, so it refuses on the count alone.
#### Iteration 2 (sonnet)
- [WARNING] routed to the relay: serde_json without `float_roundtrip` (relay Cargo.toml `serde_json = "1"`) is not correctly rounded near f64::MAX. So a signed doc with an extra `1.7976931348623158e308` is refused by the relay (NumberOutOfRange) and taken here, whose Number() rounds correctly. The fix that makes the two agree is the relay enabling `float_roundtrip`; a JS cutoff would only move the disagreement. Told Renet Tilley. Reasoned from the serde source plus an emulation, not run with cargo.
- [NIT] fixed: the weak-key arm now covers all seven points with both sign bits. A mutation dropping one list entry, or the sign mask, turns it red (each measured).
- [NIT] fixed: arms for a lone surrogate in a member name and a member twice inside an array element.
#### Iteration 3 (opus)
- [WARNING] fixed: "off as shipped" was not enforced. The verifier defaulted to its own `[]`, not manifest-verify's RECOVERY_KEYS, and "off" read the same as a forged signature. It now defaults to RECOVERY_KEYS and answers `{ off: true }` when none is pinned. The arm asserts RECOVERY_KEYS is empty, and that off is distinct from a refusal.
- [NIT] fixed: with two recovery keys, only the signing root is refused as a listed key (relay keyset.rs: `key == *root`).
- [NIT] fixed: pinnedSpki trims as the tunnel does (Rust str::trim), so a BOM before the pin is not a key.
- [NIT] fixed: the `[1]` arm asserts its reason. Plan counts refreshed.
#### Iteration 4 (sonnet)
- [WARNING] fixed: any non-array recovery keys (a null from a bad read) answered off. Only an empty list is off now, and junk is refused. New arm, with null, a string, an object and a number.
- [CONVENTION] fixed: the JSDoc says a caller checks `off` before `ok`, since off is the shipped default and not a failure to report.
#### Iteration 5 (opus)
- [WARNING] fixed: pinnedIsListed answered false both for "not on the list" and "no verified list", so slice 2's alarm would have fired on every install with the shipped off answer. It now takes the whole verify result: true or false only for ok: true, null otherwise. Arms for off, a refused set, a bare key array, and nothing.
- [NIT] fixed: an arm that can fail on the iteration-3 point. A fresh load with manifest-verify's RECOVERY_KEYS swapped (require.cache) must take the vector set by default.
#### Iteration 6 (sonnet)
- [WARNING] fixed: pinnedIsListed answered false for no pin (null, empty, or whitespace), the same false-alarm class as iteration 5 on the pin side. No pin is now null; a pin that is there but not a key stays false (a mismatch).
- [NIT] fixed: verifyServiceKeySet() with no argument refuses instead of throwing.
#### Iteration 7 (opus)
- [NIT] fixed: verifyServiceKeySet(null) and non-buffer bytes threw. They now answer (off, or "not readable").
- [NIT] fixed: the no-argument arm asserts off, and arms were added for a real refusal with a key set and for junk bytes.
- [CONVENTION] fixed: the plan's test count.
#### Iteration 8 (sonnet): no BLOCKER or WARNING
- [CONVENTION] fixed: the plan's count was wrong a second time (I typed it). It is now taken from `grep -c "^test("` and checked against node's tally.
- [NIT] fixed: the require.cache arm deletes, rather than assigns undefined, an entry that was not loaded before.
#### Iteration 9 (opus)
- [WARNING] fixed: two key-spelling checks had no arm that could fail (measured by the reviewer: delete either and all 14 pass). These were the SPKI prefix check and the canonical re-encode check, because the length regex stops every existing arm first. That made "an arm for every refusal the spec lists" false. New arms: non-zero trailing bits (the same 44 bytes as K7), an X25519 header, a leading space, and URL-safe base64, with controls that the spellings are what they claim. Both mutations now turn the keys test red (measured below).
- [NIT] fixed: the JSDoc no longer claims the relay's exact order. Field shapes come before seq and issued there, so only the refusal reason can differ.
#### Iteration 10 (sonnet): a mutation sweep (90 single-guard mutations on copies)
- [WARNING] fixed (x8) and [NIT] fixed (x3): an arm for each, including 60 real keys (many with the sign bit set), a real key whose last byte matches a weak point (seed found in 1..255, asserted), and a nested seq after the top-level one. Measured: each of the 11 mutations now turns at least one test red, on a green baseline (14/14).
#### Iteration 11 (opus)
- [WARNING] fixed: pinnedSpki's re-encode check was not shadowed, as I had listed it. A 43-character pin with non-zero trailing bits decodes to the same 32 bytes and is stopped only by it. The tunnel's strict decoder refuses such a pin file, so here it must read false. New arm, with a control that the bytes are the same. Measured below.
- [NIT] fixed: more shadowed guards were found (`m > 12`, `m < 1`, the `typeof doc` and `Array.isArray(doc)` checks, `typeof e`, `der.length !== 44`). The sentence now says the list is of the ones found.
#### Iteration 12 (sonnet)
- [WARNING] fixed: no arm checked any month length but February. Making the 30-day months 31 left every test green. New refusals (Apr, Jun, Sep, Nov 31; Jan 32) and a control for every month's last day.
- [WARNING] fixed: only 3 of Rust's 25 White_Space code points were exercised. Cutting the class to ASCII plus U+0085 left every test green, which would make a pasted pin with a trailing U+3000 or U+00A0 a false mismatch. New arm: every code point trimmed from both the .sig and the pin, with U+FEFF, U+180E and U+200B as negatives.
- [NIT] accepted: TextDecoder with fatal needs ICU. Kosmos runs the official Node it bundles, which has it. A build without ICU would refuse every set, failing closed, not open.
#### Iteration 13 (opus): a 17-mutation sweep
- [WARNING] fixed (x4) and [NIT] fixed (x2): arms for each. These are a 3-key set with all three roles; tab-indented, CRLF and tab-after-seq sets taken; 128 nested objects refused and 127 taken; `"a\udc00"` refused; a BOM-only pin false.
- [NIT] fixed in code: a pin that is not a string or Buffer (junk from a failed read) answers null, not false, the iteration-4 class on the pin side. A Buffer pin is read.
#### Iteration 14 (sonnet)
- [WARNING] fixed: no arm had an empty object, so removing scan()'s empty-object branch left every test green and made the walk run past the text's end and HANG. The string loop is now bounded by the length as well, and refuses rather than hangs, whatever is removed. New arms: `{}`, `{"a": {}}`, `[]`, `[[], {}]` as unknown members, taken.
- [WARNING] fixed: no arm had an escaped quote or backslash, so a broken escape step left every test green. New arms: `"a\"b"`, `"a\\"` and `"\\\""`, taken.
#### Iteration 15 (opus)
- [WARNING] fixed: the Rust-style trim was a regex (`^WS+|WS+$`) that backtracks quadratically over a long whitespace run inside the text (reviewer measured 24.8 s for 160k spaces in pinnedIsListed). The coordinator chooses the pin bytes, and slice 2 would run this on the board's event loop. Now a two-index loop over a Set of the same 25 code points (size measured: 25).
#### Iteration 16 (sonnet)
- [WARNING] fixed: two clauses of the lone-surrogate regex were untested (widening the "not a high" class, and the lookahead). New arms: a lone low after a pair, a lone high before a pair. Each mutant measured red (fail 1).
- [CONVENTION] fixed: the Validation test count was stale (said 15/23). Now from grep -c.
- [NIT] fixed: a .sig, or a pin to pinnedSpki, that throws when made into text (Object.create(null), a throwing toString) threw. Both are now type-guarded like bytes; arms added; each guard's removal measured red.
- [NIT] fixed: the weak check's last-byte clause was unpinned. New arm: the 26e8... weak point with its last byte changed is taken when on the curve. Dropping the clause measured red.
#### Iteration 17 (opus)
- [WARNING] fixed, overturning iteration 3's NIT: any PINNED recovery key listed as a service key is refused, not only the signer. The spec's reason ("whoever held a service key would then hold the root") holds for every root, and manifest-verify.js refuses any recovery key in a release key list. With the relay's one root both rules give the same answer. Weakest premise: the relay gains a second root without this rule; routed to Renet for #474. The arm is flipped to a refusal, with a control that the same key, not pinned, is taken.
- [WARNING] fixed: a space or CR ending a number had no arm (each mutant measured 16/16 green). Arms: a space after seq, and seq as the last member before a space and before CRLF (with a control that the fixture really ends on seq).
- [NIT] fixed: a plain Uint8Array .sig passed the type guard but was read as "1,2,3". It is now decoded as text, with an arm.
#### Iteration 18 (sonnet)
- [WARNING] fixed: a falsy held record (0, false, '', NaN) was refused, but no arm held it there; `if (held)` for `if (held != null)` would skip the rollback check and stayed green. The junk-held arm now includes all four; that mutant measured red.
- [CONVENTION] fixed: the Validation line's "65/65" for the standing guards could not be reproduced. Re-measured at 46/46 after rebasing onto origin/main 69b8a6e0a4.
#### Iteration 19 (opus)
- [WARNING] fixed: two ws() sites in scan() (after `{`, and before the colon) had no arm; removing either refuses valid JSON the relay takes (`{ }`, `"seq" : 1`). The signing tool never writes those spellings, so only a hand-written or other-tool set is affected. Arms: unknown members `{ }` and `{\n}`, and a document with a space before every colon (with a control that the replacement changed the text). Each mutant measured red (fail 1).
#### Iteration 20 (sonnet): converged
- [NIT] recorded, no arm: shortening the weak-point match from 31 bytes to 30 survives; no realistic key separates the two.
