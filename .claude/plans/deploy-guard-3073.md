# #3073: deploy-site.sh refuses a --publish from a non-main site branch

**Branch:** `deploy-guard-3073` · **Card:** kosmos#3073 (priority, investor-facing) · Filed by Splinter
from Josh's 2026-09-14 testing, for 0.6.65+.

## The regression this prevents

`chaoskosmos-site` is deployed from separate feature branches, each carrying a full `index.html`.
`deploy-site.sh --publish` ships the whole site dir, so deploying branch B clobbers branch A's
`index.html`. On 2026-09-14 a Windows-button fix (branch `drop-winsteps`) was published + verified
live, then a LATER deploy of `created-count-3038` (whose `index.html` predated the button fix)
re-published an `index.html` WITHOUT the fix, silently reverting it live while Josh had investors on
the page.

## Scope of THIS PR (the deploy-guard half)

The card has four parts; this PR does one, deliberately:
1. **Convention** ("all site changes merge to one main, deploy only from main") - endorsed; this
   guard enforces the "deploy only from main" half in tooling.
2. **Outstanding site-branch merges** (`drop-winsteps`, `created-count-3038`) - **Baron's** per the
   card, and they are chaoskosmos-site repo merges, not this monorepo. Not touched here.
3. **Deploy guard** (refuse a non-main --publish) - **this PR.**
4. **Served-verify HEAD-for-large-artifacts** ("also, minor") - **deferred.** It touches the shared
   `tools/lib/served-verify.sh` and its extraordinarily delicate mock-server test
   (`test-served-verify.sh`, seven documented closure attempts, formatting-frozen fixtures), which
   is broad-blast-radius release infrastructure Baron owns. See "Deferred" below.

## The fix

In `deploy-site.sh` preconditions, right after the SITE-is-a-git-checkout check and before any
fetch/verify/export/deploy work: a publishing run (`--publish` or `--promote`, i.e. `PUBLISH=1`)
refuses when the SITE checkout is not on its default branch. `--force` (`FORCE=1`) is the deliberate
one-off escape hatch.

- **`--force` parse:** arg parsing changed from a bare `case $1` to a loop over `"$@"`, so `--force`
  can sit in any position (`--publish --force`). The previous single-arg callers (`--publish` /
  `--promote` as `$1`) are unaffected, and an unknown arg still falls through to a dry run.
- **Default branch:** read from the site checkout's own `origin/HEAD`
  (`symbolic-ref refs/remotes/origin/HEAD`), not hardcoded `main`, falling back to `main` only when
  `origin/HEAD` is unset - so a repo whose default is not `main` still works.
- **Detached HEAD:** `symbolic-ref --quiet --short HEAD` exits non-zero; `|| true` under `set -eu`
  leaves the branch empty, which is treated as not-the-default -> refuse. Safe: a detached-HEAD
  publish is as clobber-prone as a feature-branch one.
- **Dry run unaffected:** the guard is gated on `PUBLISH=1`, so a dry run (which deploys nothing)
  runs from any branch.

## Tests

`tools/test-deploy-site-branch-guard-3073.sh`, wired into the `test:shell` chain in package.json
(that chain is a hardcoded `&&` list, not a glob, so a new test must be added explicitly; `yarn test`
-> run-tests.sh runs `yarn -s test:shell`, so the challenge-loop validation exercises it):
- **Source pins:** `--force` is parsed; the guard is gated on `PUBLISH=1 && FORCE!=1` (so a dry run
  and a `--force` run both skip it); the default branch is read from `origin/HEAD`, not hardcoded.
- **Runtime, against a fake $SITE checkout:** a feature-branch `--publish` refuses (rc!=0) with the
  #3073 message; a default-branch `--publish` does NOT hit the guard (control - proves the refusal is
  branch-specific, not unconditional, so the refuse test is not vacuous); `--force` overrides; a dry
  run is unaffected.
- **origin/HEAD-derived default (runtime):** a fabricated `origin/HEAD=trunk` site publishes fine
  when ON `trunk` (the default is READ from origin/HEAD, not hardcoded), and its control - the SAME
  trunk-default site ON `main` - is REFUSED (main is not the default here), proving the default is
  derived rather than a hardcoded `main`.

## Fixture pin (a consequence of the guard, caught in review)

The guard reads the SITE's default from `origin/HEAD` and falls back to `main` when it is unset. The
existing deploy-site tests build a fake `$SITE` with a bare `git init` and no origin, so the fallback
is `main` while the fixture's branch was whatever the ambient `git init.defaultBranch` produced - on
a box/CI where that is not `main`, the guard would refuse the fixtures' publishing runs. So all four
fixture inits (`test-deploy-site-exit0-2791.sh`, `test-deploy-site-promote.sh` x2,
`test-deploy-site-winderive.sh`) are pinned to `git init --initial-branch=main` (the established
pattern from `test-release-detached.sh`), proven under `GIT_CONFIG_GLOBAL` forcing
`init.defaultBranch=master`. Precisely: the pins in exit0-2791 (runs `--publish`) and promote (runs
`--promote`) are LOAD-BEARING (the guard fires there); the winderive pin is defensive consistency
only, because winderive invokes deploy-site.sh as a dry run and the guard never fires on a dry run.

## Ownership / merge posture

`tools/deploy-site.sh` carries Baron's explicit ownership marker ("Baron owns the release/deploy
pipeline and reviewed the --publish path", blessed 2026-09-03, #2014), and `--publish` is a live
`vercel deploy --prod` on the investor-facing site. So although the Kosmos convention is
merge-own-green, this PR REQUESTS Baron's review before merge rather than auto-merging - a
deliberate deviation for another owner's blessed, safety-critical, investor-facing script. Nothing
live changes until he approves; the work exists tonight for his review (Splinter's night-shift
directive to keep forward motion, without unilaterally landing on his pipeline).

## Deferred (part 4), with reasoning

The served-verify item: `served_verify_asset_ok` (served-verify.sh:291) does a full GET
(`curl -o /dev/null --max-time 30`) to read the content-type, so on a slow link the 37MB Windows
zip's body download blows the 30s cap and the function fails a deploy that actually served. The card
suggests a HEAD/content-length check for large artifacts (or raising the cap). That is the right fix,
but it changes a shared release lib and requires extending `test-served-verify.sh` (a mock-server
test whose Python fixtures are formatting-frozen and which has a documented history of a guard being
widened seven times) with HEAD support. That is Baron-owned release infrastructure and higher-risk
than a midnight best-effort warrants; doing it as its own reviewed change (his, or a scoped
follow-up) is safer than bundling it here. The deploy-guard is the fix for the reported regression;
the served-verify is a separate robustness item.

## Weakest premise

That deferring part 4 is right rather than stopping-short. The deploy-guard alone prevents the
investor-facing clobber (the actual regression); the served-verify only prevents a false-negative
deploy FAILURE (annoying, not a live regression), and doing it wrong on shared release infra could
introduce a real one. If Baron wants both in one change, this PR is easy to extend under his review.
