# unknownrunner-9287: an unknown runner name is refused as unknown on every platform

Card: kosmos#9287 (found in #8378 cluster 4 on the Windows runner; the card's comment adds Linux from the code).

## Finished looks like
`runners.install(<unknown name>)` answers "we do not know how to install a runner for <name>" on Windows, Linux and
macOS, before the platform gate; a known runner still meets the platform gate off macOS with its real name; the
server.runners #979 arm runs on Windows (its skipOnWin32 from #8378 cluster 4 and the matching HOST_BRANCH_EXCLUDED
text removed once PR #9294 is on main).

## Change
- engine/runners.js install(): the `!m` refusal moves above the platform gate; the gate's sentence uses m.name (m is
  always set there now).
- engine/platform-gate-download.test.js: the CONTROL that asserted the old order (win32 + unknown = platform refusal)
  is replaced by #9287 (unknown name refused as unknown on win32, linux, darwin; constructor too) and a CONTROL (claude
  on win32 and linux still meets the gate, named). Checked red against main's runners.js (1 of 5 fails), green on the fix.

## Rejected
- Changing only the sentence (keep the gate first, word it "unknown or not supported"): vaguer for both cases.

## Weakest premise
manifestFor returns null only for an unknown name (it starts with hasOwn(MANIFEST, provider)); a future provider
listed in MANIFEST with no build for some platform would still meet the gate, which is the right answer for it.

## Sequencing (challenge iteration 1)
The skip to remove arrives with PR #9294 (also mine, open). This branch is rebased onto main after #9294 merges and
removes SKIP_UNKNOWN_WORDS in server.runners.test.js and its sentence in the HOST_BRANCH_EXCLUDED entry in the same PR,
so the fix and the unskip land together. The PR body says "Addresses #9287"; the card is closed by hand once the arm
is measured passing on the Windows runner.
