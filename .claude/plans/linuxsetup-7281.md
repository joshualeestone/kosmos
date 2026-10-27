# kosmos#7281 slice B: setup.sh installs the Linux family (branch linuxsetup-7281)

The whole plan is in the card's comment 6431703337 and on branch linuxbundle-7281 (.claude/plans/linuxbundle-7281.md).

## Review 1 (2026-10-26 21:5x): 1 blocker, 2 warnings, 3 nits
- BLOCKER FIXED: the family was decided from the network pointer even for a local copy (KOSMOS_SRC); the Linux CI
  job (test-linux-setup-4920) installs the checkout that way with no runtime, so it would break the day the Linux
  pointer publishes. KOSMOS_SRC and KOSMOS_BUNDLE_ARCH now keep the family off (tested).
- WARNING FIXED: a failed read of the Linux pointer downgraded an installed Linux-family copy to the unchecked
  portable bundle. An install whose runtime/bin/node is its own (a regular file that runs) now refuses instead; a
  portable install (node linked to a system one) keeps the transitional fallback (both tested).
- WARNING FIXED: the family needs an a.b.c version in the Linux pointer (not any "version" text), and the body is
  reused by the main pointer read instead of being fetched a second time.
- NIT RECORDED: a first install has no signed check, exactly as a Mac curl|sh install (nothing installed to verify with).
- NIT FIXED with the blocker: KOSMOS_BUNDLE_ARCH turns the family off.
- NIT OPEN (next round): the install-time changes are pinned by source regexes, not run through install_kosmos with
  a file:// release; worth a behavioural test.
- From the review, for slice D: the installed verifier never binds `platform`, so slice D's cross-platform refusal
  must land no later than slice C.

## Review 2 (2026-10-26 22:1x): 0 blockers, 3 warnings, 3 nits
- WARNING FIXED: setup.sh stamped a Linux staging install `prod` (it compared `_PTR_FILE` with latest-staging.json
  exactly). Now a `*staging.json` suffix match, tested with all four pointer names (mutant red).
- WARNING FIXED: a published Linux pointer would have moved every Linux x86_64 computer onto a glibc 2.35 build. The
  family now needs `getconf GNU_LIBC_VERSION` at 2.35 or newer; older glibc and musl keep the portable bundle and say
  why; an installed family copy below the floor refuses. Tested with a stand-in getconf (2.28, 2.34, musl, 2.35,
  3.0; mutant floor 2.28 red). Not taken: probing kosmos-tunnel at install time, since the floor is the reason it
  would fail and the connector has no cheap no-network verb to probe with.
- WARNING DECIDED, recorded on the card as an ordering rule: no Linux pointer is published until slice D (the
  engine reading latest-linux.json) has shipped in a cut. Otherwise a Linux board offers the Mac version while the
  spawned setup.sh installs the Linux one.
- NIT FIXED: the refusal now says the pointer may not be published on this channel yet, or the download failed.
- NIT DECIDED: update_manifest_ok's /usr/bin/{grep,mktemp,od,tr} exist on every merged-/usr distro, which is every
  distro that passes the 2.35 floor; slice E's stock ubuntu:24.04 run proves it end to end.
- NIT ACCEPTED (both reviews): install_kosmos's four gates are pinned by source regexes, each removal red; the
  manifest name and the verifier's acceptance of a Linux manifest are proved in slice E's end-to-end run.
