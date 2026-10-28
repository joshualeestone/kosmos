# carryclaude-7467: the #5091 partial answer says the conversation did not come across

## Finished looks like

A switch to Claude whose picked Claude account could not be applied, but whose restart worked, answers with the same conversation and notes sentences as the ordinary result. A Codex, Gemini or Grok agent switched to Claude this way is told its conversation did not come across. A switch that keeps its conversation keeps today's words. Tests for both fail on today's code.

## Steps

1. engine/create.js: `switchCarryDetail(label, carried, fromLabel)` is `switchCarryWords` without its "<label> it is." opening, and empty when `carried` is null. `switchCarryWords` is built from it, so its words are unchanged.
2. server.js, POST /api/agent/<name>/provider: the #5091 partial branch, when the restart worked, puts `switchCarryDetail` before "It is starting again now." One `carriedFrom` helper names the old provider for both answers.
3. Tests: engine (the split, and the same-family control) and route (Gemini to Claude partial, and a partial with nothing carried).

Stacked on switchlose-7455 (#7462, same answers, not yet merged): rebase onto main once it merges.

## Decided

- The partial keeps its own first sentence ("is switched to Claude, on your main Claude account: ..."), and the conversation sentences follow it, before "It is starting again now.", the same order as the ordinary result.
- Keyed on `carried`, as the ordinary result is. Rejected: keying on `losesConversation`. That would say the conversation is lost even when the notes copy itself threw, which the ordinary result does not say either. Keeping one rule for both answers matters more.
- Weakest premise: a partial whose notes copy threw (`carried` null) but which did cross the Claude line says nothing about the conversation. That gap is shared with the ordinary result and older than this card.

## Review

1. (blind) No blocker, no warning. switchCarryWords is byte-identical for every input; carriedFrom matches the inline expression; the new tests fail on today's code and aim at the restarted branch; no other place composes this answer. [NIT] the partial says the model words before the conversation sentences, while the ordinary result says them after "It is starting again now": kept, both read in order. [NIT] the engine test covers only the to-Claude notes path (the others go through unchanged code). Converged.
