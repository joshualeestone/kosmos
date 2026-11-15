# cutleftover2-8563: release.sh leftovers check, the follow-ups after #8562's review cap

Addresses kosmos#8563 (Renet's leftovers from #8562 / PR #8565, 46f9bf0bc6). Small and reversible: a release-tool change, no product code.

## Done
1. **A served version's committed Mac manifest is read at step 1g.** `release_leftovers_clear` now reads the host when the site has a COMMITTED `dist/kosmos-<V>-arm64.manifest.json`, even with no leftover file. That file exists only once a cut of <V> reached step 7b here. Served: refused at 1g ("bump the version"), not at 7b about two hours in, after step 4b had overwritten that manifest in the working tree. Never served: the cut goes on, with one line saying so; step 4b replaces the manifest and 7b commits it again. Unknown (host down, a control fails): refused, like every other unknown, and the way-on line no longer tells you to move files when there are none.
2. **The guard's refusal is true at 7b.** `release_leftovers_guard_deploy` takes an optional stage (`7b` or `8`, default 8). At 7b it runs before the site commit, so the refusal says nothing was deployed and nothing was pushed; at step 8 it keeps "its site commit from step 7b stays pushed". `_vdep_served_check` passes the stage at each call (7b; 8 before vercel and before each retry).
3. **Nits:** the 7b block now sits above the "`|| exit 1` is load-bearing" comment, which again sits on the `SITE_SHA=` line it protects. docs/releasing.md says "at least two minutes (up to about eight when every read times out)": 12 reads at a 30 s timeout plus 11 pauses of 10 s. test-setup-staging-5032's "region ends at or before step 2" arm could not fail (step 2's own marker always qualifies); it no longer prints a PASS, only stops a broken extraction, and the content check below it is the real guard.

## Tests
`tools/test-release-leftovers-8562.sh`, 45 checks: new cases 22 (served / never served / host down with a committed Mac manifest and no leftover) and 23 (7b vs 8 wording); case 21 pins `_vdep_served_check 7b` before the site commit and `_vdep_served_check 8` before vercel and in the retry hook. Cases 1 and 11 now start from a site with no committed 0.8.05 manifest (`nov`), because "nothing of <V> is here" is what they test. Red-capable: against main's library the four new behaviour checks fail and the rest pass. test-vercel-refusal-7711 follows the retry line; test-deploy-landed-5471 unchanged and green.

## Not done, on purpose
- **The trap restoring tracked manifests it changed** (the card's "and/or"). With item 1, a re-cut of a SERVED version stops at 1g before 4b touches the manifest, which is the case the card describes. A cut of a never-served version that dies after 4b leaves a modified manifest that the next cut of that version overwrites anyway. Adding a restore to the EXIT trap widens what an abort touches in the site tree, for no case left open.
- **Running `_vdep_served_check`'s body in a test.** It is two calls of the guard, which the test runs in every outcome; the body is pinned by grep (call shape, both families, the stage at each call site). Running it would mean extracting a release.sh region into a harness for a two-line wrapper.

## Weakest premise
That a committed Mac manifest of <V> is reliable evidence a cut of <V> reached 7b in this checkout. A hand-made site commit carrying one would also trigger the host read, which is harmless: it only makes 1g ask the host.

## Would change my mind
A cut of a never-served version that 1g now refuses although the host answered cleanly: that would mean the arm64 path is stricter than the Linux one where it should not be.
