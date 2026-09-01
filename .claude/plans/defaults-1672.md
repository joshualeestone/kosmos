# defaults-1672: an agent can be created without the block that teaches it to talk

kosmos#1672.

## The defect

`engine/create.js` wrapped the defaults append in a `try` whose `catch` was empty. The block
carries `kosmos post` and `kosmos msg`, so an agent that loses it **does not know how to answer
a person at all** - and creation reported success.

**Twelve lines below, the connections block does the same job and DOES report its failure.**
Same file, same non-gating posture, opposite reporting. The non-gating decision is right in
both cases; the silence was the defect.

## The call, since the card explicitly left it open

The card said closing it was reasonable if nobody thought an unreproducible `catch` was worth
a step. **Fixed instead**, because the fix is the neighbour already written, it cannot cost
anybody their agent, and the consequence if it fires is total for that agent.

## What I measured that the card had not

**`appendTo` itself cannot throw.** It is `String()`, `.includes()` and a template literal.
The throw path is the two `require()` calls the `try` also wraps, which fail on a partially
synced install - a thing that has happened on this box.

**And a code-level break is already caught**: making `appendTo` throw reds **6 of the 141**
existing tests. So this step is not for a broken build; it is for a broken **deployment**,
which no test can see. That narrows the card's urgency and is worth stating rather than
letting the step look like it guards more than it does.

## The weakest premise I named, and it nearly went the wrong way

I said I would check where `steps` renders before assuming that mirroring the neighbour
reaches anybody. **My first check said the page does not consume `steps` at all** - an
over-aggressive filter had hidden the real hits, and I nearly abandoned a correct fix.

Checked properly: `paintMade(result.steps, ...)` at three call sites, and
`tickLine(s.ok ? 'done' : 'fail', s.label)`. **A step with `ok: false` renders as a fail line
the person sees.**

## Verification

143 tests, 0 failed (was 141). Two arms:

- with `appendTo` throwing: the agent is **still created** and creation **names the loss**
- CONTROL: a healthy create does **not** claim the working rules failed, so the assertion
  cannot pass on a step that is always pushed

**Perturbation: removing the step push fails exactly the first arm**, control green.

📌 My first version of the test failed for a reason worth recording: it skipped the suite's
`recorder()` / `setDryRun(false)` setup, so it exercised a different path. A hand-rolled
fixture answering a different question, again.
