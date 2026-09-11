# pkg-arch-guard-2792 -- the .pkg installer must refuse Intel with a clear message

## Why (kosmos#2792, prod user report 2026-09-11)
A prod user on a 2019 Intel MacBook Pro (Core i9, x86_64) ran the Kosmos installer and got
Apple's generic "The installation failed. Contact the software manufacturer" -- NOT a clear
"Kosmos requires an Apple Silicon Mac" message. Kosmos is arm64-only (the prod runtime ships
only as kosmos-<v>-arm64.tar.gz; x64 variants 404), so an Intel Mac cannot run it.

I diagnosed this live in the user thread. Mechanism: setup.sh (the curl|sh path) DOES refuse
non-arm64 up front with a named message (`case "$ARCH" in arm64) ;; *) die "Kosmos needs a Mac
with Apple silicon (M1 or newer)..."`). The .pkg's postinstall delegates to setup.sh, so the
refusal DOES fire -- but in the .pkg, the postinstall's stdout/stderr is SWALLOWED by macOS
Installer (kept only in /var/log/install.log), so the person sees only Apple's generic failure.
The .pkg's own distribution.xml had `hostArchitectures="arm64,x86_64"` and NO arch check, so an
Intel Mac was allowed to start installing and then hit that swallowed, invisible refusal.

## The fix
Add a native macOS Installer `<installation-check>` to the distribution.xml template in
`tools/build-installer-pkg.sh`. It runs `kosmosArchCheck()`, which allows ONLY a positively
confirmed Apple-silicon Mac (`system.sysctl('hw.optional.arm64') == '1'`, wrapped so any other
value or a throw is treated as unsupported) and otherwise fails Fatal with:
"Kosmos requires a Mac with Apple silicon (M1 or newer). This Mac has an Intel processor, which
Kosmos does not support." The check runs at the door, BEFORE install, so an Intel user sees the
real reason and is blocked.

`hostArchitectures` deliberately KEEPS x86_64. If it dropped x86_64, macOS Installer would refuse
an Intel Mac with ITS OWN generic message before the installation-check ever ran, and the clear
message would never appear. x86_64 lets Installer open far enough to run the check and show the
message; the check is what actually refuses.

setup.sh's own guard is unchanged and remains as defense-in-depth for the curl|sh path.

## Verification (and its one honest limit)
- The rendered distribution.xml is well-formed (xmllint) and `productbuild` ACCEPTS it (rc=0) --
  macOS validates the installation-check JS/schema.
- Built a dummy pkg through productbuild, expanded it (pkgutil --expand): the shipped Distribution
  carries the installation-check, the sysctl check, and the message -- the guard survives the build
  into the artifact.
- Negative control: origin/main's build script has ZERO occurrences of the guard, so the fix
  genuinely adds it.
- Allow-arm confirmed: `sysctl hw.optional.arm64 = 1` on this Apple-silicon box, so the JS's
  positive branch allows a supported Mac (the control that would break THIS machine's install if
  the check were inverted).
- New test `tools/test-pkg-arch-guard-2792.sh` renders the template and asserts the check is
  present, Fatal, names Apple silicon, reads hw.optional.arm64, and keeps x86_64 in
  hostArchitectures -- with a negative control proving the assertions can fail. Registered in
  package.json `test:shell` so `tools.every-test-runs.test.js` runs it (an unrun guard reads as
  coverage).
- 🛑 LIMIT, stated not hidden: I cannot exercise the macOS Installer JS engine on a real INTEL Mac
  from this Apple-silicon machine, so the LIVE Intel refusal (Installer runs kosmosArchCheck, gets
  not-'1', shows the Fatal message, blocks) is not machine-verified here. The proxies above
  (productbuild acceptance + presence + Fatal + message + x86_64 host arch + the sysctl semantics)
  are what is checkable without Intel hardware. Recommend a one-time hand-verify on an Intel Mac
  (or a signed test build) before/at the next cut. This does not block the fix: the pre-fix
  behaviour on Intel is a broken generic error, and the worst case if the check somehow no-ops is
  the unchanged status quo (setup.sh still refuses, just invisibly) -- the fix cannot make Intel
  worse, only better.

## Weakest premise
That the macOS Installer's `system.sysctl('hw.optional.arm64')` returns '1' on Apple silicon and a
non-'1' value (not an exception that would be caught-and-refused wrongly) on the Installer's own
run context. This is the documented, standard arch discriminator; the try/catch defaults to refuse
so an unexpected throw cannot silently ALLOW an Intel Mac (it would show the message instead). The
only residual risk is a freak throw on a genuine Apple-silicon Mac wrongly refusing a supported
user -- rare, and recoverable via the curl|sh path. What would change my mind: an Intel hand-test
showing the check does not fire, or an Apple-silicon build showing a false refusal.

## Files
- tools/build-installer-pkg.sh -- installation-check + kosmosArchCheck() in the distribution template
- tools/test-pkg-arch-guard-2792.sh -- new, locks in the guard (registered in test:shell)
- package.json -- register the new shell test

## Steps
1. Implement + verify (done).
2. challenge-loop to convergence; proof file.
3. PR to joshualeestone/kosmos (literal cd; no --reviewer; no em dash); Addresses #2792 (non-closing).
4. CI green -> squash-merge -> remove worktree -> report to the user thread.
