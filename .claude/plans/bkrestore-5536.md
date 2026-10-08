# bkrestore-5536: E0.7 (#5536) step 3, its pure part: restore a snapshot into files

Design v2.1 on #5536 and E0.6's on #5535. `engine/backuprestore.js`, on E0.6's merged backupformat.js:
- `restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk })` opens the manifest only with the device key enrolled AT THE SNAPSHOT'S TIME (the caller looks it up in E0.2's device history). Every chunk goes through `openVerifiedChunk`, every file is checked against the manifest's recorded sha256, and paths must stay inside the restored world. **Fail closed per file:** a missing, forged or swapped chunk, a throwing fetch, or a hash mismatch fails that file only, and is reported. It never writes half a file.
- `shrinkWarning(older, newer)` flags a sudden drop in file count or bytes (E0.6 v2: a person picks the snapshot, warned).
- Tests (5): byte-for-byte restore with the backup's skipped list; refusal under another device key, another context or another member key (with a control); per-file failures; unsafe paths and hash mismatch; shrink warning with controls.
- Both exports are excused in engine.reachable.test.js (caller: E0.7's restore engine, which needs E0.1/E0.2).

Weakest premise: the device key "enrolled at the snapshot time" is the caller's lookup. If E0.2's history is wrong, a manifest signed by a later device opens. That binding is E0.2's to get right, and this module cannot check it.
