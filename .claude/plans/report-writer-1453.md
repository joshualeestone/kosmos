# #1453 + #1456: the record says who wrote a line, and #900's protection reaches Codex

## Why one PR and not three

The field #1453 asks for is **wrong on five of six hook paths and on the whole Codex path** until those are fixed. Shipping it alone ships a field that cannot be honoured, and it would answer the card's own motivating question with the bias flipped from the safe direction to the unsafe one. Splitting would also produce three PRs touching the same six lines, which is the sibling-PR conflict this repo hit twice on 2026-08-27.

## The card, and the correction that changed its shape

`selfreport.record` takes `entry.auto` as a **write-time** discriminator for #900 and drops it before the write. The rule's own comment says why that is a gap: *"marking the writer is the only way to tell those apart, because the two produce an identical line."* The distinction the code names as necessary is discarded by the function that names it.

Before writing the field I checked what `auto` means **today**, and it is not what it is documented to mean. `install/kosmos:693`: *"--auto marks a report the MACHINE wrote on the agent's behalf (a lifecycle hook), not one the agent chose to send."* The hook passed it on **one of six** report calls.

⇒ Persisting `entry.auto` as-is stamps five of six machine-written reports as `agent`. Worse than no field, because it looks authoritative.

## #1456, found by the same check

`bin/codex-report-bridge.js` omitted `auto`. `agent-turn-complete` is the Codex analogue of `Stop`; the route reads `body.auto === true`; #900's guard is scoped to `auto === true && state === 'idle'`. The branch was never entered.

```
SUBJECT  codex-shaped idle (no auto):    idle     <- a standing `blocked` is GONE
CONTROL  claude-shaped idle (auto:true): blocked  <- preserved
```

A Codex agent that filed `blocked` had it erased by its own next turn. #900's original sentence, on the other runner. **Same shape as #249:** correct on Claude, structurally unreachable on the other provider; one boolean instead of one glyph.

## The three changes

| file | change |
|---|---|
| `bin/codex-report-bridge.js` | send `auto: true` |
| `install/kosmos-report-hook.sh` | `--auto` on all six report calls |
| `engine/selfreport.js` | persist `by`, read it back, null for legacy |

Marking the other five hook calls is **inert for behaviour**: the guard refuses nothing but `idle`. The risk it creates is named in the hook's header comment: widening that guard later would make these five refusable, and the guard's own comment explains why it must stay narrow.

## The two decisions the card left open

- **`v: 1`, not `v: 2`.** `read()` picks fields by name; no reader asserts a key set on a report line (`deepStrictEqual`: 0 files; the `ROSTER_FIELDS` tripwire pins `paneRoster`, not this); nothing spreads a reading (0 hits, control 207). A bump makes every reader handle two shapes for a change none of them has to handle.
- **`by`, not `auto: true`.** Three states to separate, and a boolean has two: `'auto'`, `'agent'`, `null` for a line written before the field existed. An omitted boolean collapses the last two, which is the ambiguity the card exists to remove. Same posture `instance` already takes.

The stored value uses the **same predicate the rule branches on**, so the record says what the rule saw rather than a re-derivation that can drift.

## The guard

`report-hook-auto-1453.test.js` asserts the **class**, not the five lines that were wrong: a seventh report call is the real failure mode, since it would be written against the shape of its neighbours. Population floor included, so a renamed or unreadable hook cannot pass as clean.

## Verification: perturbed, not merely run

Hook guard, three arms, each failing **its own test and only its own**: `--auto` stripped; `--auto` moved after the free text where the CLI flag loop has already broken; hook emptied (floor).

Source, four arms, red each, green on restore: field never persisted (3 fail); field always `'agent'`, **the naive fix the card asked for** (2 fail); legacy defaulted to `'agent'` instead of `null` (1 fail); bridge `auto` removed (1 fail).

Full suite via `tools/run-tests.sh`, not a glob: **2888 pass, 0 fail**. Runner globs cover all 264 test files (74 engine + 190 root). All eight new tests confirmed in that run by name, against a control name returning nothing.

