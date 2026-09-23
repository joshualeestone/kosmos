# Provider accounts subsystem: gemini + grok (#3296 + #3391)

Greenlit by Splinter 2026-09-23 (HEADS-UP): build the accounts/credential-management layer under
the two merged launchers (gemini #3484, grok #3490). My lane, un-owned, unblocked. Best-call scope
below; flag Splinter only on a genuine cross-owner decision (a schema Angel owns, an ICK coordinator
change).

## Goal
Let a gemini or grok agent be created ON A NAMED ACCOUNT (its creds stored, the account selected, and
managed), mirroring the codex/openaiaccounts pattern. Today both providers are default-account only:
setAccount refuses them and createAgentInner ignores the account arm (configDir stays null).

## Scope (this slice) and non-scope
IN: engine/geminiaccounts.js + engine/grokaccounts.js (new, mirror openaiaccounts.js); accountenv.js
gemini/grok arms; create.js setAccount + createAgentInner account arms + the plist per-account home;
bin/agent-supervisor.sh per-account KEY injection; the server /api/accounts backend routes
(list/store/forget/remove) mirroring the openai routes; full tests.
OUT (documented, stay as-is): the web/ connect-UI (ICK/Mona lane; the API is testable without it);
observed.js provider account/liveness badge (a follow-on observability slice); installJob /
worldimport.launchSpecOf / worldstarts gemini/grok arms (stay cleanly REFUSED at the installJob root
today, so backfill/repair/import cannot mis-launch); setProvider switch-to-google/xai; MANIFEST
managed install (legacy rung ships today). setModel is already generic for google/xai (free-form ids).

## Measured facts this rests on (grok 1.0.41 / gemini-cli, 2026-09-23)
- An account is a DIR, mirroring codex (~/.codex-<label>, CODEX_HOME) and claude (~/.claude-<label>).
  gemini: ~/.gemini + ~/.gemini-<label>. grok: ~/.grok + ~/.grok-<label>.
- THE HOME-ENV ASYMMETRY (verified in geminisession.js / groksession.js):
  * grok: GROK_HOME is read VERBATIM as the storage root (sessions/ sits directly under it). So a
    per-account grok agent's pane sets GROK_HOME = <account-dir>, and the session reader resolves the
    same dir. Symmetric, one dir.
  * gemini: the real GEMINI_CLI_HOME is the ROOT under which the CLI creates a .gemini subdir. So a
    per-account gemini agent's pane sets GEMINI_CLI_HOME = PARENT(<account-.gemini-dir>); the CLI
    writes to <parent>/.gemini and the reader (geminisession.HOME, which appends .gemini to
    GEMINI_CLI_HOME) resolves the same <parent>/.gemini. The account's storage dir is <parent>/.gemini;
    the env value is its parent.
- THE NEW PLUMBING (the genuinely-new piece vs codex): gemini/grok CLIs read the API key from an ENV
  VAR (GEMINI_API_KEY / XAI_API_KEY), NOT from a file inside the home (codex's key lives in auth.json
  which CODEX_HOME already points at). So per-account key delivery is new: the account module stores a
  per-account key file in the account home (mode-600), and the supervisor injects it into the pane env
  for a per-account agent. The default account (no configDir) keeps the machine-global secrets/env
  door (agent-supervisor.sh), unchanged.

## Design decisions (my best calls; reasoning for review)
1. **Account model = dir, mirror openaiaccounts.js exactly.** Row shape carries provider/providerName
   so it merges into /api/accounts with no UI change. homeDir() is a FUNCTION (the AGENT_WORKFORCE_HOME
   sandbox seam), never a frozen const. Fail-open invariants preserved (absent key = NONE, unreadable/
   unreachable = UNKNOWN, never a false red).
2. **Per-account KEY storage = a mode-600 key file in the account home**, mirroring
   claudeaccounts.storeKey/forgetKey (.kosmos-claude-apikey). File name: `.kosmos-<provider>-apikey`
   (`.kosmos-gemini-apikey` / `.kosmos-grok-apikey`). NOT ~/.config/secrets (that is the machine-global
   agent-operating creds via /add-secret + secrets-map; a per-account operator-provided key lives with
   the account, exactly as codex's auth.json does). Never logged; mode-600 enforced.
   Guardrail satisfied: no hardcoded secret path (resolved from the account dir), nothing pasted in a
   channel, the machine-global default key stays in secrets-map.
3. **Per-account KEY injection = in the supervisor's gemini/grok arms.** When the agent has a
   per-account home (configDir set -> GEMINI_CLI_HOME/GROK_HOME in the pane env), the supervisor reads
   `<home>/.kosmos-<provider>-apikey` and exports GEMINI_API_KEY/XAI_API_KEY from it. When there is no
   configDir (default account), it keeps the existing generic secrets/env door. Best-effort + never
   break the launch (a missing key file falls back to the default door, does not fail the pane).
4. **accountenv.accountEnvVar gains gemini/grok arms**: gemini -> 'GEMINI_CLI_HOME', grok ->
   'GROK_HOME'. The VALUE written for gemini is PARENT(account-dir) (the .gemini asymmetry); for grok
   it is the account-dir itself. The parent transform lives at the create.js configDir->plist boundary,
   documented, so accountenv stays a neutral name-only leaf.
5. **create.js**: replace the setAccount gemini/grok REFUSALs with setGeminiAccount/setGrokAccount
   (mirror setCodexAccount), and the createAgentInner google/xai configDir-null arms with account
   resolution (configDir = acct.isDefault ? null : acct.dir). Birth settings/hook writes already honor
   configDir, so they work unchanged. NO claude trustFolder/preacceptBypass for these (their own
   --skip-trust/--trust launch flags cover trust).
6. **Server /api/accounts**: add gemini/grok listLive() to the merge; add store/forget/remove routes
   mirroring the openai ones. Backend only; the web UI is a follow-on.

## Weakest premise
The per-account key ENV injection is new plumbing with no codex precedent to mirror exactly (codex's
key is a file CODEX_HOME points at, not an env var). The design (supervisor reads the account key file
and exports the CLI's env var) is sound and mirrors how the default door already injects the env var,
but it is the one part not lifted verbatim from a sibling. It will get the most test scrutiny: a
per-account agent gets ITS account's key, the default account keeps the machine door, a missing key
file degrades to the door not a failed launch, and the key never lands in logs/argv.

## Test plan
Unit: geminiaccounts/grokaccounts list/identityOf/checkLive/storeKey/forgetKey/removeAccount/nextWorkDir
(mirror openaiaccounts.test.js + claudeaccounts.test.js). accountenv gemini/grok arms + the gemini
parent transform. create.js setGeminiAccount/setGrokAccount + createAgentInner per-account arms (the
plist carries the right per-account home; the supplied key file is read; default account unchanged).
supervisor per-account key injection (the shipped-from-disk script reads the account key file for a
per-account agent and falls back to the door otherwise). Server route tests mirror the openai ones.
Full whole-tree suite + full challenge-loop before PR.
