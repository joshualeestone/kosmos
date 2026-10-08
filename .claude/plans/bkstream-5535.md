# bkstream-5535: E0.6 (#5535) slice 3, a streaming chunker

## Why
`chunkBuffer` needs a whole file in memory. A work Kosmos can hold multi-GB recordings or exports (the real-tree measurement on #5535 found a 128 MB file on one Mac). The walker needs to chunk a file as it reads it, with **exactly** the same boundaries. Otherwise a file chunked by stream and the same file chunked whole would not dedup, and format 1's golden vector would not hold.

## Change (`engine/backupformat.js`)
- The cut search moves into one helper, `cutAt(buf, start, end, sizes, masks)`, used by both `chunkBuffer` and the new `createChunker`, so the two cannot drift.
- `createChunker(opts)`: `push(piece)` returns the chunks completed so far (copies), and `finish()` returns the rest. A cut is made only once `max` bytes past the chunk start are held: the same window `chunkBuffer` sees for a chunk that is not the last. So the boundaries are identical. Memory is at most one max-size chunk plus the latest piece.
- Push after finish, finish twice and a non-Buffer piece throw. An empty stream gives no chunks.
- `createChunker` is excused in engine.reachable.test.js (its caller is the slice-3 walker; the guard flagged it honestly).

## Tests
3 MB+ fed in three ways (1 byte at a time for the first 20 KB, random sizes, one piece), each the same boundaries as `chunkBuffer` and reassembling. **Format 1's golden vector streamed** in 1 MiB pieces. Plus the error cases. **Mutation:** cutting once `min + 1` bytes are held (too early) reds the boundary test.

## Weakest premise
`Buffer.concat` per push copies the pending tail each time: with small pieces that is O(n * max) work. The walker should push pieces of at least 64 KiB, so it is never the bottleneck at format 1's 4 MiB max. A ring buffer would remove the copy if measurement ever says so.

## Review round 1 (opus): no BLOCKER, 2 WARNINGs and a NIT (all test gaps; the code was correct: 0 mismatches in 3,000 random differential cases), fixed
- **The forced cut at max was never exercised** (random data always cuts before max): zeros streamed as one piece, in pieces crossing several max windows and in small pieces, each the same forced boundaries, with no chunk over max. Mutation `cutAt(pending, 0, pending.length)` now goes red.
- **The copy on push was untested** (a walker reusing its read buffer would corrupt the held tail): a pushed piece is overwritten before finish, and the output must not change. Mutation dropping the copy now goes red.
- **NIT, a tail under min:** the zeros input leaves a 100-byte tail (asserted as a precondition).
