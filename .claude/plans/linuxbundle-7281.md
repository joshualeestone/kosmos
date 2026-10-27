# kosmos#7281: the Linux x86_64 release bundle (branch linuxbundle-7281, slice A)

The plan as posted on the card (comment 6431703337):

**Plan (Baron, 20:5x CDT 10-26), from a read of origin/main 881561ee. Building slice A now; corrections welcome on any line.**

## Where things are (measured)
- **Bundle build:** `tools/build-kosmos-bundle.sh` stages a platform-neutral app tree (server.js, engine, web, bin). It then adds Mac-only parts: a darwin node (`node-v$V-darwin-$NARCH`, sha checked against nodejs.org's SHASUMS256), a universal Mach-O tunnel (`lipo`), Developer ID codesigning, notarization, and the Swift app. `ARCH` is the build host's `uname -m`.
- **Release:** `release.sh` publishes `kosmos-<V>-arm64.*` with "arm64" written as a literal. The pointer (`latest.json` / `latest-staging.json`) has no per-arch field.
- **Install on Linux:** `setup.sh` forces `ARCH="arm64"` and downloads the Mac tarball. It links the system node and tmux and skips every signature check ("its updates are not built or signed here yet").
- **Updates on Linux:** `engine/update.js` `pointerFor` sends a Linux board to the Mac pointer, and `manifest-verify.js runSetup` hard-codes `-arm64`.
- **CI:** every Linux job installs node with `setup-node`, which is why #4920 passed with the Mac bundle.
- **Windows is the precedent:** its own names (`kosmos-<v>-win-x64.*`), a manifest with `platform`, the same ed25519 signing, its own pointer pair (`latest-win(-staging).json` with `versioned` and `arch`), a `--family win` promote, and an engine check that the versioned artifact names this machine's arch.

## Design: Linux is a third family, beside Mac and Windows
- **Names:** `kosmos-<V>-linux-x64.tar.gz` (+ `.sha256`), alias `kosmos-linux-x64.tar.gz`, manifest `kosmos-<V>-linux-x64.manifest.json` with `"platform": "linux"`, `"arch": "x64"`, and `.sig` signed by the same key and the same `manifest-sign.js`.
- **Contents:** the same app tree; Linux node `node-v$V-linux-x64` (the same pinned version, sha from SHASUMS256); a Linux x86_64 `kosmos-tunnel` (ELF, from PigeonPete); no Swift app. No tmux in v1: setup.sh's `setup_linux_tmux` uses the system tmux or apt. Stock Ubuntu cloud images ship tmux; the CI job proves which.
- **Pointers:** `latest-linux.json` / `latest-linux-staging.json`, shaped like the Windows pair. The Mac pointer is untouched, so no Mac install sees any change.
- **Built where:** cross-assembled on the cut Mac (Mortals) during the cut, from the same frozen tree: one cut, the same app commit for both families. Nothing in the assembly needs Linux: download node, copy the app, copy the tunnel, write JSON, sign.

## Slices (each its own PR, each green on its own)
- **A. `tools/build-linux-bundle.sh`** (building now): assembles and packs the Linux bundle on a Mac from the shared staging step, writes the manifest, and refuses a tunnel that is not ELF x86-64. Tested in CI by unpacking on Linux and running its node.
- **B. `install/setup.sh`:** Linux x86_64 reads `latest-linux(-staging).json` and downloads `kosmos-<V>-linux-x64.tar.gz`. It verifies the sha and the manifest signature, as a Mac does. An unsupported arch (aarch64 for now) is refused with a clear sentence instead of getting the Mac bundle.
- **C. `release.sh` and `promote-channel.sh`:** the cut builds, signs and publishes the Linux family and its staging pointer; `promote --family linux`.
- **D. Engine:** `update.js` gives Linux its own pointer pair with the arch check Windows has, and `manifest-verify.js runSetup` uses this machine's family.
- **E. CI:** a job runs in `ubuntu:24.04` (a container with no node), serving a freshly built Linux bundle from the runner and installing with `curl | sh`. It asserts that the board answers on the BUNDLED node and that `kosmos-tunnel --help` runs. A control proves the image has no `node` on PATH.

## Open, for others
- **PigeonPete:** the Linux x86_64 `kosmos-tunnel` from the release commit, with the hosted branch. Where can the cut pick it up (a CI artifact, or a build on Mortals), and is it statically linked or glibc (which minimum)? Until it exists, slice A takes it as an input file, and the CI job uses a tunnel built from relay main.
- **Hosting, my call unless someone objects:** the tarball goes where the Mac tarball goes (the site's `/dist`), not R2. A Linux tarball is about 30 MB compressed. Weakest premise: the site deploy can carry a second ~30 MB tarball per cut. If not, R2 with the same 307 the Windows names use.

**Done when** (the card's own line): a fresh stock Ubuntu cloud box installs the Linux bundle from `/setup-staging`, the board answers on the bundled node, and `kosmos-tunnel` runs. Proved on a real Kosmos Cloud machine, torn down after.


## Slice A (this branch): tools/build-kosmos-linux.sh
- Assembles the Linux bundle on any host: the Mac list of app files (held in lockstep by
  tools.build-linux-7281.test.js, with reasons for the three Mac-only entries), nodejs.org's node-v<V>-linux-x64
  checked against SHASUMS256 (the Mac builder's cache, never a trust shortcut), and kosmos-relay's Linux
  kosmos-tunnel as an input that must be ELF x86-64, refused before any download otherwise.
- Writes kosmos-linux-x64.tar.gz (+ .sha256, neutral owner, no macOS metadata) and kosmos-linux-x64.manifest.json:
  the Mac shape plus platform "linux"; connector {sha256, commit}; no native_app, no macos field.
- The build host's node writes the manifest (the bundled node is a Linux binary).
- Measured: a real build on this Mac with nodejs.org's linux-x64 node, 389 files, the manifest listing exactly the
  tarball, owner kosmos:kosmos, exec bits on node, kosmos-tunnel and bin/kosmos.
- Weakest premise: that nothing in the app tree is Mac-only at runtime on Linux. The #4920 work ran this app on Linux
  from a source checkout, so the tree is known to run; slice E proves the PACKAGED bundle runs on stock Ubuntu.

## Slice A review 1 (2026-10-26 21:0x): 2 blockers, 3 warnings, 4 nits
- BLOCKER FIXED (B1): GNU tar's `--owner=kosmos` needs that user on the build host; now `kosmos:0` (name and id).
  This branch has no GNU tar on the Mac; the Linux CI lane (linux.yml, dispatched on this branch) runs the test,
  whose CONTROL case runs the whole builder there.
- BLOCKER FIXED (B2): the connector's provenance, by the shared tools/lib/connector-provenance.sh (matching .sha256,
  a 40-hex never-dirty commit), as the Mac and Windows builders require. Refusal tests for no sidecar and dirty.
- WARNING FIXED (W1): an unchecked node needs KOSMOS_ALLOW_DIRTY=1 and is recorded as `unchecked:<sha>`.
- WARNING FIXED (W2): the Mac's platform-neutral gates: home_path_gate_tree, kosmos_bundle_odd_names (a copy the
  test holds word for word equal to the Mac's), tar_owner_gate, tar_macmeta_gate, and a smoke test that boots the
  STAGED app with the host node and fetches its page.
- WARNING FIXED (W3): the connector's newest GLIBC symbol must not exceed KOSMOS_LINUX_GLIBC_FLOOR (2.35, the
  relay's ubuntu-22.04 build host); recorded as connector.glibc. Test: GLIBC_2.39 refused.
- NIT FIXED (N1): only an ELF executable passes (not a relocatable or a core file).
- NIT FOR SLICE D (N2): Mac verify never checks platform; once Linux manifests are signed with the same key, a Mac
  must refuse a platform other than absent or darwin. Must land no later than slice C.
- NIT FIXED (N3): connector carries signed_sha256 and input_sha256 (tools/verify-manifest.sh reads them).
- NIT FIXED (N4): the Mach-O refusal test uses an unpublished node version, proving the refusal comes first.

## Slice A review 2 (2026-10-26 21:2x): no blockers, 5 warnings, 3 nits
- W1 FIXED: the connector must be for Linux (SYSV or GNU/Linux OS byte; FreeBSD refused) and, if it names a loader,
  glibc's /lib64/ld-linux-x86-64.so.2 (musl refused); the glibc floor applies only then (static: none).
- W2 FIXED: GLIBC_ versions read with grep -a from the file, never `strings` (missing strings read as static).
- W3 FIXED (locally, not in the shared gate): the Linux connector may not name /home/<u>/.cargo|.rustup or
  /root/...; the shared home-path gate stays as the Mac cut uses it (smaller blast radius; decided, not missed).
- W4 FIXED in tools/lib/tar-owner-gate.sh: also reads GNU tar's owner/group column; a test packs a tarball with the
  build account on this host's own tar and expects a refusal (and a neutral control passes).
- W5 FIXED: a floor other than 2.35 needs KOSMOS_ALLOW_DIRTY=1; connector.glibc_floor recorded in the manifest.
  FOR SLICE C: refuse a manifest whose node sha starts `unchecked:` or whose connector.glibc exceeds 2.35.
- N1 FIXED (SMOKE_PID cleared after the wait). N2 covered by W1. N3: the gated tests require the gate's own message
  on a clean tree; connector-provenance.sh's shasum-only is left (it refuses, safely).

## Slice A review 3 (2026-10-26 21:3x): CONVERGED, no blockers, no warnings
- Confirmed: the shared tar-owner-gate change cannot refuse a Mac tarball (bsdtar's $2 is a link count) and now sees
  GNU tar's owner; the connector case accepts the real glibc tunnel string and refuses FreeBSD, a foreign loader, musl;
  the relay's own Linux build (build-tunnel-release-linux.sh) targets x86_64-unknown-linux-gnu on ubuntu-22.04 and maps
  away $HOME, CARGO_HOME and RUSTUP_HOME, so the real artifact passes.
- NITS TAKEN: a `, for <system>` label other than GNU/Linux is refused (code only: making `file` print "for OpenBSD"
  needs a note section, so no fixture; decided); /github/home and /usr/local/cargo|rustup added to the cargo-home
  check (with a test); the floor test passes a local node so a regression cannot reach the network; a comment that a
  glibc refusal here (whole-file read) should be cross-checked against the relay's objdump -T read.
- Also: KOSMOS_TUNNEL_LINUX_BIN now defaults to ~/work/kosmos-relay/dist/kosmos-tunnel-linux-x86_64 (as agreed on the
  card); an explicitly empty value is still refused.
