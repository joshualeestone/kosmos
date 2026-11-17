# modelid-8618: a model switch takes a model's full id, and a refusal names what it accepts

Card: kosmos#8618 (Echo's daily feedback pass, 11-16). Switching an agent's model refused the full model id
("claude-opus-5-5") and accepted only the menu key ("opus55"); the refusal said only "pick a model from the list", so
the agent found the value by trial.

## Decision
- engine/create.js modelFor resolves a Claude model by its menu key OR its full id (`arg`). It is the one resolution
  setModel (the model route) and createAgent use, so both accept either; the row found is the same, so the job is written
  with the same id and the company policy (policyAllows already takes either name) is asked about the same model.
- pickModelWords(provider): the refusal for an unknown Claude model lists every menu key of that provider and says a full
  id works too ("pick a model from the list: fable52, ..., haiku (or a model's full id, such as claude-fable-5-2)").
- server.js's provider switch (POST /api/agent/<name>/provider with a model) checked create.MODELS by key alone in its own
  code; it now resolves through create.modelFor and its refusal carries the same list.
- The "is not a model <provider> runs" refusal also recognises a full id from the other vendor's list.

## Rejected
- Changing only the refusal: the card's first ask is to accept the full id, which is unambiguous (one row per id).
- Accepting display labels ("Claude Opus 5.5"): not asked for, and labels change wording more often than ids.

## Weakest premise
That nothing depends on modelFor answering null for a full id. Its callers (setModel, createAgent, the provider route)
all want the row; create.test.js's modelFor tests still pass (a key, another vendor's key, a missing key).

## Tests
- engine/create.test.js: setModel by full id lands on the opus55 row and writes claude-opus-5-5; the refusal names every
  menu key and the full-id hint; modelFor by id; CONTROL: a near id is not a model.
- server.switch-model-5429.test.js: a switch to Claude by full id is accepted and carries the model; CONTROL: a near id is
  refused, nothing changed, and the refusal lists the keys.
- Mutants: modelFor key-only, the old refusal words, and the provider route's old key-only check each turn a test red.
