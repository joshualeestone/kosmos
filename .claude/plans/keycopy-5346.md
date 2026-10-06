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

## Tests
- server.orgchart-read-4559.test.js: the sentence starts with Claude, names ChatGPT, and has no "API key".
- docs/browser-checks/render-orgchart-file-4559.js: the NO READER check asserts the same on the page.
