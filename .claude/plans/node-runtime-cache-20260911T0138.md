# Cache the node runtime across cuts (get-cuts-out-faster #2760, lever 1)

## Why

Every cut's `tools/build-kosmos-bundle.sh` re-downloads node's ~35 MB darwin runtime from
nodejs.org (step 4), though nodejs.org publishes each version's bytes IMMUTABLY. This is the first,
safest lever of the cut wall-time work (#2760): pure caching, no flake-rate impact (unlike the
parallelism levers, which the design defers behind the render-flake gate). The per-step wall-time
instrumentation merged as #2755 gives the before/after on the next cut.

## What

In `build-kosmos-bundle.sh`'s release download path: fetch the small SHASUMS256 first, then use a
cross-cut cache dir (`${KOSMOS_NODE_CACHE:-$HOME/.cache/kosmos-node-runtime}`) keyed on the tarball's
immutable `node-v<version>-darwin-<arch>.tar.gz` name. Cache hit skips the download; cache miss
downloads and (best-effort, atomic-rename) populates the cache.

## The security invariant (load-bearing)

The cache is a SPEED optimisation, never a trust shortcut. Whatever bytes are used -- cached or freshly
downloaded -- are checksum-verified against nodejs.org's freshly-fetched SHASUMS256 BEFORE extraction,
so a stale, corrupt, or poisoned cache cannot inject a node: it fails the same checksum and the build
aborts. The download SOURCE stays hardcoded to nodejs.org (no overridable base URL), because an
overridable source would let a caller feed both the tarball and its checksums together and defeat the
verification. The cache write happens only after a checksum match and via an atomic rename, so a killed
cut never leaves a torn or unverified cache file, and a cache dir the box cannot write to never fails a
real cut.

## Verified behaviour (by hand, real bytes)

- cache empty -> downloads, verifies, populates.
- cache warm -> uses the cache, no download, verifies.
- cache poisoned (wrong bytes) -> checksum miss -> re-downloads, re-verifies, repairs the cache.
- repaired cache -> uses the cache again.
The manifest's node `download_sha256` (#776) is the verified sha in every case.

## Test

`tools/test-node-runtime-cache.sh` (wired into `test:shell`) guards the STRUCTURE that keeps the
guarantee, without a network download in the suite: the cache dir is overridable, WANT is resolved from
the fresh SHASUMS before the cache decision, the final checksum verify sits AFTER the cache-hit copy (so
a cached tarball is verified exactly like a downloaded one), and the cache is populated only after a
checksum match. Behavioural hit/miss/poison correctness was proven by hand; the wiring test is the
committed regression guard against an edit that lets a cached tarball bypass the verify.

## Next (per #2760, needs the morning cut's per-step numbers)

Parallelism levers -- node suite at low priority during the render checks, notarize-overlap -- are the
gated, flake-sensitive work; implement them on the real bottleneck once a cut prints per-step numbers.
