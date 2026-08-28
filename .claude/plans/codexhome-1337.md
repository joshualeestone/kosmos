# #1337: one derivation of the codex home, and a test that can see where it writes

## What the card asked, and what changed about it

The card described **two** derivations and said: *check whether they currently AGREE before merging them; if they already differ, that is a live bug rather than a tidy-up.*

**There are four, and they differ.** Measured by calling each:

| environment | create | codexupdate | openaiaccounts |
|---|---|---|---|
| nothing set | `~/.codex` | `~/.codex` | `~/.codex` |
| **`CODEX_HOME=/tmp/user-codex`** | `~/.codex` | **`/tmp/user-codex`** | `~/.codex` |

Only `codexupdate` honoured **`CODEX_HOME`**, which is codex's own documented variable. `codexsession.js` had a fourth copy.

**Cost when it fires:** `trustCodexFolder` (via `codexHomeDir`) and `dismissCodexUpdateNotice` (via `defaultHome`) run one line apart in `installJob`. With `CODEX_HOME` set the trust entry lands where codex is not reading, so the agent starts and stops at the trust prompt - #245 and #1332's failure, silently.

⚠️ `CODEX_HOME` is unset on this machine, so this is latent here. I measured the divergence, not an operator hitting it.

## The change

`codexupdate.defaultHome()` is the one derivation; `create.codexHomeDir()`, `openaiaccounts.defaultDir()` and `codexsession`'s `HOME()` call it. `codexupdate` stays dependency-free, so the launch shim is unaffected and no cycle is possible.

A second axis exists and I deliberately did **not** change it: `openaiaccounts` froze `AGENT_WORKFORCE_HOME` at module load while the others were lazy. Delegating makes it lazy, which is strictly more permissive. I did not go further into load-time-versus-lazy, because that is this codebase's established convention and changing it is risk without a demonstrated defect.

## Verification: the shared helper is actually depended on

Perturbed the one derivation to return a wrong path, then ran every caller:

| file | result |
|---|---|
| `create.test.js` | **RED** (3 fail) |
| `openaiaccounts.test.js` | **RED** (1 fail) |
| `codexsession.test.js` | **RED** (7 fail) |
| `discover.adopt.test.js` | **REFUSED TO RUN** - its #1359 sandbox guard fired |
| `register.test.js` | 🛑 **GREEN** |

Four of five depend on it. **Two different mechanisms** and they are not the same thing: three failed assertions, one guard refused to start. Both count as coverage; only one is an assertion.

## The gap that green found, which is today's incident

`register.test.js` sandboxed the codex home and **asserted nothing about it**. A guard with no alarm: when the seam was absent, the suite wrote a real trust entry into the operator's `~/.codex` and this file reported **21 pass, 0 fail**, four runs running.

Added `#1337: a Codex repair writes its trust entry inside the sandbox, not the real home`.

**Perturbed to prove it is not decoration**, and the first attempt failed to prove anything:

1. Removed the `CODEX_HOME` seam alone -> **GREEN, 0 entries escaped.** The guard was not blind; **my perturbation was**, because `AGENT_WORKFORCE_HOME` is a second seam resolving to the same sandbox. One arm of two.
2. Removed **both** seams, which is exactly main's state before #1411 -> **RED, 22 tests, exactly 1 fail, mine, and 1 entry escaped into the redirected home.**

⭐ The other 21 tests stayed green in arm 2. That is the point: under precisely the conditions that caused today's incident, nothing in this file could see it, and now one thing can.

## What I expect to be wrong about

- **The `codexsession.js` change is the least exercised.** Its 9 tests go red under perturbation so it is depended on, but that module is referenced nowhere in the product, so I have not seen this path run for real.
- **I did not touch the load-time-versus-lazy axis.** If someone is relying on `openaiaccounts` freezing `AGENT_WORKFORCE_HOME` at require, delegating changes that. Its 19 tests pass, but they set env before require, so they would not notice either way.
- **No full suite.** 0.6.05 is cutting; single-file runs only. 194 tests across five files, all green, config byte-identical before and after.

---

## Round 2: Angel's cross-review found the seam I created, two lines from where I fixed it

I asked for a cross-review before opening the PR and named where I thought I was weak. **Angel found something better than what I pointed at.**

I made `defaultDir()` lazy and left the module-level `const HOME` frozen at require time - and that frozen value feeds `list()`'s `.codex-*` SCAN and `nextWorkDir()`. So **`list()` disagreed with itself**: its default entry (`add(defaultDir(), true)`) resolved lazily while the scan beneath it used the frozen value.

⇒ A caller setting `AGENT_WORKFORCE_HOME` after requiring the module got a list whose **default was sandboxed and whose scan read the operator's real home**. Sandboxed and not, in one call, with the sandboxed half being the reassuring one. **That is #1412's shape**, which is why it was not cosmetic.

⭐ **My own plan said the lazy change "matches every other caller" and was "strictly more permissive".** True of `defaultDir()`. False of the file. I wrote a comment describing a property I had given one function and attributed it to the module.

### Fixed and measured, both arms, with a negative control

`HOME` is now `homeDir()`, called at all four sites, with `HOME_FOR_TEST` kept as a lazy getter (no consumer of the openaiaccounts one exists; the four `HOME_FOR_TEST` uses in the tree are all `accounts.` , a different module).

```
pre-fix,  env set AFTER require   ->  list() = 1,  .codex-alpha NOT found
post-fix, env set AFTER require   ->  list() = 2,  .codex-alpha FOUND
post-fix, env set BEFORE require  ->  list() = 2,  .codex-alpha FOUND
```

The negative control against the pre-fix file is what makes the pass evidence rather than a fixture that only ever says two.

Regression test added: `#1337: the .codex-* scan follows a HOME set after require`. **Perturbed by reverting the file: RED, exactly 1 failure, mine.**

### Angel's #1383 note, recorded as she asked

Her `named` gate tests `AGENT_WORKFORCE_CODEX_HOME` only, while `defaultDir()` now also honours `CODEX_HOME`. She traced it and cleared it: in the not-named path the account comes from `list()` and the plist is written with that same dir, so the agent runs in the home we picked. **Self-consistent, not a defect** - but it is a second place where a gate and its resolver read different variables, and it is worth knowing.

### The sibling I did NOT fix here

`engine/accounts.js:43` has the identical frozen `const HOME`, 20 references, exported as `HOME_FOR_TEST`. Measured: with the seam set after require, `accounts.list()` returned **4 real accounts** against an empty fixture. Filed as **#1419** rather than widened into this PR - it is the Claude accounts home, a different fact, and four test files consume its export.

⚠️ And my control there was weak and the card says so: the before-require arm returned 0, so my hand-built fixture is not what `accounts.js` recognises. The freeze is established; the full pair is not.
