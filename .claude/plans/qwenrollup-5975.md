# #5975 part 2: a company's console sees Qwen agents as alibaba

**Branch:** `qwenrollup-5975` · **Card:** kosmos#5975 (part 2: Enterprise governance of a company's own model), after #5977 (PR #6043) merged.

## Done looks like

A Qwen agent reaches the company console with provider `alibaba`, running or stopped, never `openai` and never blank. A company can already allow or block `alibaba` by policy; after this it can also see which agents run on its own model.

## What I measured before building

- **Policy works already.** `orgpolicy.allows` compares the agent's provider name with `providers_allowed` and is not tied to any provider. create.js checks a Qwen agent as `alibaba` with its account's model.
- **The coordinator accepts the name** (kosmos-relay origin/main, read): `providers_allowed` is checked for shape only (`names_ok`, org.rs ~1007), and the inventory's `RollupAgent.provider` is an `Option<String>`, checked by `opt_short` (~1554) and stored as sent (~1680).
- **The only gap was the board's own list.** `KNOWN_PROVIDERS` in engine/orgrollup.js had no `alibaba`, so #5977's review 2 sent Qwen agents as `null`, reasoning that the company side was not known to accept the name. It does.

## The change

- `engine/orgrollup.js`: add `'alibaba'` to `KNOWN_PROVIDERS`, and replace the review-2 comment's reason, which no longer holds.
- That list has two uses. `providerOf` (running and stopped agents with a launch job) now sends `alibaba`. `recordedRunner` (a stopped agent with no launch job) reads `alibaba` from the profile and maps it to `codex`, where it used to send no runner.
- `engine/qwen-review2-5977.test.js`: the review-2 test now expects `alibaba` and keeps its `openai` control. A new test covers the profile path, with an unknown provider as its control.

## Shown failing

With `alibaba` taken back out of the list, both assertions fail (2 of 2). Restored, they pass.

## Validation

The Qwen review test, the four orgrollup suites, orgenroll print and server, and the file-scanning guards: 218/218.

## Weakest premise

That the console should show the raw name `alibaba`. The console prints the provider string as sent, so a company admin sees "alibaba", not "Qwen". A friendlier label belongs on the console side, not here; the board must send the same name the policy uses, or a policy and the inventory would disagree.

## Rejected

- Sending `qwen` instead: the policy check uses `alibaba`, so the inventory and the policy would name it differently.
- Waiting for a coordinator change: none is needed, as measured above.
