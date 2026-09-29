# bcfn-fix-4119: fixes from the after-the-fact challenge loop on #4532 (#4119)

#4529 and #4532 merged on 2026-09-29 without /challenge-loop (the account they were built on lacked the
skill and the pre-challenge-gate hook; Liu Kang m3328/m3339 asked for the loop after the fact, with fixes in
follow-up PRs). Iteration 1 of that loop (a blind reviewer over 7b8b45371 and 010ece544) found:

1. tools/bc-pr-select.js's header said the page index is read from the working tree. Since #4532 the page is
   read at `head`. Fixed: the header says which inputs come from where.
2. functionRange ended a body only at a line that is exactly `<indent>}`. A closer with `;` or a trailing
   comment, or a one-line function, made it run on to a later function's `}` and claim that body too (silent
   over-selection), or return null and read as "not on the page". The guard test only asserted non-null.
   Fixed: the closer may carry `;` and a `//` comment; a one-line function is its own range; the scan stops
   at the next declaration at the same indentation and answers 'unclosed', which selects the check with the
   reason "its end was not found". The guard test now also asserts each declared range is tight (no other
   declaration at that indentation inside it).
3. touchedLines counted every file's hunks and placed a -U0 pure deletion one line early. Fixed: only the
   page's hunks count, and a `+N,0` hunk sits after head line N. main() diffs only web/index.html with
   default context, so production was unaffected; select() and touchedLines are exported.
4. README: the declaration must fit on one line (declaredFunctions reads the first matching line).

Not changed, with reasons:
- The slow "through select()" test (about 13 s): its coverage is right; speed is not a defect.
- #4529's 20 ms cache-hit floor is a timing proxy; a cache-miss signal (indexBuilds) would be exact. Noted
  on #4189, not changed here.
- Neither merged commit had its own plan file; this file records both.

Weakest part: the range finder still reads indentation, not syntax. A body whose own inner block closes at the
declaration's indentation would end early. The tight-range guard cannot see an early end, only a late one.
