# pkg-1670-retry-main: land the #1670 bounded-retry on main

**Branch:** `pkg-1670-retry-main` (off origin/main). **Lane:** release/deploy pipeline (#2014, Baron).

## Why this exists

During the 2026-09-15 P0 installer incident, the emergency patched Kosmos.pkg (sha 893e8d86) was
built carrying TWO fixes: ICK's resolver session-gate removal (resolve-install-user.sh, shipped via
ICK's own PR) and this #1670 bounded-retry (install/pkg-scripts/postinstall). Both were baked into
the served pkg but neither was on main. A future cut from main would rebuild the pkg from main's old
scripts and REGRESS the installer. This branch lands the #1670 half on main so main equals the
served fix. (ICK's PR lands the resolver half; this branch is resolver-free to avoid duplication.)

## The change

`install/pkg-scripts/postinstall` (#1670 checksum gate): the pkg fetches /setup and /setup.sha256
and refuses the install on any mismatch or unreachable checksum. It did a SINGLE fetch then exit 1,
turning a transient half-published / half-warmed-CDN window into a hard "installation failed". This
wraps the fetch+verify in a bounded retry (default 5 attempts / 3s pause): a transient inconsistency
self-heals within seconds, while a PERSISTENT mismatch or persistently-missing checksum still
refuses after the retries. #1670's threat model (fail-closed on a real half-published/corrupt state)
is unchanged. Retry count/pause are env-tunable for the test (KOSMOS_PKG_RETRY_MAX/_SLEEP), digit-
sanitised, and stripped by `sudo -u -H` in a real install so production always uses the defaults.

`tools/test-pkg-checksum-1670.sh`: adds ARM 4 (a transient mismatch that then matches RECOVERS and
runs) via a deterministic wrong-then-right origin, updates the absent-checksum message assertion to
the new wording, and drives the loop fast via the env knobs.

## Scope / non-goals

- No resolver change here (ICK's separate PR owns resolve-install-user.sh).
- Pairs with the publish-side vercel.json no-store hardening (chaoskosmos-site#125) which closes the
  same transient window from the serve side; defense in depth.

## Weakest premise

That 5 attempts / 3s (~12s worst case) is the right budget. Long enough to ride out a Vercel edge
propagation window, short enough that the Installer progress bar covers it as a named wait. If a
future cut shows the window is longer, bump KOSMOS_PKG_RETRY_MAX's default.
