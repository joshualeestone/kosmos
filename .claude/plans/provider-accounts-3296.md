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
  gemini: ~/.gemini + ~/.gemini-<label>. grok: ~/.grok + ~/.grok-<label>. `row.dir` (== the agent's
  configDir) is the account dir itself, and it IS the env value (GEMINI_CLI_HOME / GROK_HOME) verbatim.
- THE HOME-ENV ASYMMETRY (verified in geminisession.js / groksession.js):
  * grok: GROK_HOME is read VERBATIM as the storage root (sessions/ sit directly under it). So a
    per-account grok agent's pane sets GROK_HOME = <account-dir>, and the session reader resolves the
    same dir. Symmetric, one dir.
  * gemini: the real GEMINI_CLI_HOME is the ROOT under which the CLI creates a `.gemini` subdir. So a
    per-account gemini agent's pane sets GEMINI_CLI_HOME = <account-dir> and the CLI writes its data
    (settings.json, projects.json, sessions) into <account-dir>/.gemini.

## ⭐ DESIGN CHANGED IN FLIGHT (2026-09-23): where the .gemini append lives -- I picked the OTHER of two
   self-consistent designs than this plan first sketched, and it is the load-bearing call of the slice.
- The plan first proposed: account-dir = the `.gemini` STORAGE dir, and GEMINI_CLI_HOME = PARENT(dir)
  (a transform at the plist). REJECTED after I traced the round-trip: readPlistJob reads the plist's
  env value back as job.configDir, so storing PARENT there makes the reader (which treats configDir as
  the storage dir) read one level too high -- it would need an INVERSE append in readPlistJob AND the
  account module's key/list/forget logic would all straddle two paths. Three-way asymmetric.
- SHIPPED (Design R): `configDir` == `row.dir` == the ACCOUNT DIR (~/.gemini-<label>), == GEMINI_CLI_HOME
  VERBATIM -- symmetric with grok everywhere (the account module, the plist, readPlistJob). The CLI's
  one quirk (it writes into a `.gemini` subdir below GEMINI_CLI_HOME) is confined to ONE helper,
  `create.geminiStorageHome(configDir)` = `configDir ? <configDir>/.gemini : ~/.gemini`, which feeds
  the TWO storage consumers that already carried `|| defaultAgentGeminiHome()`: the birth settings
  write (create.js) and readGeminiSession (status.js). Nothing else changes. The key file lives in the
  account dir (== GEMINI_CLI_HOME), so the supervisor reads `$GEMINI_CLI_HOME/.kosmos-gemini-apikey`
  symmetrically with grok's `$GROK_HOME/.kosmos-grok-apikey`.
