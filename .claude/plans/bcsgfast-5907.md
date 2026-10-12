# bcsgfast-5907: the browser-check surface gate decides every check in one pass (#5907)

Card: joshualeestone/kosmos#5907 (validation queue waits). The surface gate (#2518, `tools/lib/browser-check-surface-gate.sh`)
runs in every full validation and about 15 times in its own test (`tools/test-browser-check-surface-gate.sh`, 112-167 s
in the shell stage). One call took ~10-17 s: per check (about 300) it started ~7 processes (the annotation `sed`, two
escape `sed`s, a `grep` of the changed files, a `sed` of the trailers) and per token (about 1,000) two more (the escape
`sed` and the boundary `grep`), about 4,200 processes a call.

## The change
- `bc_surface_scan_checks` in the shared lib (`browser-check-surface-lib.sh`, beside the two primitives it must agree
  with; only the gate calls it, `bc-surface-map.sh` still uses the primitives): one awk pass reads every check's FIRST annotation line (as `bc_surface_tokens_of`'s `sed | head -1`)
  and the changed text's maximal runs of `[A-Za-z0-9_-]`, and prints per check, in find's order:
  `HIT <first plain token found>`, `MISS` (every token plain, none found), or `SLOW` (a non-plain token comes first).
  A plain token occurs whole exactly when it is one of those runs, which is `bc_surface_token_hits`'s boundary.
- The gate's loop reads that: a MISS check is skipped outright when no `Browser-check-surface:` trailer exists at all
  (it could neither violate nor print an override line); every other check runs the same updated-file test, the same
  override `sed`, then the HIT verdict or, for SLOW, the original per-token loop. If the scan cannot run, every check
  takes the original path.

## Proof
- Old gate (origin/main) against new, on the same inputs: 38 web diffs (35 real declared tokens sampled every 25th,
  one unmapped id, one non-plain `data-pmark="xai"` line, an empty diff) times 4 (check updated or not, trailer or not):
  152 runs, 144 refusals, **stdout, stderr and exit code identical in all 152** (`cmp`). Identical on valid UTF-8;
  a review's own 100-combination edge set (CRLF, tabs, case, whitespace-only lines, trailers) agreed too.
- One call, interleaved on the same load: 10.4 s and 9.1 s before, 0.3 s and 0.2 s after.
- `tools/test-browser-check-surface-gate.sh` and `tools/test-bc-surface-map.sh`: 0 failed.
- A SCAN arm in the gate's test holds the scan to the per-token primitives on every 10th real check (36 cases: its
  first token touched, and nothing mapped touched), on a plain token inside runs joined by `_`, `-` and capitals, and
  checks a non-plain token is left SLOW. Mutations: dropping `_`, `-` or capitals from the scan's class each go red.

- A line that carries the key in a shape the C-locale match refuses (measured: a U+00A0 before `//` or before the key,
  which macOS sed in a UTF-8 locale reads as space) sends that check to the per-check path, so the scan never hides an
  annotation the sed would read. Today the scan prints 175 lines for the 346 check files (173 annotated): 171 MISS
  and 4 SLOW, 2 of those 4 being prose mentions of the key with no annotation.
- Test arms: a later token as the only hit and both hit (the first is named); the Unicode-space line left SLOW; the
  fallback (a TMPDIR the scan cannot write) gives the gate the same words and exit as the scan path. Each mutation-checked.

## Rejected
- Rewriting the whole gate in awk: the override and updated-file paths (and their exact messages) stay in shell,
  unchanged, so only the token decision moved.

## Weakest premises
- An interrupt mid-scan leaves its three small, mktemp-named temp files; a trap inside a sourced function would replace
  the caller's own, so none is set.
- The scan reads in the C locale; the original `grep`/`sed` read in the ambient one. On INVALID UTF-8 (a byte in the
  changed web text, or in a check file above or on its annotation line) the new gate can refuse where the old passed:
  stricter, never looser; stderr differs too (the old sed printed `illegal byte sequence` and passed that check). The
  346 checks and web/index.html are valid UTF-8 today.
- A check file with a tab in its path would not parse (none has one).
