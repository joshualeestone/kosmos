# kosmos#2452(c) -- a loose Gemini agent file keeps its front-matter name

## Card
Josh 0.6.47 re-test: find-agents found 9/10, 2 import-Add errors, 3 flagged no-name.
After Splinter's dedup, this branch fixes ONLY (c) the no-name portion. (a) find-9/10
and (b) import-Add are out of scope (see below).

## Root (reproduced against the real seed corpus)
The three Gemini agents (code-reviewer / project-explainer / sarah), seeded as loose
files across Documents/Downloads/a Work folder, are offered with name="". A Gemini
agent's identity is in YAML front-matter (`name: sarah`), not a "You are <Name>" line.
`engine/discover.js`'s gemini merge (#2410) names them by front-matter but only reads the
KNOWN location (`geminisession.agentFiles()`, ie `.gemini/agents/`). A Gemini file
dropped elsewhere is reached by the generic walk -> `looseRow` (discover.js:1093), which
matched the "You are a helpful assistant ..." body via INTRODUCES but did not parse the
front-matter name, so it was offered nameless.

Reproduced: `discover.scan` over the corpus dir -> the gemini files come back name="".

## Fix
`looseRow` reads the SAME front-matter identity the merge uses
(`agentfile.geminiIdentity(text)`), ranked below a real "You are <Name>" line
(`id.displayName`) and above the #8 H1-heading fallback -- the front-matter name is
authoritative where it exists; the heading is a last-resort guess. A non-gemini file
yields null from geminiIdentity and is unchanged.

## Rejected
- Widening the loose walk to reach `.gemini/agents/` dotdirs: wrong layer; the gemini
  merge already covers the known location. The bug is a gemini file OUTSIDE it, which the
  loose walk already reaches -- only the NAME was lost.
- Reading the front-matter description as a name: no, that fabricates a name; only the
  `name:` field is authoritative (asserted by a control test).

## Weakest premise
`dirRow` (the FOLDER path, for CLAUDE.md-dir agents) was not changed: a Gemini agent is a
single loose FILE, not a folder, so dirRow does not encounter one. If a future Gemini
layout puts a front-matter agent inside a folder dirRow reads, that is a separate case.

## Tests
`engine/discover.gemini-loose-2452.test.js`: a loose gemini file gets its front-matter
name; a "You are <Name>" file still wins by that line; a non-gemini front-matter file gets
no fabricated name; the name comes from the front-matter, not the filename.
Perturbation-verified: removing the reader reds the two front-matter-name arms. Full
discover suite green (47), full repo suite green.

## Out of scope (per Splinter dedup, on the card)
- (a) find 9/10: a LOCATION/reach issue (TCC #2125 / custom root #2414 -- Ice Cream
  Kitty), not classification. discover classifies all 10 correctly when reached
  (discover.acceptance-1329 green). The "missing 1" may even be the negative control #7
  (must NOT be offered), making 9 the correct count.
- (b) import-Add "not one we found": #2461 (Baron Draxum).
