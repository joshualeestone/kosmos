# buildver-7281: the Linux bundle's VERSION node line under macOS bash 3.2 (kosmos#7281)

## Why
The 0.7.71 Linux cut rehearsal (Splinter's ask, #7281 comment 6436756430) ran tools/build-kosmos-linux.sh on a Mac
whose `bash` is /bin/bash 3.2. Line 261 put a `case "$NODE_SHA" in unchecked:*) ... esac` inside `$( )`; bash 3.2
ends the substitution at the bare pattern's `)`, prints a syntax error, the build still exits 0, and every bundle
ships `node:   v24.19.0 (linux-x64) echo ' UNCHECKED (test build)';; esac)` in VERSION, on a checked build.
The manifest is unaffected. setup.sh copies VERSION into the install.

## Change
1. tools/build-kosmos-linux.sh: compute the suffix in `_node_note` before the VERSION block. Same output on bash 5.
2. tools.build-linux-7281.test.js:
   - CONTROL asserts the exact VERSION node line (it builds with an unchecked node) and no "syntax error" on stderr.
   - a source check: no `$( case ... in <bare pattern>` in the Linux builder (Linux CI runs bash 5 and cannot
     see the parse failure).

## Proof
- 10/10 with the fix; with main's builder restored, CONTROL and the source check fail (8/2).
- Sweep: the only other `$(case` in a tracked .sh is tools/test-queued-heavy-4977.sh:534, which uses `(pattern)`
  (bash-3.2 safe).

## Not done, on purpose
- No repo-wide guard: one instance, and the other hit is safe; widening would be speculative.
