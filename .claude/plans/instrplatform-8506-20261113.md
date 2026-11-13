# instrplatform-8506: an agent's working rules hold only its own platform's lines

Card: joshualeestone/kosmos#8506 (from today's feedback, one Windows seat).

## Measured first (main 3ab7c496c9)
Every Kosmos-written instruction section was searched for platform-only wording: the doctrine block
(engine/defaults.js, 28 sections, 668 lines) and the blocks from projects, roles, team, connections, the files
section and community. Only the doctrine block has any:
- **Mac-only section:** "### When your work reaches outside your own folder" (10 lines). It covers the macOS
  permission box that names tmux. Windows has no tmux, and Linux has no such box.
- **Windows-only paragraph:** in "### Formatted messages need line breaks", the PowerShell paragraph (29 lines, opening
  "Only if your commands run in PowerShell").
- **Windows-only clause:** in "### Answering where you were asked", the clause "; in PowerShell, use the here-string
  under ...".
- **Not platform-only:** three sections only mention a platform in passing ("on a Mac", "on Windows", a list of
  commands such as open/start/Start-Process). They read correctly anywhere and are left alone.
- Elsewhere: the projects.js hits ("Finder did not open", "a folder your Mac hides") are error strings, not
  instruction text.

So a Windows agent's block loses 10 lines, a Mac agent's loses 31, and a Linux agent's loses both (41).

## Call
- The block's lines carry platform markers. `onlyOn(['darwin'], [...])` keeps lines on those platforms only.
- `blockFor(platform)` composes one platform's block, and `BLOCK = blockFor(process.platform)`. The board writes its
  agents' instructions on the computer they run on, so the board's platform is theirs.
- Markers bracket whole lines and never nest. An unpaired marker throws at load, so a broken edit fails every test
  instead of shipping a marker. The Answering clause was rewrapped so it sits on whole lines, with one wording per
  platform.
- `sections(platform)` takes an optional platform. Tests read each platform's sections, and callers keep the board's.
- DOCTRINE_VERSION is 50. The pairing test pins one fingerprint per platform from version 50 on, so the pin is the
  same whichever platform runs it. Each pinned prefix must have a row in engine/doctrine-past.js.
- tools/doctrine-past.js writes a row for each platform's block when a version has `blockFor`. Earlier versions keep
  their one block, and three v50 rows were written. An unedited copy on any platform is still recognised, so the
  consented refresh can offer the current block.

Rejected:
- **Tagging whole sections only.** The PowerShell material is a paragraph and a clause inside shared sections, so
  section-level tags would either keep it on the Mac or drop shared text on Windows.
- **The optional "first things this session" summary at the top.** It is a separate change to every agent's first
  screen, and it needs its own wording review. Left for its own card if wanted.

## Weakest premise
That the board writes an agent's instructions on the agent's own platform. That is true while agents run on the
computer whose board writes them. Remote or cross-platform agents would need the agent's platform passed in.

## Files
- engine/defaults.js: onlyOn, LINES, blockFor, PLATFORMS, BLOCK, sections(platform), the version-50 log.
- engine/defaults.test.js: per-platform pins; the two PowerShell content tests read the Windows block, with a Mac and
  Linux control.
- engine/doctrine-past.js (regenerated) and tools/doctrine-past.js (a row per platform).
- engine/defaults.platform-8506.test.js (5): each platform's board, loaded as it really is (process.platform set before
  the require, in a child), writes only its own lines.

## Proof so far
- New file 5/5. 5 mutations, each one red: platform ignored, markers leaking, sections ignoring the platform, the tmux
  section on every platform, and a v50 ledger row removed.
- 90 doctrine-related test files (defaults, doctrine, team, roles, instructions, rules, create): 1299 tests,
  1286 pass, 0 fail, 13 skipped. The Windows-list guard and the past-ledger tool tests: 28 pass.
