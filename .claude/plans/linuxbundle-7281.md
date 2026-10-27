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
