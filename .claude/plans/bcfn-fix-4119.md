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
   reason "its end was not found". The declared-function test also asserts each declared range is one
   balanced body (braces balance once strings and // comments are removed), independent of how the finder picks
   its end. Measured by a mutation run (the finder made to end each body one line early): it fails when the finder ends a body early (the unsafe direction, under-selection);
   it does NOT fail when a range runs on over code that is itself balanced (over-selection, the safe direction).
   Found by iteration 2: the first version of that assertion reused the finder's own stop rule and could not fail.
3. touchedLines counted every file's hunks (and, once it filtered, needed git's default a/ b/ prefixes; main() now
   pins them and the filter accepts web/index.html with or without the b/ prefix) and placed a -U0 pure deletion one line early. Fixed: only the
   page's hunks count, and a `+N,0` hunk sits after head line N. main() diffs only web/index.html with
   default context, so production was unaffected (select() and touchedLines were already exported on main;
   this branch adds the export pageAt). main()'s git diff also pins -c diff.suppressBlankEmpty=false,
   --no-ext-diff, --no-textconv and --no-color, so user git config cannot change the headers or line numbers
   touchedLines reads.
4. README: the declaration must fit on one line (declaredFunctions reads the first matching line).
5. A declared name the page declares more than once (nested ones included) is 'duplicate': it selects the
   check on every page diff with the reason "declared more than once on the page", and the declared-function
   test fails until the name is unique. JavaScript runs the last declaration, so no single body is the check's.
6. pageAt(head) reads the page at head. A head without web/index.html (the PR deleted or moved it) reads as an
   empty page, so every declaring check selects; any other git failure (a bad ref) throws, main() exits 2, and
   the job fails loudly. Tested with HEAD, git's empty tree and a bad ref.

Not changed, with reasons:
- The slow "through select()" test (about 13 s): its coverage is right; speed is not a defect.
- #4529's 20 ms cache-hit floor is a timing proxy; a cache-miss signal (indexBuilds) would be exact. Noted
  on #4189, not changed here.
- Neither merged commit had its own plan file; this file records both.

Weakest part: the range finder still reads indentation, not syntax. A body whose own inner block closes at the
declaration's indentation would end early (under-selection), and regex literals are not parsed (a quote inside one would mislead the one-line check; the unpaired-quote
guard sends such a line to the multi-line scan instead). The balanced-body assertion catches that for
every function a check declares today; it does not guard a function declared later until its test runs, and it
cannot see a range that runs on over balanced code (over-selection, the safe side). The one-line indentation
assertion does not fire today (both declarations are multi-line); it is a guard for a future one-line
declaration, not current coverage.
