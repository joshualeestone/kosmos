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
