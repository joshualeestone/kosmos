# fsyncwrite-5434: flush before rename in the shared secure writer (slice 1 of #5434)

Card: kosmos#5434 (the class of #5431). Owner: April. Claimed 2026-10-07T00:46:26Z (UTC, claim log).

## The class
At origin/main 84 files in engine/ and server.js call renameSync and 81 have no fsyncSync (the card's count,
corrected in its review). A temp file renamed into place with no flush can be left at full length with zeroed
contents after a crash (found on a Windows box with repeated crashes, #5431).

## This slice
 `writeSecret` is the shared tmp-then-rename writer for 8 engine modules (cloudflare,
githubdevice, instructions, messages, outbox, sendertoken, tokendoor, webhooks). It now:
- flushes the temp's fd (fsyncSync) after writing and before the rename;
- flushes the directory after the rename (not on Windows, where a folder cannot be opened for this and NTFS
  journals the rename).
Both are best effort: a file system that refuses fsync must not push the write onto writeSecret's in-place
fallback, which the module's own comments call the destructive case.

## Not in this slice
- communitysend.js: Renet's tornsend-5431 changes it (#5431); not touched here.
- The other ~72 files with their own tmp-then-rename code: later slices, each read before converting
  (the card warns some renames are moves, not saves).

## Tests
`engine/securewrite.fsync-5434.test.js`: the flush comes before the rename (fails on main); off Windows the
folder is flushed after the rename (fails on main); a refused fsync still takes the atomic path (passes on
main trivially; a mutation making fsync fatal turns it red). `engine/sendertoken.test.js`'s #1761 test
counted every open under the token folder, which now includes securewrite opening the folder to flush it;
it counts opens below the folder, as its own comment intends. Tests of securewrite and its 8 users: 132
files, all passing after that change.

## Weakest premise
That fsync's cost on these writes is acceptable: they are small, infrequent records (tokens, secrets,
messages), not a hot loop. messages.js is the busiest; if a measurement ever shows the flush costs, move
that one to a batched writer rather than dropping the flush.
