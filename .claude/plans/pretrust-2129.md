# kosmos#2129 - CATASTROPHIC: no agent comes online on a fresh macOS user

Josh live-tested v0.6.28 on a FRESH macOS user (scarlett). Every Kosmos-spawned agent
wedges on its runner's trust-folder prompt (Claude Code for Don, codex for Susan), a TUI
prompt Kosmos has no UI to answer (default = exit = the agent dies). Card kosmos#2129.
Josh's ruling: "we should just be electing that we trust this folder and not showing this
to white-collar end users." Splinter hand-fixed the same class for the fleet bots
(hasTrustDialogAccepted entries) on 2026-09-04.

## Investigation (the card is LIVE, but not for the reason it states)

The card says "the missing piece is auto-trust." That is not quite right: the pre-trust
machinery ALREADY EXISTS in 0.6.28 and is wired into agent creation:
- Claude: `engine/trust.js` `trustFolder` writes `projects[dir].hasTrustDialogAccepted=true`
  (+ `preacceptBypass` for the --dangerously-skip-permissions consent).
- Codex: `engine/create.js` `trustCodexFolder` writes `[projects."dir"] trust_level="trusted"`.
- Both are called at create.js:3161-3203 (Claude) and 3068-3076 (codex), gated on the folder
  we just made.

The current checkout IS 0.6.28 (package.json), and both trust calls landed Aug 21/24, before
the Sep 3 cut - so the version Josh tested HAD them. So the card is live because the EXISTING
pre-trust has a defect on the fresh-install path, not because it is missing.

### The CONFIRMED bug (Claude arm - Don): trustFolder REFUSES to create on a fresh install

`trustFolder` (trust.js:181-184) deliberately refuses when `~/.claude.json` is absent
(`ENOENT` -> "Claude Code has not run on this computer yet") or empty. That is EXACTLY the
fresh-macOS-user state. So on a fresh install the Claude trust entry never lands, and the
agent parks on the trust prompt. Empirically proven: `trustFolder(dir,{configDir:freshDir})`
-> `{ok:false, because:"Claude Code has not run on this computer yet"}`, nothing created.

The asymmetry that gives it away: the PAIRED call `preacceptBypass` (trust.js:524-573)
ALREADY creates settings.json when absent, for exactly this fresh-install case (#1919), and
its docblock explicitly contrasts itself with trustFolder's refusal. So on a fresh install
the bypass consent gets written but the trust does not - and the trust prompt fires.

### The FIX (Claude arm): createIfAbsent, opt-in, minimal, mirroring preacceptBypass

Add a `createIfAbsent` option to `trustFolder`. When set and the config is absent/empty,
CREATE a minimal `{projects:{[key]:{hasTrustDialogAccepted:true}}}` at mode 600 (a trust
PREFERENCE, not a fabricated session history - the distinction the refuse-on-absent default
protected), keyed on the realpath, with the same atomic temp+rename write and symlink refusal.
Default (no flag) still refuses, so every existing caller and test is unchanged. The
create-time caller (create.js:3188), which just made the folder, opts in - Claude-only
(`createIfAbsent: provider !== 'openai'`), since on OpenAI the configDir is a CODEX_HOME.

### The Codex arm (Susan): already creates trust on fresh - a separate, unreproduced wedge

Verified END-TO-END through the real create path on a fully-fresh sandbox:
`create.createAgent({provider:'openai'})` with an absent CODEX_HOME CREATES
`config.toml` with `[projects."<workerdir>"] trust_level="trusted"`. So the codex arm is NOT
broken by the missing-create mechanism - unlike Claude, `trustCodexFolder` already creates the
file when absent.

So Susan's wedge on scarlett's fresh account is NOT explained by the code on a no-symlink
account, and I could not reproduce it. Two honest possibilities, flagged for the fresh-account
re-test rather than guessed at on the critical path:
1. A separate latent codex bug I DID find: `trustCodexFolder`/`forgetCodexFolder` key on the
   RAW `dir`, not the realpath. The Claude side deliberately realpaths (trust.js:146-156) and
   warns a symlinked `~/work` would leave "a trusted entry nothing ever reads." IF scarlett's
   path had a symlink component, codex (canonicalizing cwd) would miss the raw-path entry. But
   this is unconfirmed (whether codex canonicalizes cwd is not verified here) and does NOT
   apply to a no-symlink path, so making it now would be a speculative change to a working path
   on the critical path. Flagged as a separate finding.
2. A codex-version issue on scarlett's machine.

## Scope of THIS PR

- FIX the confirmed Claude arm (createIfAbsent). This is the primary, catastrophic bug, on
  the DEFAULT provider, and directly implements Josh's ruling.
- Do NOT change the codex arm (it creates trust on fresh; the raw-path finding is separate and
  unconfirmed). Flag the codex findings for Josh's fresh-account re-test.

## Tests

- `engine/trust.createifabsent-2129.test.js` (9 arms): default still refuses on absent/empty;
  createIfAbsent creates a minimal 600 config keyed on realpath; fills an empty file; is
  idempotent; merges into an existing config (preserves other projects/settings); still refuses
  a symlinked target (the safety guard is not bypassed by the flag).
- `engine/create.trust-configdir-1629.test.js` (+2 arms): a Claude agent's trust write receives
  `createIfAbsent:true`; an OpenAI agent's does not.
- All existing trust tests (trust.test.js 36, trust.flip-1629 6, create.trust-configdir 2->4)
  stay green - the default path is unchanged.

## Verification

Runtime behaviour on a fresh macOS user account is Josh's batched clean-machine pass (no window
server in CI, no fresh account here). Done = Josh confirms Don (Claude) comes online; and
whether Susan (Codex) does too, which tells us if the codex raw-path finding needs its own fix.
Reporting to Splinter. Merge-on-green per beta.
