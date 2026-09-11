# pkg-gate-1562: gate arch + macOS in the .pkg so an unsupported Mac fails with a reason, not a mystery

Card: kosmos#1562 (install-states QA matrix). A real user (Josh's friend, 2026-09-11) hit an untested cell: the native `.pkg` installer failed with the generic macOS "The installation failed. The Installer encountered an error." and no reason.

## Root cause

The `.pkg` is a payload-free Distribution package: its postinstall drops to the console user and runs `install/setup.sh` (fetched from installkosmos.com), which downloads the Kosmos bundle and installs it. Kosmos is Apple-silicon-only and requires macOS 13.5+, and `setup.sh` enforces both with a NAMED refusal (`die "Kosmos needs a Mac with Apple silicon (M1 or newer)"` / `"needs macOS 13.5 or newer"`).

Two problems combined into the generic failure:

1. **The Distribution declared `hostArchitectures="arm64,x86_64"`** (`tools/build-installer-pkg.sh`), telling macOS Installer the installer supports Intel. But Kosmos ships NO x86_64 bundle (verified: `installkosmos.com/dist/kosmos-x86_64.tar.gz` is 404; only `kosmos-arm64.tar.gz` is served). So macOS let an Intel Mac RUN the installer, which then hit `setup.sh`'s Intel refusal.
2. **There was no up-front macOS-version gate** in the Distribution, so an old-macOS Mac also ran setup before hitting the floor.
3. **Under the `.pkg`, `setup.sh`'s stdout/stderr is swallowed into `/var/log/install.log`** (`KOSMOS_INSTALL_VIA=pkg`), so its honest named reason never reaches the user. macOS Installer shows only its own generic "installation failed."

Net: an unsupported Mac is let in, downloads, dies on a named refusal nobody sees, and the user gets a scary mystery.

## The fix (this branch, my lane: the pkg Distribution gating)

Gate the machine UP FRONT in the Distribution, so macOS Installer refuses an unsupported Mac with a clear reason before any download:

1. `hostArchitectures="arm64"` (was `arm64,x86_64`). macOS Installer refuses an Intel Mac at load, natively, since the installer scripts declare arm64 only.
2. `<volume-check><allowed-os-versions><os-version min="13.5"/></allowed-os-versions></volume-check>`. macOS Installer refuses a Mac below 13.5 up front, with its standard requirement message. 13.5 is the SAME floor `setup.sh` enforces (`MACOS_FLOOR_MAJOR`/`MINOR`).

## Coordination (Mona owns the UX half)

Mona owns: the requirement-message wording (Apple silicon M1+ / macOS 13.5+) in Josh's voice, and surfacing `setup.sh`'s `die` reason on `installing.html` for the LATER failure cases (a download drop, a permissions issue) that these up-front gates cannot pre-empt. She verifies how macOS actually renders the two gates and writes the final copy.

## Tests

`tools/test-pkg-arch-gate-1562.sh` (wired into `package.json` `test:shell`). It is a SOURCE guard by necessity: the pkg build signs + notarizes (certs + a cut), so it cannot run the real build here. It asserts the Distribution the build emits declares `hostArchitectures="arm64"` (exact attribute value, immune to comment prose), gates macOS via `allowed-os-versions min 13.5`, and that the 13.5 MATCHES `setup.sh`'s `MACOS_FLOOR` so the up-front gate and the late gate cannot drift. Includes negative controls proving the checks fire on the old shape.

## Weakest premise / verification still needed

I cannot build + notarize + install the real `.pkg` in this session, so the on-device gating BEHAVIOR (does macOS Installer actually refuse an Intel Mac and an old-macOS Mac, and with what exact message?) is NOT verified here. The source guard proves the Distribution DECLARES the gates; Mona verifies the display; a real Intel or macOS-below-13.5 Mac must confirm the refusal at the next cut. Josh's friend's Mac is the real-world test case. `hostArchitectures="arm64"` is the standard mechanism for an Apple-silicon-only installer, but its exact refusal message is what Mona verifies.

## Ship

Repo `joshualeestone/kosmos`, reviewer `joshualeestone` only, squash merge-on-green. PR links the card with non-closing `Addresses #1562`.
