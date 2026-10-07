# fsyncwrite-5434: flush before rename in the shared secure writer (slice 1 of #5434)

Card: kosmos#5434 (the class of #5431). Owner: April. Claimed 2026-10-07T00:46:26Z (UTC, claim log).

## The class
At origin/main 84 files in engine/ and server.js call renameSync and 81 have no fsyncSync (the card's count,
corrected in its review). A temp file renamed into place with no flush can be left at full length with zeroed
contents after a crash (found on a Windows box with repeated crashes, #5431).

## This slice
`engine/securewrite.js` `writeSecret` is the shared tmp-then-rename writer for 7 engine modules (cloudflare,
githubdevice, messages, outbox, sendertoken, tokendoor, webhooks; measured by grep for `writeSecret(` callers;
instructions.js imports only refuseSymlinkTarget). It now:
- flushes the temp's fd (fsyncSync) after writing and before the rename;
- flushes the directory after the rename (not on Windows, where Node cannot flush a directory; the file's
  own flush, FlushFileBuffers there, is the part #5431 needs);
- flushes on the in-place fallback too (reached only after three failed atomic attempts; it truncates
  then writes, so it is the path most exposed to a zero-filled file).
Which flush errors count: a file system that cannot flush at all (EINVAL, ENOTSUP, EOPNOTSUPP, ENOSYS
everywhere, and EPERM and EISDIR on Windows only, where some handles and volumes return them; libuv reports
ERROR_INVALID_FUNCTION from FlushFileBuffers as EISDIR, per a reading of its error table, not measured here;
those writes worked before this change) is skipped, so the write takes its usual path. Any other error (EIO, ENOSPC, EDQUOT; on a
mount that reports a failed write late, this is where it shows) fails the write AT ONCE: the temp is
removed and writeSecret throws, with no retry (a space or quota error would only recur) and no in-place
fallback (the one path that truncates the live file). If the close then fails too (NFS often repeats the
EIO there), the flush error still stands. This covers errors the FLUSH reports; the same errors reported by
a write or a close keep main's behaviour (retries, then the in-place fallback), which is a later slice of
#5434. On the fallback with no old contents to restore (no file, or one that could not be read), a refused
flush leaves the new unflushed contents, as a failed write there always did; they are not unlinked, because
an unreadable old file looks the same. The fallback flushes the file but not its folder, so a fallback that CREATED the file is not made
durable as a new folder entry (the fallback is reached only after three failed atomic attempts). The old file stays as it was. The restore of the old contents on
the fallback and the folder flush stay best effort for every error (syncDir is guarded so it cannot throw,
which is why it can stay inside the atomic try).

## Not in this slice
- communitysend.js: Renet's tornsend-5431 changes it (#5431); not touched here.
- The other ~72 files with their own tmp-then-rename code: later slices, each read before converting
  (the card warns some renames are moves, not saves).

## Tests
`engine/securewrite.fsync-5434.test.js`: the flush comes before the rename (fails on main); off Windows the
folder is flushed after the rename (fails on main); a refused fsync still takes the atomic path (passes on
main trivially; a mutation making fsync fatal turns it red). `engine/sendertoken.test.js`'s #1761 test
counted every open under the token folder, which now includes securewrite opening the folder to flush it;
it counts opens below the folder, as its own comment intends. Tests of securewrite and its callers: 132
files, all passing after that change. Also: the fallback flushes (forced with a planted temp; fails before),
and a real flush error (EIO) fails the write and keeps the old file (fails on the first version).

## Cost, measured
On this Mac (APFS, node 26.8.1, 50 writes of a small token record): 0.112 ms per write on main, 7.963 ms with
the flushes. macOS's fsync is a full drive-cache flush (F_FULLFSYNC). The callers write per action (a token
mint, a secret, an outbox entry, a long-message spill), not in a loop, so about 8 ms each is accepted.

## Weakest premise
That no caller writes through this in a loop, and that the cost elsewhere is like this Mac's: it was
measured only on APFS on an SSD. On Windows with a slow or spinning disk FlushFileBuffers can take far
longer, on the board's event loop, and that is not measured. And on a mount that cannot flush at all (the
skipped codes), this change adds no durability and no signal: those writes behave exactly as before. If one ever does (messages.js is the busiest), move that
caller to a batched writer rather than dropping the flush.
