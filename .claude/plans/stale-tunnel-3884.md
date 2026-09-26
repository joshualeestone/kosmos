# stale-tunnel-3884: a Mac cut refuses a stale prebuilt kosmos-tunnel

Card: kosmos#3884. 0.6.95 bundled a tunnel built at 19:00 from e2d5fbd; relay #145 (#3832 HSTS, crates/tunnel) merged at 21:06 and did not ship. Nothing compared the prebuilt connector with relay main.

## Call
- New `tools/lib/connector-currency.sh`: `connector_currency_check <bin> <relay-checkout>` reads the connector's `.commit` sidecar through the existing provenance check (#621), fetches kosmos-relay `origin main`, and refuses when `git diff <built> origin/main` over the build inputs is non-empty: crates/tunnel, crates/proto, Cargo.toml, Cargo.lock and tools/build-tunnel-release.sh, excluding crates/*/tests (tests do not reach the binary). The refusal lists the missing commits (`git log --no-merges built..origin/main -- <inputs>`) and the rebuild command.
- `release.sh` step **1d**, after the signing preflight and BEFORE step 2's bump, so a stale connector costs a rebuild, not a pushed bump.
- `KOSMOS_ALLOW_STALE_TUNNEL=1` (exactly 1) ships it on purpose, still listing what it lacks.
- Fails closed: an unfetchable origin, a commit the relay checkout lacks, or a path that is not a checkout all refuse.

## Rejected
- Ancestry (`merge-base --is-ancestor`), as the card worded it: a connector built from a branch, or a rebased or squash-merged main, reads wrong by ancestry. Content diff over the inputs does not.
- `crates/tunnel` alone: `crates/proto` is a path dependency, and Cargo.toml/Cargo.lock set its resolved dependency versions.
- Putting it in build-kosmos-bundle.sh: that also runs outside cuts (install harness builds), where a network fetch would be a new failure mode.

## Weakest premise
Time of check vs use: 1d checks before the suite; step 4 bundles the same path much later. A relay merge or a connector swap in between is not re-checked (accepted; the window is one cut).

Cargo.lock is conservative: a coordinator-only dependency bump also changes it and asks for a rebuild. That costs a rebuild, and the override covers a deliberate exception. If it proves noisy, narrow it to the tunnel's `cargo tree`.

## Tests
`tools/test-connector-currency-3884.sh` (wired into test:shell): 17 checks, all against a throwaway relay repo with a bare origin, no network.
- current; coordinator-only change passes
- tunnel change refuses and names that commit (not the coordinator one)
- override (exactly 1) proceeds and lists what it skips
- proto, Cargo.lock and Cargo.toml each refuse
- CONTROL: a connector rebuilt from the new main passes
- fetch failure, unknown commit, non-checkout and missing sidecar each refuse
- release.sh runs it in 1d before step 2

## Immediate state, measured 02:10 CDT 09-26
Agent1s' prebuilt connector is e2d5fbd and is STALE by this rule (relay #145 HSTS and later). The next cut needs a rebuild from relay main on a box with both rustup targets.

## Review 1
- WARNING fixed: `git fetch origin main` updates only FETCH_HEAD when the clone's refspec does not cover main, leaving a stale origin/main (false green). Now an explicit refspec `+refs/heads/main:refs/remotes/origin/main`, with GIT_TERMINAL_PROMPT=0. Test arm: a narrowed refspec on a non-main checkout, red-checked against the old fetch.
- NITs fixed: the build script is an input; tests-only paths are excluded (tested both ways); a shallow clone gets its own refusal message.

## Review 2
- WARNING fixed: the input list was a word-split string; under zsh it became one pathspec that matched nothing, so a stale connector read CURRENT (fail open). Now an array expanded as "${CONNECTOR_TUNNEL_INPUTS[@]}". The test now also runs under zsh (a zsh-unsafe `$BUILT:refs` fixed too).
- NITs fixed: the rebuild hint says pull main first; the wiring arm requires `|| exit 1`; plan count 17; time-of-check premise stated.
