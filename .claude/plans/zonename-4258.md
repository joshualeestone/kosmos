# zonename-4258: the interface-name zone arm runs only where names are zones

kosmos#4258. `engine/win32handoff.test.js` (round 5, findings 1 and 3) builds `KOSMOS_BIND_HOST=<fe80 address>%<interface name>` and asserts the board look includes it. That arm went red on #1777's first real Windows run and is green on every Mac.

## Why it fails on Windows (measured on this Mac, Node v26.8.1)
`net.isIP` is plain JS, so its answer is the same on every platform:
`net.isIP('fe80::1%en0')` is 6, `net.isIP('fe80::1%14')` is 6, `net.isIP('fe80::1%Ethernet2')` is 6, and `net.isIP('fe80::1%Ethernet 2')` is 0.
Windows interface names carry spaces (`Ethernet 2`), so such a bind host is not an IP literal to `bindHostProbeAddresses`. It is treated as a host name, does not resolve, and adds nothing. Windows zones are the numeric scope id anyway (case E, the `%<scopeid>` arm, passes there), so a Windows user never writes a zone by interface name.

## Call
The product is right, and the test assumption is wrong. The name-zone arm now runs where interface names are zones (not win32). On win32 it prints a `t.diagnostic` saying it did not run and why, the same way the file already reports its other platform-dependent arms. The product comment that offered `%Ethernet 2` as a zone example now says `%en0`, noting that Windows does not take names.

Rejected:
- Making the product accept `%Ethernet 2`. It would teach the look an address Windows cannot bind, so no board could be there.
- Asserting on win32 that a name-zoned host is NOT looked on. A space-free Windows name such as `Wi-Fi` passes `net.isIP` and matches by name, so that assertion would be false for some adapters.

## Evidence
- `node --test engine/win32handoff.test.js`: 68 tests, 67 pass, 1 skipped. The skip is a pre-existing Windows-only arm. This Mac has `en0` link-local (scope 7), so the name arm ran here.
- The win32 branch cannot run on a Mac. Kano's Windows CI job on `win-ci-1777` lists win32handoff as KNOWN_RED and is the check: with this on main, that entry can go.

## Weakest premise
That no Windows adapter's name is a zone Windows itself accepts. If one were, the product would already match it by name, and the skipped arm would only be missing coverage, not hiding a failure.
