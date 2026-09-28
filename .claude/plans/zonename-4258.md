# zonename-4258: on Windows a zone by interface name reads as no zone, and the look stays conservative

kosmos#4258. The round 5 test in `engine/win32handoff.test.js` (findings 1 and 3) builds `KOSMOS_BIND_HOST=<fe80 address>%<interface name>` and asserts the board look includes it. That arm went red on #1777's first real Windows run and is green on every Mac.

## Why it fails on Windows (the mechanism is INFERRED: the runner's adapter name appears in no CI log)
`net.isIP` is plain JS, so its answer is the same on every platform (measured, Node v26.8.1):
`net.isIP('fe80::1%en0')`, `'fe80::1%14'`, `'fe80::1%Ethernet'` and `'fe80::1%Wi-Fi'` are all 6, while `'fe80::1%Ethernet 2'` and `'fe80::1%vEthernet (nat)'` are 0.
A name with a space or parentheses is therefore not an IP literal to `bindHostProbeAddresses`. It is taken as a host name and adds nothing. The runner's arm failed, so its adapter name is inferred to be of that kind; what Windows' getaddrinfo does with such a string is not measured.

## Call
Windows zones are the numeric scope id, and libuv reads a Windows zone with `atoi`. That is read from libuv source and not measured: `uv_ip6_addr` uses `atoi` on `_WIN32` and `if_nametoindex` elsewhere. So a name zone reads as scope 0, which is no zone. Whether Windows then lets a board bind that address is not measured either.

So the look stays **conservative**: it never probes less than a board could hold. On win32, `windowsZoneAsLibuvReadsIt` reads the bind host's zone as atoi would. An all-digit zone becomes its number (`%014` is probed as `%14`). Zero, empty, a name (with a space or without) or a mix (`%14abc`) all become no zone, and the existing unzoned path then probes the address through every interface that has it (`<addr>%<scopeid>`), a superset of whatever the board bound (review 5). Every other platform is unchanged. `platform` is injectable through `probeBoardOnEveryAddress`, so a Mac test drives the whole look for win32.

Rejected:
- **Refusing a name zone on win32** (review 1's version). If Windows does bind the scope-0 address, a board there would be probed on no address, and the uninstall or move would read "no board" and proceed (review 3). A look that probes too much costs a refused connection; a look that probes too little can remove a live board.
- **Only skipping the arm on win32** (the first version). The product would stay unchanged while the comment claimed otherwise.
- **Making the product probe `%Ethernet 2` literally.** It is not an IP literal, so there is nothing to connect to by that spelling.

## Evidence
- `node --test engine/win32handoff.test.js` on this Mac: 69 tests, 68 pass, 1 skipped (a pre-existing Windows-only arm). This Mac has `en0` link-local (scope 7), so the real-interface arm ran.
- The new end-to-end test (injected interfaces and platform): on win32, `%Wi-Fi` and `%Ethernet 2` are each probed as `<addr>%9` and `<addr>%14`, `%14` only as itself, and on darwin `%Wi-Fi` by that name.
- Mutants (a full worktree copy): not calling the normaliser fails 1; keeping every zone fails 1; normalising on every platform fails 2.
- The new end-to-end test also pins `%014` as `%14`, `%0` as every interface, a bracketed and an upper-case name-zoned literal as every interface, and a scope, an address and an IPv4-mapped address this PC does not have as loopbacks only; the helper test pins the empty and mixed zones.
- **The coupling with #1777, which is stronger than "can go":** on `win-ci-1777` (checked at its tip each review; the entry is still listed), `judge()` counts a KNOWN_RED entry that now passes as STALE and fails the job. Whichever of this and win-ci-1777 lands second must also remove the `engine/win32handoff.test.js` entry from KNOWN_RED.

## Inferred, not measured (no Windows run of this branch yet)
- The first Windows run of this branch is also the first Windows run of the REST of the round 5 test: on #1777's run it stopped at the failing name-zone assert, so the E2, resolves-to, other-zone and resolves-to-zoned asserts after it have never run on Windows (review 7). One of them (resolves-to, an exact list) would go red for an unrelated reason if the runner held the same link-local address on two adapters.
- The real-interface arm on a Windows runner expects the scope-id spelling to be probed. That holds for an adapter name with or without a space, but not for a name made only of digits: an adapter named `3` would be read as scope 3, which would contain `byScope` only if its scope id is 3. Kano's Windows job is the first real run.

## Weakest premise
The libuv reading, which is from source and not measured on Windows. If Windows instead rejected a name-zoned bind outright, this look would probe addresses no board holds. That costs refused connections, never a missed board.
