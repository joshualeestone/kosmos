# jemalloc-4367: the tmux bundle's notices cover jemalloc

## Why
Homebrew tmux 3.7c links libjemalloc.2.dylib, and tools/build-tmux-bundle.sh (rightly) refuses a bundled dylib
with no notice (Mortals, 10:42 CDT, building a KOSMOS_ALLOW_MINOS test bundle for #4362). Baron handed it to me
(11:01) and read jemalloc's COPYING off Mortals' bottle: jemalloc 5.3.1, sha256 94aa2caa...0268b53, 27 lines.

## Measured before building
Release cuts are not affected: release.sh reuses the served tmux pair, and a fresh releasable bundle comes from
build-tmux-from-source.sh (tmux 3.5a, no jemalloc). Only Homebrew-based test bundles hit this.

## The change
tools/third-party-notices.txt gains a jemalloc entry in the file's own format: the BSD 2-clause COPYING verbatim
(byte-checked against the bottle's file), with a line saying it is present only when the bundled tmux links
jemalloc. The check itself is unchanged and stays fail-closed.

## Checks
The gate's own name-derivation expression, read out of build-tmux-bundle.sh, applied to real dylib names:
libjemalloc: main REFUSE, branch pass. libevent_core, libncursesw, libutf8proc: pass on both. An unknown
libfoobar: REFUSE on both (fail-closed kept). Text only: no code path changes, so the full suite is left to CI.

## Not done here, and who can
The end-to-end build (KOSMOS_ALLOW_MINOS=1 tools/build-tmux-bundle.sh dist with Homebrew tmux 3.7c) needs a box
with that Homebrew; this Mac has 3.6a without jemalloc. Mortals can run it after merge.

## Weakest premise
That 5.3.1's COPYING covers the bottle's binary: Homebrew builds jemalloc from upstream source with no added
licence, so its COPYING is the licence.

## Review 1
- CONVENTION the entry keeps COPYING's own 80-dash separators and "Unless otherwise specified" header, where the
  file's entries use 72-dash separators --> NOT CHANGED, deliberately: the text is jemalloc's COPYING byte for byte,
  and this repo treats verbatim licence texts as the authoritative ones (build-tmux-bundle.sh's own comment: the
  typed summaries missed clauses before). Trimming it to our format trades exactness for looks.
- NIT "EVENT" in licence boilerplate already satisfies the libevent_core name match in origin/main (3 hits
  before this change) --> NOTED, not introduced here.
- Verified by the reviewer: byte-identical to the bottle's COPYING; release bundles never contain jemalloc; the
  derived name is exactly `jemalloc`; the self-qualifying note is accurate in a shipped non-jemalloc tarball.
