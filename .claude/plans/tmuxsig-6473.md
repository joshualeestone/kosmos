# tmuxsig-6473: the Mac installer holds the tmux bundle to the signed release manifest (#6473)

Stacked on setupsig-6468 (#6475), on manifestsig-6468 (#6472). Decision and weakest premise: card #6473.

## Finished looks like
On a Mac update where the installed copy has the verifier, the installer fetches and checks the target's signed
manifest BEFORE tmux, and refuses a tmux download whose sha256 is not the manifest's tmux_sha256, before tar or
anything in it runs. The release records tmux_sha256 and refuses a cut whose manifest does not match the pair it serves.

## Done
- engine/manifest-verify.js: verifyTmux + CLI `tmux`; the CLI pre form takes tarball "-" for a signature-only check.
- install/setup.sh: update_manifest_ok phase "early" (before fetch_tmux; keeps _UM_DIR; pre reuses it, no second
  download); update_tmux_ok in fetch_tmux's network branch before tar; _UM_SAID so "not checked" is said once;
  a local KOSMOS_SRC drops an early manifest.
- tools/build-kosmos-bundle.sh: tmux_sha256 from dist/tmux-<arch>.tar.gz.sha256 when present.
- tools/release.sh: the tmux pair is copied into dist BEFORE step 4; after the build the manifest's tmux_sha256 must
  equal the pair's sidecar and its bytes.
- tools/test-install.sh: the update block's re-signed manifest names the tmux and installer it serves when the build
  recorded none.
- Tests: install.tmux-sig-6473.test.js 9; the ask 2 and ask 3 suites still pass (48 total); a mutant letting a
  mismatched tmux through goes red; installer runnable-guard and install-static pass.

## Not run
A real cut and test-install.sh end to end (need a built, signed bundle).
