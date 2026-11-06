# minimax-7206: #7206 slice 3, MiniMax as a third vendor row, dark

Splinter's 10-26 call on #7206: DeepSeek, GLM and MiniMax, each a Connect row with a key, a live check and tests.
DeepSeek (slice 1) and GLM (2a engine #8089, 2b page #8094) are built. This is MiniMax, engine and page in one slice:
the page is now driven by one per-vendor table (COMPAT_PAGE, COMPAT_ON_FOR), so a new vendor is a row plus the
places that name vendors.

## What
1. `engine/anthropiccompat.js` VENDORS gains `minimax`, from MiniMax's own Claude Code guide
   (platform.minimax.io/docs/token-plan/claude-code, read 2026-11-05): base `https://api.minimax.io/anthropic`, the key
   as `ANTHROPIC_AUTH_TOKEN`, model `MiniMax-M3.1-Flash`, keys at `platform.minimax.io/console/plan`.
2. The key check: `https://api.minimax.io/v1/models` with a Bearer key. Measured with a made-up key: 401 (also 401 at
   `/anthropic/v1/models` with x-api-key).
3. Its own switch, `compat-minimax-on` (markerFor's rule). No board has it.
4. `bin/agent-supervisor.sh` launches `.kosmos-minimax-*` homes through the same case.
5. Names: orgpolicy, orgrollup, status MODEL_WORDS, the agent guide's coming-soon list, accountmove's chat word.
6. The page: a coming-soon row in the three provider menus (MiniMax had none), PROVIDER_ORDER, COMPAT_PAGE's row,
   COMPAT_ON_FOR, the setup row, and every site that names DeepSeek and GLM. providerOf reads one list of vendors
   (a guard caps its length at 700 characters).

## Tests
- engine: on exactly by its own switch, never by DeepSeek's or GLM's, never off a Mac.
- supervisor: a MiniMax home launches against MiniMax only under its own switch; red with its case removed.
- compatAsk per vendor (server.compat-hidden-7206), and a MiniMax arm in render-glm-add-7206.

## Switch-on checklist for MiniMax (before compat-minimax-on is created)
1. A real key answers 200 at `api.minimax.io/v1/models`.
2. Its list names `MiniMax-M3.1-Flash` exactly. MiniMax's pages disagree (M3, M3.1-Flash, M2.7); match the table to it.
3. A real claude run against `api.minimax.io/anthropic` with that key, in an empty config folder.
4. Whether a plan key and a pay-as-you-go key both answer the model list.
