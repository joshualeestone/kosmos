# wnwin-8924: the What's New pool retires a Windows-only line once Windows prod has shown it (kosmos#8924)

## Problem

`tools/whats-new-pool.js build` marks highlights shown only from what Mac prod serves (#5713). A Windows-only highlight (tagged windows, not mac) is hidden on the Mac, so it never retired: the header said to retire it by hand once Windows prod had shown it. That was needed in two cuts running (0.8.16's one line, 0.8.17's two), and one miss tells Windows users the same change twice. Nothing checked it.

## Decisions

- A Windows twin of the Mac sync, run by `build` after it: `latest-win.json` gives the version and arch; the manifest is named from them (`kosmos-<v>-win-<arch>.manifest.json`, as the Windows build names it, since the pointer names no manifest); its `app.commit` and the What's New at that commit (or a file whose `also` lists the version) give what Windows prod showed.
- `markShownWin` marks only pending lines tagged windows and not mac. A line every platform shows stays recorded by the Mac promote, as before. The record is a new `lastProdWin`, kept apart from `lastProd`.
- The same refusals as the Mac, writing nothing: no pointer, no manifest, no app commit, a dirty build, no window at that commit, or a Windows-only title the pool lacks (reworded after the build).
- `prod-check` also refuses (3) when Windows prod is newer than `lastProdWin`, and answers 4 when the Windows pointer cannot be read, so the cut's step 1b-ii sees it.
- The Windows pointer defaults to the live site; `KOSMOS_PROD_WIN_POINTER_URL` overrides it; with only `KOSMOS_PROD_POINTER_URL` set it is read from the same folder, so a test that fakes Mac prod never reaches the live site for Windows.

- **The first cut after merge (review 1).** The pool ships with `lastProdWin: "0.8.16"`, which is what a live build recorded: Windows prod serves 0.8.16, and that window's two Windows-only lines were already retired by hand in 0.8.17's pool. Without it, main's next `prod-check` would refuse (3) until someone built and committed. A Windows promote of 0.8.17 later moves it on the next build.
- One helper, `shownAt`, reads what a version showed at its commit for both syncs (review 1: the two copies could drift).

## Rejected

- Recording Windows promotes from `promote-channel.sh --family win`: it needs a write from the Windows PC's path into this repo. Reading what Windows prod serves at build time is the pull model the Mac already uses.
- Treating an unreadable Windows pointer as nothing to record: convenient, and it fails silently, which is the failure this card closes.

## Tests

- `tools.whats-new-pool-win-8924.test.js` (6 tests): a Windows-only line in Windows prod's window retires with shownIn the Windows version, while Mac-only and untagged lines in the same window and a Windows-only line outside it stay pending; a recorded pool writes nothing (control: one a version behind syncs); every unreadable case refuses and writes nothing; the pointer URL derivation; prod-check 0/3/4; through build, a Windows refusal after a no-op Mac sync claims nothing and writes nothing (control: --offline builds).
- Mutant: marking every title instead of only Windows-only ones fails the first test.
- `tools.whats-new-pool-sync-5713.test.js` and `tools.release-gate.test.js`: fixtures gain a Windows pointer (and `lastProdWin` where a pool is meant to be fully recorded); the real-0.7.35 refusal now names both records. 104/104 across the three files.
- Live, read only: on a copy of main's pool with 0.8.17's two hand-retired lines set back to pending, `build` against real Windows prod 0.8.16 retired both with shownIn 0.8.16; on main's pool as it is, it records lastProdWin 0.8.16 and marks 0.

## Weakest premise

That blocking a Mac What's New build on the Windows pointer being readable is acceptable. Both pointers are served by the same site, so in practice they fail together, and --offline is the way through.
