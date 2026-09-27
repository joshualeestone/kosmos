# zonename-4258: the interface-name zone arm runs only where names are zones

kosmos#4258. `engine/win32handoff.test.js` (round 5, findings 1 and 3) builds `KOSMOS_BIND_HOST=<fe80 address>%<interface name>` and asserts the board look includes it. That arm went red on #1777's first real Windows run and is green on every Mac.

## Why it fails on Windows (the mechanism is INFERRED: the runner's adapter name is in no CI log)
`net.isIP` is plain JS, so its answer is the same on every platform:
`net.isIP('fe80::1%en0')` is 6, `net.isIP('fe80::1%14')` is 6, `net.isIP('fe80::1%Ethernet2')` is 6, and `net.isIP('fe80::1%Ethernet 2')` is 0.
A Windows adapter name with a space or parentheses (`Ethernet 2`, `vEthernet (nat)`) is not an IP literal to `bindHostProbeAddresses`; a plain `Ethernet` or `Wi-Fi` is (measured, `isIP` 6). The runner's arm failed, so its adapter name is inferred to be the first kind; such a bind host is then taken as a host name and adds nothing to the look (what Windows' getaddrinfo does with it is not measured). Windows zones are the numeric scope id anyway (case E, the `%<scopeid>` arm, passes there), so a Windows user never writes a zone by interface name.

## Call
The product should not take a name as a zone on Windows, and the test should say so. Windows zones are the numeric scope id, and libuv reads a Windows zone as a number (read from libuv source, not measured: `uv_ip6_addr` uses `atoi` on `_WIN32` and `if_nametoindex` elsewhere), so a name-zoned address there is not one a board could have bound.
- The product: `zoneNamesInterface(zone, name, scopeid, platform)` matches by scope id everywhere and by name only off win32 (before, a space-free Windows name such as `Wi-Fi` matched by name and was looked on).
- The test arm: off win32 a name-zoned host IS looked on (unchanged); on win32 it is NOT. A platform-independent test pins the rule itself, so a Mac checks the win32 answer too.

Rejected:
- Making the product accept `%Ethernet 2` on Windows: no board can bind it there.
- Only skipping the arm on win32 (review 1's first version): the product would then still take `%Wi-Fi` on Windows while the comment said it did not.

## Evidence
- `node --test engine/win32handoff.test.js`: 68 tests, 67 pass, 1 skipped. The skip is a pre-existing Windows-only arm. This Mac has `en0` link-local (scope 7), so the name arm ran here.
- The win32 arm runs only on Windows; the `zoneNamesInterface` test checks the win32 rule on any machine. Kano's Windows CI job on `win-ci-1777` listed win32handoff as KNOWN_RED at 4c12c931f (its tip e773de8d3 is a temporary control without it): with this on main, the entry can go.

## Weakest premise
That Windows takes no interface name as a zone (from libuv source, not measured on Windows). If it did, a board bound to a name-zoned address would no longer be looked on by that spelling; the numeric spelling of the same address is still looked on.
