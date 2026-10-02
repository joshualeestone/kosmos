# #5071: browser-checks-reason-grep counts sites per check, not in two shared totals

## The call
Option 1 from the card: derive nothing new, but store the count as ONE LINE PER CHECK. `SITE_COUNTS` in
`browser-checks-reason-grep.test.js` maps `'<check>.js': [findingSites, catchSites]`, sorted by name. Both scans
assert per file (`assertSiteCounts`), and a new test keeps the table sorted, well-formed, free of [0, 0] lines and
free of checks that no longer exist.

- Rejected: option 2 (teach validation-carry.sh that an EXPECTED_SITES-only conflict is safe). It cuts the cost of the
  race and keeps the race.
- Rejected: a sidecar file (like #3929's one-name-per-line). Inside the test file it needs no new path that the bundle,
  indexing and docs guards would have to learn about, and the table sits beside the code that reads it.
- Rejected: a floor. The file's own argument holds: a floor with slack is decoration, and a matcher at zero passes it.
- The two totals' trail comments (about 350 lines of "+1 after #NNNN") are deleted. Every PR appended to them, which was
  a second conflict source on the same lines. Git history keeps them.

## Weakest premise
Two NEW checks whose names sort into the same gap (no existing line between them) still conflict. Names carry card
numbers, so that needs two checks with nearly the same name. The resolution is "keep both lines", which the sort
test then checks. Measured below.

## Measured (18:22 CDT, sitecount-5071 9fa11fed1)
- The table reproduces main's totals exactly: 182 checks, 233 finding-emit sites, 136 catch/launch sites.
- The file: 6/6 (was 5; the sort/shape test is new).
- Perturbations, each red by its own message, control green after: a new emit site in emoji-picker-2254.js ("2
  finding-emit sites matched, its SITE_COUNTS line says 1"); two lines swapped ("keep SITE_COUNTS sorted"); matcher
  drift, emitPrefixes returning nothing (every line listed); a line for a missing check ("which is not in
  docs/browser-checks"); a wrong number.
- Merge, with git merge-tree on scratch branches: two checks added far apart in sort order: CLEAN. Two in the same
  gap: CONFLICT (the weakest premise). Control, the old shape (both bump EXPECTED_SITES with a trail note): CONFLICT.

## Review
- Round 1: PENDING.
