# zonename-4258: on Windows a zone by interface name reads as no zone, and the look stays conservative

kosmos#4258. The round 5 test in `engine/win32handoff.test.js` (findings 1 and 3) builds `KOSMOS_BIND_HOST=<fe80 address>%<interface name>` and asserts the board look includes it. That arm went red on #1777's first real Windows run and is green on every Mac.

## Why it fails on Windows (the mechanism is INFERRED: the runner's adapter name appears in no CI log)
`net.isIP` is plain JS, so its answer is the same on every platform (measured, Node v26.8.1):
`net.isIP('fe80::1%en0')`, `'fe80::1%14'`, `'fe80::1%Ethernet'` and `'fe80::1%Wi-Fi'` are all 6, while `'fe80::1%Ethernet 2'` and `'fe80::1%vEthernet (nat)'` are 0.
A name with a space or parentheses is therefore not an IP literal to `bindHostProbeAddresses`. It is taken as a host name and adds nothing. The runner's arm failed, so its adapter name is inferred to be of that kind; what Windows' getaddrinfo does with such a string is not measured.

## Call
Windows zones are the numeric scope id, and libuv reads a Windows zone with `atoi`. That is read from libuv source and not measured: `uv_ip6_addr` uses `atoi` on `_WIN32` and `if_nametoindex` elsewhere. So a name zone reads as scope 0, which is no zone. Whether Windows then lets a board bind that address is not measured either.

So the look stays **conservative**. On win32, `windowsZoneAsLibuvReadsIt` turns a bind host of the form `<IPv6>%<non-numeric>` into the bare address, and the existing unzoned path then probes it through every interface that has it (`<addr>%<scopeid>`). This applies to both kinds of name, with or without a space. Every other platform, and a numeric zone, are unchanged. `platform` is injectable through `probeBoardOnEveryAddress`, so a Mac test drives the whole look for win32.

Rejected:
- **Refusing a name zone on win32** (review 1's version). If Windows does bind the scope-0 address, a board there would be probed on no address, and the uninstall or move would read "no board" and proceed (review 3). A look that probes too much costs a refused connection; a look that probes too little can remove a live board.
- **Only skipping the arm on win32** (the first version). The product would stay unchanged while the comment claimed otherwise.
- **Making the product probe `%Ethernet 2` literally.** It is not an IP literal, so there is nothing to connect to by that spelling.

## Evidence
- `node --test engine/win32handoff.test.js` on this Mac: 69 tests, 68 pass, 1 skipped (a pre-existing Windows-only arm). This Mac has `en0` link-local (scope 7), so the real-interface arm ran.
- The new end-to-end test (injected interfaces and platform): on win32, `%Wi-Fi` and `%Ethernet 2` are each probed as `<addr>%9` and `<addr>%14`, `%14` only as itself, and on darwin `%Wi-Fi` by that name.
- Mutants (a full worktree copy): not calling the normaliser fails 1; keeping every zone fails 1; normalising on every platform fails 2.
- The real-interface arm on a Windows runner now expects the scope-id spelling to be probed, which holds whether the runner's name has a space or not.
- **The coupling with #1777, which is stronger than "can go":** on `win-ci-1777` (tip 2d9039292), `judge()` counts a KNOWN_RED entry that now passes as STALE and fails the job. Whichever of this and win-ci-1777 lands second must also remove the `engine/win32handoff.test.js` entry from KNOWN_RED.

## Weakest premise
The libuv reading, which is from source and not measured on Windows. If Windows instead rejected a name-zoned bind outright, this look would probe addresses no board holds. That costs refused connections, never a missed board.
