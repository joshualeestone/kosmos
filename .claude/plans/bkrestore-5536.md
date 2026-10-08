# bkrestore-5536: E0.7 (#5536) step 3, its pure part: restore a snapshot into files

Design v2.1 on #5536 and E0.6's on #5535. `engine/backuprestore.js`, on E0.6's merged backupformat.js:
- `restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk, sink })` (async) opens the manifest only with the device key enrolled AT THE SNAPSHOT'S TIME (the caller looks it up in E0.2's device history). Every chunk goes through `openVerifiedChunk`; every file is checked against the manifest's recorded size and sha256. `fetchChunk` may be async. Files stream through a caller-supplied `sink` (`begin(path)` -> `write`, `commit`, `abort`), one chunk at a time, so a file larger than memory restores; a file is committed only after all of it verified.
- **Fail closed per file:** a missing, foreign, swapped or unfetchable chunk, a malformed chunk name (never handed to the fetch), a size or hash mismatch, or a failed write aborts that file only, and is reported.
- **Paths:** plain relative paths only. Refused: absolute, UNC, drive or stream colons anywhere, control characters, empty segments, segments ending in a dot or space (so `.` and `..`), Windows device names (also with spaces before the extension), NTFS 8.3 short-name shapes (`PROGRA~1`; a Mac file named like `doc~1.txt` is lost, accepted), lone surrogates, C1 controls and line separators, bidi controls and marks (LRM, RLM, ALM). Segment rules apply both as written and with invisible characters dropped (so `..` plus a zero-width space is refused). Invisible characters are otherwise NOT refused (emoji names use ZWJ and VS16); they are dropped from the collision key instead. Colliding entries (exact, invisible-stripped, lower-upper-lower-cased, NFC, `\` as `/`, or a file that is another entry's folder) are ALL refused, not first-wins. That approximates APFS/NTFS name matching; it is not exact, so the sink must also refuse to overwrite a file it already wrote.
- `shrinkWarning(older, newer)` flags a sudden drop in file count or bytes (E0.6 v2: a person picks the snapshot, warned). It reads the manifests the device wrote, so it is a heuristic against an accidental shrink, not a defence against a device padding its manifest.
- The sink contract is stated in the JSDoc: bytes land before verification, so the sink writes beside the final path and publishes atomically on commit. A fetched object larger than any format-1 chunk (2 x CDC.max + 4 KiB) is refused before decrypting.
- The sink also owns two duties stated in the JSDoc: refuse to overwrite a file it already committed in this restore, and refuse a path that resolves outside the restore root (an existing symlink). It is handed '/' separators.
- Bounded work for a hostile manifest: the manifest object is bounded (128 MiB) before it is opened and its entry count (500,000) before it is walked (both raisable by the caller), a REQUIRED maxTotalBytes (set from free disk; a restore without one is refused) fails a file before fetching once the restore would pass it, collisions are found with a segment trie (linear), a file may not list more chunks than bytes, an empty chunk is refused, and the skipped list is capped (10000 entries, 300 characters each).
- Tests (17), each refusal with a control; every new guard mutation-checked red.
- Both exports are excused in engine.reachable.test.js (caller: E0.7's restore engine, which needs E0.1/E0.2).

Weakest premise: the device key "enrolled at the snapshot time" is the caller's lookup. If E0.2's history is wrong, a manifest signed by a later device opens. That binding is E0.2's to get right, and this module cannot check it.

Review round 1 (opus): fetch was sync-only (an async reject crashed), whole files were held in memory, chunk names reached the fetch unchecked, size was never checked, Windows-unsafe names and colliding paths restored. All fixed as above.

Review round 2 (sonnet): lone surrogates collided after UTF-8 encoding; no cap on a fetched object before decrypting; the sink contract was unstated; the collision wording overclaimed. Fixed; also Uint8Array accepted, skipped list filtered, throwing commit/abort tested.

Review round 3 (opus): final sigma escaped the collision key (now upper- then lower-cased, NFC both sides); two sink duties were only in an internal comment. Fixed, plus '/' to the sink, bounded refused paths, an empty-file test. Not done: refusing Windows-forbidden characters (`?`, `*`, `"` are legal and common in Mac names; a Windows sink fails those files closed).

Review round 4 (sonnet): quadratic collision check (4.6 s for 400 deep entries; now 0.17 s), round 2's invisible-character refusal dropped real emoji names (reversed: strip for collisions instead), C1 and line separators passed, zero-byte chunks allowed unbounded fetches. Fixed.

Review round 5 (opus): segment rules ran only on the raw segment (`..` + ZWSP passed), `nul .txt` passed, 8.3 short names could defeat a path-tracking sink. Fixed; the sink contract now says identity is by file ID, and that a Mac name holding `\` comes back as a folder.

Review round 6 (sonnet): the manifest itself had no size or entry bound (a compromised enrolled device could blow up a restore). Fixed; also every reported path bounded, recorded hash shape checked, the Windows device-name variants tested.

Review round 7 (opus): a valid manifest passed as a plain Uint8Array read as tampered. Fixed; also bidi marks refused, a Unicode-API duty for the sink (fullwidth dots), the timing test widened (measured 0.94 s trie vs 22.8 s for the old quadratic check), plan wording corrected.
**REQUIRED in the next slice (the real sink), before restore is wired to anything:** conformance tests for each sink duty in the JSDoc: no write at the final path before commit and atomic publish; refuse overwriting a file committed in this restore, by file identity; refuse a path resolving outside the root through an existing symlink; Unicode file APIs on Windows. This slice's memorySink satisfies none of them, so nothing here checks them.

Review round 8 (sonnet): the 512 MiB manifest bound was far above what a parse-whole manifest should take (now 128 MiB / 500,000 entries); no aggregate byte budget (now maxTotalBytes); sink duties untested here (recorded above as required for the next slice, and on #5536).

Review round 9 (opus): the byte budget defaulted to unbounded (now required); capital sharp s escaped the fold (now lower-upper-lower). Fixed; begin throwing now tested. Kept the timing test at 2000 entries: at 1000x1000 the quadratic check would pass its bound.