## What I got wrong, kept because it is the reusable part

The first perturbation run restored with `git checkout <path>`, which **discards unstaged work**, so it reverted the change under test, and arms 2 and 3 ran against the original file while reporting reds that looked like success. Caught only by an after-restore control that should have read green and did not. Without that line I would have reported three validated arms and had one.

## What I deliberately did not do

**Surface `by` anywhere.** This stores it and reads it back; nothing renders it. If no reader ever wants it, #1453's own weakest-premise note stands and the field is worth its cost only because #1456 exists.

## Weakest premise, named

I have not driven a live Codex agent end to end. The #1456 proof is at the `selfreport` layer using the bridge's exact body shape read off the file, plus the bridge's own test driving the real process and capturing the POST. If the bridge is not wired on a given machine, the defect is latent rather than active. **That changes when it bites, not whether the code is wrong.**

## Cross-review, and what it found

`/challenge-loop` and `/pre-challenge` both require the Agent tool, which agents here are instructed not to invoke. That is #1404. This branch took the route recorded on that card: a **cross-review by message**, with the criterion that card says actually works, which is not *"review this diff"* but *"find a surviving mutation: break a line this branch defends and keep the suite green."*

Ice Cream Kitty reviewed it against `ba98d2e8`, on a scratch copy sha-verified against my worktree, with anchor match counts printed before each edit.

### Two surviving mutations, both in my guard

```
seventh) report needs_you "x" ;;    SURVIVED
report "$STATE" "x"                 SURVIVED BOTH
```

The first matters most because **the hook is a `case` statement** and all six calls live in an arm, so an inline arm is the natural shape for a seventh event. My separator class had no `)`.

The second is worse in kind: `[a-z_]+` cannot match a variable, so the call was invisible to the matcher **and absent from the floor count**, which is exactly the case the floor exists to make impossible. A guard cannot count what it cannot parse.

Her fix closes both and the shapes nobody has thought of: assert a **LOOSE count equals the STRICT count**. The floor asks whether the file was read; this asks whether all of it was understood. Both read 6 today. Its cost is recorded rather than discovered: LOOSE can match prose, so the failure message prints both counts.

### Three claims attacked and cleared, one of them sharpened against me

- **`--auto` inert on non-idle states: true.** She read the scope and agreed.
- **The `by` predicate cannot disagree with the rule: true, and she made the better point.** They cannot disagree *because they are the same expression*, which means they can only be **wrong together**, and that is worse than disagreeing because a disagreement would be detectable. She then traced the chain that makes it safe: `install/kosmos:748` emits a real JSON boolean and `server.js` compares strictly. **The property holds because of the CLI and the route, not because of my tests** which pass `auto: true` in JS directly and would not have caught a serialization mismatch.
- **#1456 could not be broken.** She attacked it from the angle I had not: whether Codex agents already had #900's protection by another path. They cannot. The hook is installed into Claude's hooks; Codex is wired through `notify` to the bridge. Two disjoint mechanisms, so the bridge was a Codex agent's only reporter.

## The decision on shipping, and whose it was

Her ruling on my blocker question, adopted: **the live pass is not a blocker to shipping and is a blocker to claiming.** Before this branch `auto` was absent on 100% of the Codex path, measured on the installed artifact with a control, so the change cannot make that path worse, and holding it back would keep a proven-active defect in place to buy a verification that would not change the decision.

⇒ So this ships, and **#1456 says on the card that the end-to-end pass is outstanding.** Three layers proven separately is not the chain proven end to end, and a correctness claim about live agents is the one kind of sentence that needs the behaviour rather than the mechanism.

## The pattern across this branch, which is the thing I would tell somebody else

**Three times a guard I had just written was blind to the thing it existed for.** I found the first two myself, and only because I had written to a reviewer naming where the guard was weakest, which is what made me go and look. The third needed her.

Renet Tilley's finding on #1404 predicted exactly this: five rounds of self-review still found blockers, and it was a different reader each time that made it work, not the number of rounds. **Self-review did not converge here either.**
