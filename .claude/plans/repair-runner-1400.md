# repair-runner-1400: repair keeps a Codex agent on Codex

## The problem

`engine/register.js:302` repairs a missing launchd job with:

```js
const r = create.installJob(name, { model });
```

**No runner.** `installJob` reads an absent runner as claude, and `register.js` contains **zero
references to `provider`**, so it has no way to know the agent is a Codex one.

⇒ **A Codex agent whose job goes missing is repaired into a Claude job**, pointing at the claude
binary with the `codex` argument gone from the plist. **Repair reports success**, launchd starts
it, and the agent runs Claude in a folder set up for Codex.

## Why it matters now rather than eventually

This sits on the **"OpenAI, pre-existing agents"** row of Josh's acceptance 2x2, which shipped
today in 0.6.03. Adoption now writes a Codex job correctly (#1347) and stamps the provider
(#1351) - and the repair path silently undoes both the first time a job goes missing.

## What the fix is

Read the provider alongside the model, from the record `server.js` already uses for this, and pass
the runner through:

```js
const provider = (store.readProfile(name) || {}).provider || null;
const r = create.installJob(name, { model, ...(provider === 'openai' ? { runner: 'codex' } : {}) });
```

## How it is verified

**Both arms in one test, deliberately.** A fix that always passes `runner: 'codex'` satisfies a
codex-only assertion and breaks every Claude agent on the machine, so the pair is the guard:

- a Codex agent repairs to a job carrying `<string>codex</string>`
- a Claude agent repairs to a job that does not

Plus a control for the reachable failure state: a profile that **exists and cannot be parsed**
still repairs, on the default runner, and does not invent a runner.

## What I expect to be wrong about

**The `try/catch` I first wrote around `readProfile` may be unreachable.** If a perturbation that
removes it changes no test, that is the answer and it should come out rather than stay as
decoration - the same call I made on #1306's NaN guard. Measure `readProfile` against corrupt JSON
before keeping it.

**And my first control may be aimed at an impossible state.** `survey()` finds agents by their
profile, so "no profile at all" may never reach repair. If the control fails, that is the reason,
and the reachable case is a corrupt profile rather than an absent one.

## Scope

`engine/register.js` and `engine/register.test.js` only. **Not** `installJob` itself - it already
honours a runner since #1347; this is one caller that never passed one.