- Why this is the better call: the asymmetry lives in ONE place that already owned the .gemini knowledge,
  instead of being smeared across the module + plistFor + readPlistJob. geminiaccounts.js is then a near
  clone of grokaccounts.js (less divergence, the plan's own "mirror exactly" spirit).
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
   'GROK_HOME'. The VALUE written is the account-dir VERBATIM for BOTH (Design R above): no parent
   transform at the plist. accountenv stays a neutral name-only leaf. readPlistJob's cfg regex was
   extended to read GEMINI_CLI_HOME/GROK_HOME back, so the account round-trips.
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
but it is the one part not lifted verbatim from a sibling. It got the most test scrutiny -- and it is
EXECUTED, not just asserted: supervisor.provider-key-inject-3296.test.js runs the SHIPPED script with a
recorder fake tmux and proves a per-account agent gets ITS account's key, a missing key file degrades
to the door (no injection, never a failed launch), a default-account agent injects nothing, and the key
reaches the pane's -e env (never logged/echoed).

## What would change my mind (Design R)
- If a THIRD gemini configDir consumer exists that treats it as the storage dir and I missed it, it
  would read the account root instead of <root>/.gemini and find no sessions. I grepped: the only two
  storage consumers are the birth write (create.js) and readGeminiSession (status.js), both now routed
  through geminiStorageHome. discover.js reads ~/.gemini via geminisession.HOME (its own env branch),
  not job.configDir, so it is unaffected. A new consumer must call geminiStorageHome, not join .gemini
  by hand.
- If the real gemini CLI is ever changed to read GEMINI_CLI_HOME verbatim (no .gemini append), the
  append moves out of geminiStorageHome and gemini becomes byte-identical to grok. That is a one-helper
  change, which is the whole point of confining it there.

## Test plan
Unit: geminiaccounts/grokaccounts list/identityOf/checkLive/storeKey/forgetKey/removeAccount/nextWorkDir
(mirror openaiaccounts.test.js + claudeaccounts.test.js). accountenv gemini/grok arms + the gemini
parent transform. create.js setGeminiAccount/setGrokAccount + createAgentInner per-account arms (the
plist carries the right per-account home; the supplied key file is read; default account unchanged).
supervisor per-account key injection (the shipped-from-disk script reads the account key file for a
per-account agent and falls back to the door otherwise). Server route tests mirror the openai ones.
Full whole-tree suite + full challenge-loop before PR.

## Challenge-loop deferrals (documented, not fixed)
- **checkLive(cached:true) does a live call (iter 3).** Deferred: this MATCHES the openai apikey
  sibling, not a divergence. openaiaccounts.checkLive's apikey branch (openaiaccounts.js:1287) also
  performs a live askModels on the cached:true paint path; the `cached` hint only short-circuits the
  CHATGPT liveness cache (codexsigninlive), which an api-key provider has no analog of. So every
  apikey provider's /api/accounts row already pays a paint-time live call -- a pre-existing
  cross-provider property, not something this slice introduced or worsened. A shared paint-time
  liveness cache for ALL apikey providers would be its own change (touching openai), out of this
  slice; adding a gemini/grok-only cache would be the inconsistency. Bounded here because only
  CREDENTIALED NAMED accounts are listed (the default is not), so the call count is the number of
  named accounts, same as openai.
- **8000ms fetch-abort is an inline literal (iter 3 NIT).** Deferred: it mirrors openaiaccounts /
  claudeaccounts, which also inline 8000. A named constant in gemini/grok only would DIVERGE from the
  established sibling pattern; if it is worth a constant it should be one shared across all four
  account modules, which is a separate cleanup.
- **nextWorkDir is exported/tested but has no caller yet (iter 4 NIT).** Deferred: it mirrors
  openaiaccounts.nextWorkDir exactly -- the unlabelled work-slot allocator the connect-UI follow-on
  will call (openai's own connect flow uses it; the store route here uses dirForLabel for named
  accounts). It is unit-tested, so it is not an unarmed guard; removing it would diverge the
  gemini/grok modules from the sibling account-module contract this slice was told to mirror.

## Iteration 5 (opus) findings
- **FIXED (defence in depth): forget/removeAccount now REFUSE the default home.** Without it, a
  manually-placed key file in ~/.gemini / ~/.grok would let a remove:true rmSync the user's entire
  real CLI home. This subsystem never credentials or lists the default (it is the machine-global key
  door), so it never creates one and now never destroys one. A deliberate DIVERGENCE from
  openaiaccounts, whose default IS deletable by design (#2684, a codex-only home Kosmos manages).
  Guarded by a unit test in both modules (a key placed in the default, both ops refused, home intact).
- **Deferred NIT: a failed store leaves an empty keyless dir.** Harmless -- an empty dir with no key
  is unlisted and treated as a free slot by list()/nextWorkDir; the code's "no orphaned key file"
  claim is precise. A blind rmdir on rollback risks a dir a concurrent op populated.
- **Deferred NIT: store guard->storeKey is not atomic (TOCTOU on the same new label).** Negligible on
  a single-user local board and consistent with the openai/claude siblings.
- **Deferred NIT: create.provider-accounts test's "known account" assertion is weak.** The STRONG
  path (positive GEMINI_CLI_HOME/GROK_HOME plist assertion + birth-write landing in the right storage
  dir) is covered by engine/create.test.js:3966+, so the weak assertion is a complement, not the only guard.
