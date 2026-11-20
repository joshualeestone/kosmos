# fbwords-8735: #8735, proposal cuts B and F, decided

## Call
B and F were proposed on #8735 as "wait for a reader". Josh's standing ruling (decide, document, keep going) makes
that a decision of mine, so: build B and F, keep D.
- B, "You do not stop": "Neither of these means you have stopped" keeps its rule (there is no command for having
  stopped, because there is no such state) and drops the history of how the report commands once read as stopping.
- F, "Send readable messages": "What a room shows you" is shorter and names fewer formats: the `---` rule is no longer
  named (it still renders). It keeps the three the #2909 test pins (headings written with `#` to `######`,
  ~~strikethrough~~, a `[label](address)` link showing its address) and says http:// and https:// addresses both link
  (round 1: "a bare https:// address" claimed less than the renderer does). The "does not render" paragraph (raw HTML,
  `>` in a room) and the shell trap are untouched.
Doctrine 59.

## Rejected
- D (the needs_you restatement, "Before you ask, run the two questions..."): kept. It is the line that stops an agent
  asking a person for what it can decide, which is Josh's own rule; a shorter form risks the exact miss it guards.
- A re-read note: each removed line is replaced by a shorter line in the same section.

## Measured
- pm brief 45,382 -> 45,017 (darwin), 365 characters. Ratchet 45,400 -> 45,100.
- 1,750 related tests, 0 failed.

## Weakest premise
For B: that the history did no work once the rule is stated. It was written after agents read the report commands as
permission to stop. What would change my mind: an agent treating `kosmos report blocked` as stopping after this ships.
