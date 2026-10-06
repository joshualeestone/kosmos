# #5346 step 2: the no-reader sentences stop telling people they need an API key

Was stacked on PR #5361; rebased onto main (its own two commits) after #5361 squash-merged as c60c9e29 (10-06
05:40). The review loop and proof run on a diff of only these files.

## Calls
- `NO_MODEL` (engine/orgchartfile.js) and Gemini's off-reason (engine/orgchartkeys.js) lead with Claude, name
  ChatGPT for a PNG or JPG picture (true once #5361 is in: Codex reads those two, not a PDF), and mention OpenAI or
  Grok "connected with a key" as another way, without the phrase "API key" and without implying that a Google or
  Grok subscription reads (Splinter 17:41: Antigravity and Grok stay off).
- Rejected: dropping the key routes from the sentence. They still work, and a person who has one should hear it.
- Weakest premise: that "connected with a key" does not read as "you need an API key". It is the last clause, after
  Claude and ChatGPT.

## Review round 1 (calls)
- ChatGPT is named only off Windows (orgchartcodex WHY_WINDOWS): `noModelFor(platform)` and `googleOffWhyFor(platform)`.
- A person whose own ChatGPT account was refused now hears THAT reason before the Gemini one (orgchartfile
  currentReader `sub.offWhy || got.offWhy`). This reverses #5361's order, which I set: the Gemini sentence says ChatGPT
  reads, so shown over a refused ChatGPT it contradicted itself and hid the actionable reason.
- "Claude reads a picture or PDF" rather than "needs Claude": the next sentence names other readers.
- CLAUDE.md's routing row names the ChatGPT reader.

## Review rounds 2-3 (calls)
- A person whose own ChatGPT account cannot be used (any reason, Windows included) is told that reason and then the
  Claude-first sentence without ChatGPT (`noModelFor(platform, { chatgpt: false })`), so every no-reader answer names
  what does read. With no ChatGPT account, a switched-off key provider's reason (Gemini's) as before. This replaces
  round 1's either-or and round 2's WHY_WINDOWS string comparison.
- A ChatGPT account with no Codex the board can run now has a reason (`WHY_NO_CODEX`), so the no-reader sentence
  never says ChatGPT reads to someone whose ChatGPT cannot.

## Review round 4 (calls)
- If the person also has a switched-off Gemini key, one sentence says so (`orgchartkeys.OFF_SHORT`), between their
  ChatGPT reason and the Claude-first sentence.
- "ChatGPT, connected the same way, also reads": the Mac sentence no longer reads as if ChatGPT already works.
- The closing sentence every Codex refusal ends with is one constant (`orgchartcodex.ANY_PROVIDER`), taken off by
  value rather than by a pattern.

## Review round 5 (calls)
- On Windows a ChatGPT account hears "not on Windows yet" even with no Codex (the platform reason comes first: fixing
  Codex would not help there).
- The Gemini sentence uses "ChatGPT, connected the same way" too; its short form keeps "Kosmos cannot tell a free key
  from a paid one".
- After a consented ChatGPT read could not run, the server answers `noModelAfter(reader)`, which does not offer ChatGPT.
- One combination's whole sentence is written out in a test, so the composition is not only checked against itself.

## Review rounds 6-7 (calls)
- The composed answer LEADS with what reads (Claude first, ChatGPT not offered again), then the person's ChatGPT reason,
  then Gemini's one sentence, then the closing CSV sentence: the card's ask is to lead with Claude, and round 3's order
  put Claude last behind two refusals. One `composeWhy` serves the no-reader answer and the after-a-failed-read answer
  (`noModelAfter`, which now says why: WHY_NO_CODEX, with what to do).
- "(an OpenAI key also reads a PDF)": ChatGPT is OpenAI too and does not read a PDF.
- Not an issue (round 6): a key read never reports unavailable (only Claude and Codex do, when their program is gone).

## Review rounds 8-9 (calls)
- The Gemini sentence leads with Claude too (its refusal comes second), and a test anchors both sentences to start
  with Claude on both platforms.
- One `whyFrom(sub, got)` gives the reason for no reader before consent and after a read that could not run.
- WHY_NO_CODEX says what connecting does ("connecting OpenAI again in Settings, AI Models installs it"): Kosmos
  installs a provider's program when it is connected.
- Deferred: "ChatGPT, connected the same way, also reads" does not list ChatGPT's refusal cases (catalog, version,
  AGENTS.md, managed settings); each is told, with what to do, the moment it applies.

- Deferred (round 10): after a Claude read could not run (Claude's program gone), the answer is the usual sentence,
  which leads with Claude. That is what this route answered before this branch too; a Claude-specific "could not
  start" wording is a separate change.

## Tests
- server.orgchart-read-4559.test.js: the sentence starts with Claude and has no "API key".
- engine/orgchartcodex.test.js: both sentences on both platforms (ChatGPT only off Windows, no "API key", key routes
  named); a refused ChatGPT's reason wins over Gemini's, with a no-ChatGPT control.
- docs/browser-checks/render-orgchart-file-4559.js: the NO READER check asserts the same on the page.
