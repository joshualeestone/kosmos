# parityrace-4478: the Windows CLI parity scan tolerates a file that vanishes mid-scan

Card: #4478 (filed from Kano's validation of #4356; night shift, claimed by pigeonpete 22:58).

## The defect
tools.windows-kosmos-cli-verbs-parity.test.js walks every source file in the repo and reads each one. server.test.js (#4435, #4408) makes `.probe-freshness-<pid>/x.js` at the repo root and removes it. When the two files run together, the scan lists the folder or file and it is gone before the read: ENOENT, a red on any branch, green alone.

## Built
- `listIfThere` and `readIfThere` in the parity test: an ENOENT on the folder walk or the read is skipped. Nothing else is: any other error still fails.
- A test of the race: a folder listed, removed as server.test.js does, then read and walked. Both skip. An EISDIR read still throws, as the control that "gone" is not "any error".
- server.test.js's comment said the probe folder is one "no other suite walks". False: it now says the parity scan walks it and skips a vanished file.

## Decided
- Fix the SCAN, not the probe. The card offers either. The probe must sit under the checked root (that is what #4408 tests), so moving it out is not available. Adding it to SKIP_DIRS by prefix would fix this one folder, while the scan would stay fragile to the next test that writes a temp file in the tree. A scan that skips vanished files fixes the class.
- Rejected: catching every read error. A permission error or a read of the wrong kind of thing would then pass silently, and the scan would look thorough while reading nothing. The existing asserts that the scan saw server.js's `task message` and projects.js's `task add` still guard the scan from reading nothing.

## Weakest premise
That skipping a vanished file can never hide a real teaching. It can only be skipped if it was deleted during the run, and a file deleted during the run is not in the tree the product ships.

## Tests
- tools.windows-kosmos-cli-verbs-parity.test.js: 11 tests pass (was 10).
- Mutants, each red: no guard on the folder walk; no guard on the read; every error counted as gone.
