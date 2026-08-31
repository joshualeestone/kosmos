# sandbox-requires-tmux-bin: DRY_RUN satisfied the whole-sandbox guard and does not make a roster read inert

kosmos#1651.

## Problem

`engine/sandbox.js` refuses a half-sandboxed board. Its definition of "tmux is inert" accepted `DRY_RUN=1`:

```js
const tmuxInert = Boolean(env.AGENT_WORKFORCE_TMUX_BIN) || env.AGENT_WORKFORCE_DRY_RUN === '1';
```

**DRY_RUN neuters tmux WRITES. A roster is a READ.** Measured in `engine/status.js`: `AGENT_WORKFORCE_DRY_RUN` **0** references, `AGENT_WORKFORCE_FAKE_PANES` **0**, against **104** mentions of tmux. It resolves `AGENT_WORKFORCE_TMUX_BIN || 'tmux'` and nothing else.

⇒ A board sandboxed with DRY_RUN and no TMUX_BIN **passed the guard and enumerated the real fleet**: 18 of 18 agents by name, which is how #1651 was found. Planted and confirmed:

```
DRY_RUN=1, no TMUX_BIN -> guard partial=false (ALLOWED), roster resolves to "tmux"   REAL
TMUX_BIN set           -> guard partial=false (ALLOWED), roster resolves to the stub
real panes visible to that binary: 18
```

## Change

`tmuxInert` requires `AGENT_WORKFORCE_TMUX_BIN`. **Only TMUX_BIN redirects a read, so only TMUX_BIN counts.** The refusal sentence now names both hazards, since the read is the one that bit.

Everything else follows from that: every caller that was relying on DRY_RUN alone now declares the stub it was already using.

## 🛑 Blast radius, and it reaches release tooling

**This is the part a reviewer should look at first.**

- **10 node test files** now name a stub. Six already wrote their own `tmux` into a temp `bin` and put it on PATH, so they name **that same stub** (`nodePath.join(bin, 'tmux')`), preserving their fixtures byte for byte. Four have no stub of their own and use `test-support/fake-tmux.sh`.
- **`tools/test-install.sh` and `tools/build-kosmos-bundle.sh`**, which are release-path. The install harness's own comment already admitted the defect: *"the harness never sets TMUX_BIN, so install/kosmos may hand a board the machine's tmux"*. It now names the stub, which is what that block already intended.
- **`tools/test-build-smoke-sandbox.sh`** asserted the old contract and audits those two scripts against the gate. It passes unchanged once they do.

## Rejected alternative, on measurement

**Make `status.js` treat `DRY_RUN=1` as "no fleet visible"**, which would make the guard's existing acceptance of DRY_RUN true rather than narrowing the guard. It is the smaller change and I measured it before choosing: **7 test files set DRY_RUN and legitimately expect their stub's pane lines** (`engine/remove`, `server.agent-id`, `server.connections-refresh-1649`, `server.forget-openai-1372`, `server.switch-account-1373`, `server.test`, `web.not-running`). Emptying the roster under DRY_RUN breaks those instead.

Requiring TMUX_BIN also leaves sandboxing **explicit** rather than implicit in PATH order, which is the better end state.

## Verification

- **All five guard arms**, including the two that must not change: DRY_RUN-only now REFUSES (the fix), TMUX_BIN allows, `HALF_SANDBOX_OK` still allows, **nothing-set still allows** (the real product), 2-of-4-dirs still refuses.
- **The stale test inverted with its reason.** Its name carried the false premise: *"dry run makes every tmux call a no-op"*. Perturbation: reverting the guard reds it.
- **Full suite through the repo's own runner: exit 0, 3,260 tests, 3,260 pass, 0 fail**, and zero shell-suite failures.

## What I got wrong on the way, since it bears on trusting the file list

My classifier for "which tests reach the guard" was wrong in **both** directions: it missed the two `gate-log` files (my re-measurement dropped the `require('./server')` form my first pass had) and falsely included `engine/projects` (it matched a string where the test *writes* a fixture named `server.js`). **The population came from running the suite, not from the classifier.**

⚠️ **The count in the card, and my own earlier figures of 17 / 11 / 9, were all wrong.** Only a full run settled it.
