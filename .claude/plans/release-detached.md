# release-detached: #597, the tree tested is the tree built, by construction

## Finished looks like
A pull into the shared main checkout during a cut changes nothing about what
the cut tests or builds (proven by pulling on purpose mid-run, and by the
served bundle diffing byte-identical to the sha the log names). The release
log names the sha it built. The versioned artifact's app matches that sha
apart from the baked version line.

## Why
2026-08-24: two cuts in a row (0.5.20 twice) had the main checkout
fast-forwarded by other agents' auto-sync pulls while the release ran. The
suite and page gate ran on 6bc2a1a; the bundle that shipped was 8a3688b.
Only a byte diff of the served bundle showed it. #597.

## Changes
1. `tools/release.sh`: after step 2 (the bump commit is made and pushed),
   `SHA=$(git rev-parse HEAD)`; `git worktree add --detach $BUILD $SHA` under
   a temp dir; trap removes it on every exit. `REPO` is rebound to `$BUILD`
   for steps 3 through 6 (suite, page gate, build, installer, "what we
   publish says V"). The original checkout stays in `MAIN_REPO` for step 10
   (the local board runs from it) and for nothing else. The log prints
   "building <sha> in <path>" and step 9 prints the sha again beside the
   served artifacts.
2. `tools/verify-served.sh` (if it reads the repo): compare the served
   bundle's app files against `git archive $SHA`, not against the checkout.
3. A test: `tools/test-release-detached.sh` runs the worktree-making part
   against a scratch repo, pulls a new commit into the scratch "main"
   checkout mid-way, and asserts the built tree is the bump sha.

## Not in this change
Anything about what the gates check; the site checkout's own pull behaviour.
