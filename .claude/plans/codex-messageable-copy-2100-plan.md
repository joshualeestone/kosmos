# kosmos#2100 (copy half): a codex agent is not told "no Claude running"

Branch: `codex-messageable-copy-2100`. Card: kosmos#2100. Author: Renet Tilley (night shift).

## The bug (the half fixable tonight)

Josh created an OpenAI Codex agent; when it was not messageable, Kosmos showed
"there is no **Claude** running in its window" - a Claude-specific message on an agent he
created as OpenAI. That copy is `addressable()`'s not-addressable else-branch (engine/chat.js,
`card.isAgentPane !== true`).

## Why only the COPY, and why it is safe (verified against the code)

#2100 has two defects. Angel scoped them; I verified the split against the code:

- **Defect #2 (composer disabled / send path) - DEFERRED.** Enabling messaging for a codex pane
  fires the Claude-tuned send path (a blind Enter; the #1629 trust-dialog guard is Claude-specific,
  so codex gets no dangerous-state protection). Verifying it is safe requires typing into a LIVE
  codex agent, and codex creation is broken (#2099, needs Josh's machine). Shipping it on unit
  tests alone could disrupt Josh's real OpenAIBot - worse than the honest "cannot message". Not
  shipped. Joins the morning-with-Josh cluster (#2094 / #2099-half-2 / #2100-send-path).
- **Defect #1 (the copy) - SHIPPED HERE.** The else-branch is reached when the pane holds a SHELL
  (isClaudeCommand false), not the agent's own process. Changing its wording does NOT touch
  isAgentSession/isAgentPane, so the composer stays honestly disabled and the send path is never
  enabled. Confirmed separable in code.

## What I got right by MEASURING, not inheriting the framing

Angel's diagnosis ("isAgentSession is Claude-only, so a codex agent fails it") is incomplete, and
the #571 test proved it: a RUNNING codex agent fronts as a `node` process, `isClaudeCommand`
accepts `node` (npm-global Claude also fronts as node), so a running codex agent PASSES
isAgentSession and IS messageable (send works, with the codex Enter-gap). So the "no Claude
running" message appears only for a codex agent whose pane is a SHELL - a DEAD one (the #2099
population). The honest fix is therefore NOT "messaging codex isn't supported yet" (a running
codex IS messageable) - it is naming the runner whose process is missing.

## The fix

In the not-addressable else-branch, name the runner: `card.runner === 'codex' ? 'Codex' : 'Claude'`.
The reason is identical in both cases (the pane would RUN typed text), only the process name
differs. A genuinely-stopped Claude agent keeps "no Claude running" (the control); a dead codex
agent reads "no Codex running".

## Weakest premise

That `card.runner` is reliably 'codex' for a dead codex agent. It is the supervisor-recorded tmux
user option, set at launch and surviving the process's death (the same field #571 and the codex
classify dispatch rely on), so a dead codex pane still reports runner 'codex'. If it were ever
absent, the fallback is 'Claude' (the pre-existing wording) - a safe degrade, not a new failure.

## Tests

- `engine/chat.test.js`: a dead codex agent (shell pane + runner codex, classifies UNKNOWN) is
  refused with "no Codex running", not "no Claude running"; and a discriminating control - a
  stopped CLAUDE agent KEEPS "no Claude running" (proves it is provider-aware, not a blanket
  reword). Both directions armed.
- Regression: `server.projects.test.js` (which pins the Claude line for a stopped Claude agent)
  stays green.

## Scope boundary

Card #2100 stays OPEN for defect #2 (the send-path / composer-enable), which needs #2099 + a live
codex agent + a codex dangerous-state guard.
