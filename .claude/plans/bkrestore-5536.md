# bkrestore-5536: E0.7 (#5536) step 3, its pure part: restore a snapshot into files

Design v2.1 on #5536 and E0.6's on #5535. `engine/backuprestore.js`, on E0.6's merged backupformat.js:
- `restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk, sink })` (async) opens the manifest only with the device key enrolled AT THE SNAPSHOT'S TIME (the caller looks it up in E0.2's device history). Every chunk goes through `openVerifiedChunk`; every file is checked against the manifest's recorded size and sha256. `fetchChunk` may be async. Files stream through a caller-supplied `sink` (`begin(path)` -> `write`, `commit`, `abort`), one chunk at a time, so a file larger than memory restores; a file is committed only after all of it verified.
- **Fail closed per file:** a missing, foreign, swapped or unfetchable chunk, a malformed chunk name (never handed to the fetch), a size or hash mismatch, or a failed write aborts that file only, and is reported.
- **Paths:** plain relative paths only. Refused: absolute, UNC, drive or stream colons anywhere, control characters, empty segments, segments ending in a dot or space (so `.` and `..`), Windows device names, lone surrogates, invisible (default-ignorable) characters. Colliding entries (exact, lower-cased, NFC, `\` as `/`, or a file that is another entry's folder) are ALL refused, not first-wins. That approximates APFS/NTFS name matching; it is not exact, so the sink must also refuse to overwrite a file it already wrote.
- `shrinkWarning(older, newer)` flags a sudden drop in file count or bytes (E0.6 v2: a person picks the snapshot, warned). It reads the manifests the device wrote, so it is a heuristic against an accidental shrink, not a defence against a device padding its manifest.
- The sink contract is stated in the JSDoc: bytes land before verification, so the sink writes beside the final path and publishes atomically on commit. A fetched object larger than any format-1 chunk (2 x CDC.max + 4 KiB) is refused before decrypting.
- Tests (12), each refusal with a control; every new guard mutation-checked red.
- Both exports are excused in engine.reachable.test.js (caller: E0.7's restore engine, which needs E0.1/E0.2).

Weakest premise: the device key "enrolled at the snapshot time" is the caller's lookup. If E0.2's history is wrong, a manifest signed by a later device opens. That binding is E0.2's to get right, and this module cannot check it.

Review round 1 (opus): fetch was sync-only (an async reject crashed), whole files were held in memory, chunk names reached the fetch unchecked, size was never checked, Windows-unsafe names and colliding paths restored. All fixed as above.

Review round 2 (sonnet): lone surrogates collided after UTF-8 encoding; no cap on a fetched object before decrypting; the sink contract was unstated; the collision wording overclaimed. Fixed; also Uint8Array accepted, skipped list filtered, throwing commit/abort tested.
