# kosmos#1919 (root cause B, launch side): pre-accept the bypass consent at agent creation

Branch: `bypass-consent-preaccept-1919` (joshualeestone/kosmos). This is the FOLLOW-UP to
the read-side PR #1933. Both leave #1919 open. Splinter pre-approved the condition-1 scoping.

## The defect this half fixes

A freshly-created agent parked on Claude Code's "Bypass Permissions mode" consent prompt
and never started. The supervisor already passes `--dangerously-skip-permissions`
(bin/agent-supervisor.sh:408); that flag needs a ONE-TIME interactive acceptance the first
time it runs in a config dir, and the supervisor launches non-interactively into tmux, so a
new agent on a fresh install lands on the consent (highlighted default `No, exit`).

The read-side PR (#1933) makes the board TELL THE TRUTH about that state (needs_you, not
UNKNOWN). This half stops the agent LANDING there at all, for agents WE create.

## Measured facts (not assumed - this codebase's discipline, matching trust.js)

- The acceptance key is `skipDangerousModePermissionPrompt: true` at the TOP LEVEL of
  `settings.json` (NOT `.claude.json`, and NOT per-project). Measured: all three fleet
  config dirs (`~/.claude`, `~/.claude-account-b`, `~/.claude-account-c`) already carry it
  alongside `defaultMode: bypassPermissions` - which is precisely WHY fleet agents never
  hit this prompt and the external tester (a fresh product install without it) did.
- File location: `$CLAUDE_CONFIG_DIR/settings.json`, or `~/.claude/settings.json` when
  CLAUDE_CONFIG_DIR is unset (same configDir resolution trust.js uses at trust.js:70-75).
- create.js already resolves each agent's `configDir` (`acct.isDefault ? null : acct.dir`,
  create.js:776) and already calls `trustFolder(workerDir, {configDir})` +
  `trustCodexFolder(workerDir, configDir)` at create time. This writer goes RIGHT THERE.

## How this DIFFERS from trustFolder (so it is not a copy-paste)

trustFolder writes a PER-PROJECT key into `.claude.json`, which holds Claude Code's SESSION
STATE (project history, costs). It REFUSES to create `.claude.json` from nothing, because
that would fabricate a session history for a tool that has never run here.

The bypass key goes into `settings.json`, which holds PREFERENCES, not session state. A
`settings.json` containing only `{ "skipDangerousModePermissionPrompt": true }` is a valid,
minimal, honest settings file - it fabricates no history, it states one preference for an
agent the operator explicitly created in bypass mode. So this writer CREATES settings.json
if absent (unlike trustFolder), which is what makes it work on a fresh product install (the
tester's case). It still mirrors trustFolder's SAFETY: refuse on a symlinked target, refuse
on a non-object shape, preserve file mode, atomic write, and an undo that restores the prior
value (displaced/madeEntry), never inventing a state that was not there.

## Scoping (Splinter's condition-1 caution, on the record - this REMOVES a safety prompt)

What the pre-accept COVERS: for an agent the operator EXPLICITLY created in bypass mode, the
one-time consent that the already-passed `--dangerously-skip-permissions` flag itself
implies. It grants NOTHING new - the flag already set what the agent may do; the pre-accept
only removes a redundant interactive gate for a decision the operator made at creation.
What it does NOT cover: any blanket permission, any OTHER prompt (a different-folder trust
dialog, a mid-session permission dialog), and it is scoped to the per-agent config dir,
never global.

## Design

1. `preacceptBypass(configDir, opts)` in `engine/trust.js` (it owns the config-file
   read/write machinery already): resolve `$configDir/settings.json` (or
   `~/.claude/settings.json`); read-or-create; if the top-level key is already `true`,
   success (already); else merge `skipDangerousModePermissionPrompt: true` at top level via
   an atomic write with mode preservation; return `{ ok, already?, displaced?, madeFile? }`
   for an undo symmetric with trustFolder/forgetFolder. Refuse on a symlinked target and a
   non-object shape, exactly as trustFolder does.
2. Call it from create.js. WIRING MAP (measured during the build, correcting the plan's
   first guess): the sole trustFolder call (create.js:775) is in `setAccount` (the
   account-CHANGE path), gated `if (job.runner === 'codex') REFUSE` so it is Claude-only.
   So preacceptBypass belongs in TWO places, both moments a Claude agent's config dir
   becomes real:
   - setAccount (create.js:~772-780), right after the trustFolder call, same best-effort /
     non-gating / reported-not-swallowed pattern, adding a `bypass` field to its return.
   - the INITIAL create path (`createAgentInner`), where a new agent's account is first
     established. STILL TO MAP: createAgentInner does not itself call trustFolder (the only
     call is setAccount's), so find where a NEW agent's config dir / trust is set and add
     the preaccept there too. A default-account agent (configDir null, ~/.claude which
     already carries the key on this fleet) needs nothing; a non-default account (a fresh
     product install, the #1919 case) is the one that hits the prompt.
   Rollback: wherever creation calls forgetFolder on a bootstrap failure, also call
   forgetBypass(configDir, displaced, madeFile) to undo the settings.json write.

## STATUS (checkpoint)
DONE and unit-tested: `preacceptBypass` + `forgetBypass` + `SETTINGS`/`BYPASS_KEY` in
engine/trust.js (the novel, safety-critical writer). Smoke-tested all arms: create-if-absent,
already, undo-created (file removed), merge (other keys preserved), undo-merge, symlink
refused. Existing trust.test.js still 29/29.
REMAINING: map createAgentInner's trust moment and wire preacceptBypass there + in
setAccount + forgetBypass on rollback; formal trust.test.js arms (the smoke test is the
template); a create.js test that the create path invokes it; challenge-loop; PR.

## Tests (control-bearing)

`engine/trust.test.js` (which already tests trustFolder): absent settings.json -> created
with only the key; existing settings.json -> key merged, other keys preserved, mode
preserved; already-true -> success/already, no write; symlinked target -> refused; a
non-object settings.json -> refused; undo restores the prior state (absent stays absent,
a prior explicit value is put back). A create.js test that the create path invokes it.

## Open question to resolve during build (measure, do not assume)

Does a fresh Kosmos PRODUCT install (the tester's 0.6.22, not the fleet dev setup) already
have a `settings.json` in the agent's config dir? The create-if-absent design covers BOTH
cases, so this does not block the build - but confirm the product install flow does not
ALSO write settings.json in a way that would race or conflict with this writer.

## Out of scope
- The read side (PR #1933).
- Changing Claude Code's upstream dialog or its `No, exit` default (upstream, not ours).
