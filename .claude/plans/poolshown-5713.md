# poolshown-5713: What's New records what Mac prod showed, with no hand step (kosmos#5713)

## Done looks like
After a Mac PROD promote nobody runs anything by hand, and no highlight prod already showed is offered again.

## Decided (call on the card)
- `whats-new-pool.js build` (run by hand before each cut, committed to main) first reads Mac prod's pointer and, if
  its version is newer than the pool's lastProd, the manifest's app.commit (the cut's frozen sha), then marks that
  version's highlights shown at that commit (Mac rules; an "also" file counts; a dirty build is refused) and writes the
  pool. A refusal after the sync says to commit the pool. --offline skips, and says so.
- The cut's step 1b-ii runs a read-only `prod-check` (pointer only): refuses when prod is newer than the pool records,
  notes and continues when prod cannot be read, refuses when the pool or tool is broken.
- `shown <v> --promoted --none` records a prod version that shipped with no What's New, so lastProd can pass it.
- Rejected: running `shown` from promote-channel.sh (it works in the site checkout; pushing kosmos main from a release
  script is risky, and it would need the frozen sha handed to it).
- Weakest premise: lastProd moves at the next build, not at the promote; two promotes between builds record only the
  served one (the note says how to record the other).
