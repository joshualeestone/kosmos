# #5975 part 2: a company's console sees Qwen agents as alibaba

**Branch:** `qwenrollup-5975` · **Card:** kosmos#5975 (part 2: Enterprise governance of a company's own model), after #5977 (PR #6043) merged.

## Done looks like

The rollup BODY the board sends to the company console carries `alibaba` for a Qwen agent, running or stopped, never `openai` and never blank. A company can already allow or block `alibaba` by policy; after this it can also see which agents run on its own model.

## What I measured before building

- **Policy works already.** `orgpolicy.allows` compares the agent's provider name with `providers_allowed` and is not tied to any provider. create.js checks a Qwen agent as `alibaba` with its account's model.
- **The coordinator accepts the name** (kosmos-relay origin/main, read): `providers_allowed` is checked for shape only (`names_ok`, org.rs ~1007), and the inventory's `RollupAgent.provider` is an `Option<String>`, checked by `opt_short` (~1554) and stored as sent (~1680). orgconsole.rs counts by the raw string. No coordinator change is needed.

## The board side had three places, not one

My first version missed two of them; the first blind review found both.
1. `PROVIDERS`, the set `build()` filters every agent's provider through before sending. Anything outside it goes as `null`.
2. `KNOWN_PROVIDERS`, the set `defaultSources()` uses in `providerOf` and `recordedRunner`. It was a second copy of the same six names.
3. `providerOf` for a codex agent with NO launch job. `recordedRunner` reads the runner off the profile (`alibaba` maps to `codex`), and `create.agentProvider(name, 'codex')` with no job falls back to `openai`. So adding `alibaba` to the sets alone would have sent such an agent as `openai`, which #5977 review 2 ruled out.

## The change

- `PROVIDERS` gains `'alibaba'`, and `KNOWN_PROVIDERS` is now the same set (`= PROVIDERS`), so the two cannot drift again.
- `providerOf`, codex only (the one runner two providers share): the launch job decides, through `create.codexJobProvider`; only when there is no job does an `alibaba` profile make it `alibaba`. This is the rule accountproblem.js already uses (#5977 review 3: the job wins over a stale profile).
- Tests in `engine/qwen-review2-5977.test.js`, aimed at what is SENT:
  - review 2's test now expects `alibaba` (with its `openai` control);
  - `build()` itself carries `alibaba` in the body (control: an unknown provider still goes `null`);
  - a stopped Qwen agent with no job goes as `alibaba` through `recordedRunner` then `providerOf` (control: a no-job OpenAI agent stays `openai`);
  - an OpenAI job with a stale `alibaba` profile stays `openai`.

## Shown failing, one break per test

- `alibaba` out of `PROVIDERS`: the body test, the review-2 test and the no-job chain test fail.
- the profile fallback removed: the no-job chain test fails (it reports `openai`).
- the profile allowed to beat the job: the job-wins test fails.

## Not changed, so nobody reads it as a bug

- A Qwen agent's MODEL still goes as `null`. `MODEL_ID` and `providerOfModel` know no Qwen family, and a self-hosted model's name can be anything, so it is not a name the board can vouch for. Usage rows are withheld today, so they are not affected.
- The console shows the raw name `alibaba`, not "Qwen". A friendlier label belongs on the console side; the board must send the same name the policy uses, or the inventory and the policy would disagree.

## Rejected

- Sending `qwen`: the policy check uses `alibaba`.
- Leaving `recordedRunner` to return `null` for a no-job Qwen agent: it would drop the agent's provider when the profile says exactly what it is.

## Weakest premise

That a stopped agent's `alibaba` profile is current when there is no job. A switch away from Qwen writes a job, so a no-job agent has not been switched; accountproblem.js relies on the same reading.
