---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: switchdefault-1600
diff_hash: fe80faa26245a2cb73fd24095022cda1085c4fadc62b3c3b974979db0074277b
subdir_audit: passed
timestamp: 2026-08-31T00:33:59Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes. This card asked for a **decision**, and the interesting part is that my first
decision was right in principle and wrong in a case I had named as my own weakest premise.

## [BLOCKER] (mine) I shipped the alignment against `isDefault`, which is not the condition

`openaiaccounts` derives "default" from `codexupdate.defaultHome()`, which honours
`AGENT_WORKFORCE_CODEX_HOME` and `CODEX_HOME` - **the SERVER's environment**. A launchd job does
not inherit those, so under an override the server's default and the agent's default are
**different directories**, and omitting the key sends the agent to `~/.codex` instead of the
home an operator named.

`engine/create.switch-account-1373.test.js` went red, **and it fails alone**, so it was a real
regression rather than the contention I might have hoped for --> FIXED: omit only when the
agent would resolve the same home anyway.

⭐ **I had NAMED this exact risk in my claim comment** - *"CODEX_HOME is codex's own variable
and AGENT_WORKFORCE_CODEX_HOME can override it"* - and then implemented as though I had not.
**Naming a premise is not testing it.**

## [BLOCKER] (mine) Fixing one route would have re-created the card's own defect

`createAgentInner` had the same override hole. A switch-only fix makes the routes agree
**without** an override and **disagree with one** - this card's complaint pointing the other
way --> FIXED: both sites carry the rule, and the test drives **both routes** under an
override and compares them to each other.

## [WARNING] (mine) Two of three test failures blamed the product for defects in my harness

- `account:` where `setProvider` reads **`accountDir:`**. It silently selected the DEFAULT row,
  and the control failed saying *"a non-default row stopped carrying its home"* - **accusing the
  fix of going too wide when the call was malformed.**
- `runner: 'codex'` with no `codexBin` where the shape is `provider` + `codexBin` + `account`.
  Refused with *"we do not know that account on this computer"*, which reads like a missing
  account.
- (The third was real: a `/var` vs `/private/var` realpath mismatch.)

⇒ **A red whose message names the product is not evidence the product is wrong.**

## [STRENGTH] The test asserts the invariant rather than my side of it

Both routes are driven onto the default row and **compared to each other**, with and without an
override. A test that only checked the switch would stay green if somebody later "fixed" the
create path to pin instead.

## Verification

| perturbation | default-row test | override test | control |
|---|---|---|---|
| revert `setProvider` to pinning every row | **RED** | green | green |
| drop the override clause (`isDefault` alone) | green | **RED** | green |
| neither | green | green | green |

Each perturbation reds a **different** arm, which is what says the two rules are independently
guarded. `engine/create.js` restored to its exact sha after each.

Full suite: **3225 tests, 3225 pass, 0 fail**, all four of mine confirmed **by name**.

## Not done

The Claude arm beside the fixed line (`CLAUDE_CONFIG_DIR`) raises the analogous question. That
is #1629's subject, which I shipped separately tonight; conflating them would widen this diff
past what it is about.
