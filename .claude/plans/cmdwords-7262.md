# cmdwords-7262: one shared reader for which program a child_process call runs

Card: kosmos#7262. Stacked on #7300 (schtasks-matcher-7270 @ 5fb4192956, Homer's); PR only after #7300 merges.

## The problem
Two test preloads each read "which program does this call run": `test-support/tool-guard.js` (#4326: gh, vercel,
cloudflared) and `tools/lib/schtasks-call.cjs` (#7247/#7270: schtasks). Their readers drifted: tool-guard skips
sudo and a few prefixes, while schtasks-call reads launchers, cmd quoting, -EncodedCommand, redirects and ambiguous
calls both ways.

## The call
- New `tools/lib/command-words.cjs`, moved out of #7300's schtasks-call.cjs: the tokenizer (commands, words), the
  launcher and prefix walker, the per-launcher argument readers (nodeQuote, argWord), unchanged in what they read.
  The walker COLLECTS instead of answering yes or no: every word that reaches command position, as text without
  quotes (cmd's @ dropped), and the inside of a quoted word with a space. An ambiguous call is read every way, and
  the words from all of them are returned, so "any word refused" keeps "either reading is enough".
  Exports `callWords(file, args, options)` and `lineWords(text)`.
- schtasks-call.cjs keeps its exports and its verdict: `callRuns` / `commandRuns` = some word's base name is schtasks.
- tool-guard.js keeps its exports and its verdict (realToolIn: a real install by PATH and the allowed roots, $VAR
  expanded from the call's env). Its own segments / scriptArgOf / PREFIXES go; fileCheck uses callWords, stringCheck
  and realToolInScript use lineWords.
- sudo (tool-guard's only prefix the walker lacked) joins the walker's prefix words, with its value-taking options.

## Rejected
- A shared tokenizer with each guard keeping its own walker: the walker is what drifted.
- A yes/no walker with a predicate: it works, but the card asks for the words, and a list is what a third guard
  can test against.

## Proof plan
- Unchanged: test-support.tool-guard-4326.test.js and tools.windows-tests-schtasks-7247.test.js (baseline 44/44 at
  #7300's tip).
- New tools.command-words-7262.test.js: the words of representative calls; and an agreement table, one call shape
  with the program slot filled by schtasks or by a stand-in real gh, where both guards must give the same answer
  (refused or not) for every shape. Shapes tool-guard missed before (env, nohup X=1, cmd quoting, -EncodedCommand,
  sudo, redirect-first) are in it.
- Mutations: revert tool-guard to its own reader (the agreement table must go red); drop a walker branch (the
  words test must go red).

## Weakest premise
tool-guard now reads more, so it can refuse a call it let through before. It refuses only a REAL install of its three
CLIs, and refusing is its safe side; the full suite is the measurement.

## Review rounds
1. (default model, 01:3x CDT 10-27) 1 WARNING, 5 NITs. The reviewer's random differentials (200,000 schtasks lines,
   100,000 tool-guard lines, spawn calls) found no call either guard refused before and allows now, except
   `bash ['script.sh', '-c', ...]`, which really runs the script file. Applied: (W) a $( ) or backtick inside double
   quotes (TOKEN="$(gh auth token)") was not read, by either the old or the new reader; it is now, in a POSIX or
   exec line. (N) sudo clusters ending in a value-taking letter (-iu root). (N) a stale not-seen clause about a quoted
   path to a prefix word (now seen). (N) a bare-name PATH test for tool-guard through the shared reader. Deferred: (N)
   fileCheck checks the file twice; harmless, and the shell: true case needs the separate check. For the PR body:
   (N) an out-of-tree copy of no-schtasks-preload.cjs now needs lib/command-words.cjs beside lib/schtasks-call.cjs.
   Mutations M4 (the quoted-substitution read off) and M5 (no sudo clusters) each red, restored.
2. (sonnet, 01:4x CDT) No BLOCKERs, WARNINGs or CONVENTIONs; 3 NITs. Applied: (N) the NOT SEEN comment in
   tool-guard.js was left broken mid-sentence by my line edit; reflowed. Deferred: (N) keyword words (if, then, {) are
   returned, documented in the header and ignored by both guards; (N) the double file check (as round 1). Converged.

## After the PR opened: Windows (Homer, 02:4x CDT, on his box)
All 87 engine win32 tests and tools.windows-tests-schtasks-7247 pass with the shared reader under the schtasks preload. Two
tool-guard arms of tools.command-words-7262.test.js failed there: tool-guard's verdict is POSIX-shaped (a path needs a
'/'; a bare name needs an executable file on PATH, and the stub is a #!/bin/sh file). Windows runs never preload
tool-guard (tools/windows-tests.js loads only the schtasks preload), so this is a test-only gap, not a guard gap there.
**Correction (review round 3, measured):** that last sentence is wrong. tools/run-tests.sh line 852 preloads
tool-guard on every platform, so a Windows `npm test` loads it, and it never refuses a real gh.exe there (a path needs
a '/', and the name must be exactly gh). That gap is older than this branch; it is #7318, not fixed here.
Call (Homer's suggestion): those arms skip on win32, the schtasks arms run there, and the file is added to ALSO_ROOT.
engine/windows-tests-1777.test.js requires that entry: measured, removing it reds that test naming this file.
3. (default, 02:5x CDT) 1 WARNING, 3 NITs. (W) the win32 skip's reason was false: run-tests.sh preloads tool-guard on
   Windows too (line 852). Applied: the test comment, the skip reason and the ALSO_ROOT comment now say tool-guard does
   not judge Windows paths, the plan carries the correction above, and #7318 is filed (unclaimed, for Homer). (N) the
   test header misstated who missed sudo; corrected. (N) on win32 the tool-guard verdict was still computed and
   discarded; now it is not computed. Deferred: (N) the double file check (as rounds 1 and 2). The reviewer's
   differential (60,000 lines, 40,000 calls, old readers from origin/main) found no realistic shape either guard lost.
