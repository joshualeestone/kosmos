# codexcache-5054 - stop re-parsing whole Codex rollouts on every status refresh

Card: kosmos#5054 (bug, priority). A user's board stops answering because engine/codexsession.js
`read()` re-reads and JSON-parses the whole newest rollout file (30-100 MB) for every Codex agent on
every status refresh (about 500 MB parsed per refresh; 71% of board CPU in the user's profile). Gates
0.7.19 (Josh, 2026-10-02). Fast-update path (Splinter, extending #4601): no own full validation; merge
on a converged challenge loop + green run CI + clean merge-tree + focused tests on the merged tree; the
0.7.19 cut's suite is the full run.

## What finished looks like
- `read(dir, home)` returns exactly the same fields as before, but folds only the bytes APPENDED since
  the last read instead of re-parsing the whole file, so a 100 MB rollout costs one full parse once and
  then ~0.5 ms (a stat) per refresh while it is unchanged.
- It stays ALWAYS-fresh: a change to the rollout is reflected on the very next read (no result memo).
- Reproduced first on a 100 MB fixture, measured before and after (numbers below and on the card).

## The fix (mirrors #562's READ_CACHE for messages.jsonl)
1. **Per-rollout-file incremental cache** (`ROLLOUT_CACHE`, keyed by path): keep the parsed running
   fields plus `{ino, mtimeMs, size, offset, seam, fragment}`. On each read, `stat`; a changed inode,
   a size that went backwards, or a changed mtime at the same size drops to a full re-parse; otherwise
   read only `[offset, size)` and fold those lines. A byte-exact SEAM check guards the offset before any
   tail is trusted. The half-written last line is kept OUT of the cache and folded into the ANSWER's copy
   only when it is a whole JSON line (matching the old reader, which accepted a valid unterminated last line).
   The per-line logic is the old loop extracted verbatim into `foldRow`, so the incremental result equals
   a full re-parse.
2. **metaOf head cache** (`META_CACHE`, keyed by path): a rollout's first line (session_meta) is
   immutable and the file is uniquely named, so cache the parsed head. `forWorkdir` no longer re-opens
   and 64 KB-reads every rollout on every refresh. A transient open/read failure is NOT cached (it would
   hide a real session until restart); only a clean read is.

## Rejected
- **A short result memo** (the card's optional point 3). Built and dropped: it made `read()` up to its
  TTL stale, and the status callers and 8 existing tests rely on read() reflecting the current file
  immediately. The profile's hot spot is the full PARSE, not freshness, so point 1 is the real fix and
  the metaOf cache covers the walk without any staleness. Freshness contract preserved.

## Measured (100 MB fixture, 225,919 lines, 100 read() calls)
- BEFORE (origin/main): 116.8 ms/call; 100 calls ~11,680 ms. Every call re-parses the whole file.
- AFTER: 2.5 ms/call averaged over 100 calls (one full parse + 99 stat-only); steady-state ~0.5 ms/refresh.
- Result byte-identical before and after (model gpt-5.6-sol, window 258400, contextUsed 11700,
  messages 212363, lastAt set).

## Verify
- Unit (engine/codexsession-5054.test.js): a warm incremental read equals a fresh full parse, including a
  valid-but-unterminated last line; a genuinely partial last line is skipped until it completes; the cache
  invalidates on in-place rewrite / truncation / inode replace; read stays fresh across a change; a
  late-appearing rollout for another cwd is matched; a missing session is found:false. 10 tests.
- Load: the fixture timing above.
- Weakest premise: measured the code shape and a synthetic 100 MB fixture, not the user's exact rollouts.
  The fixture mixes response_item / turn_context / token_count / task_started rows like a real rollout, and
  the result matches a full parse, so the fold is faithful; the user's profile (kept local, never on GitHub)
  corroborates the hot spot.
