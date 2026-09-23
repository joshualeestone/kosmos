# setProvider: switch an existing agent onto Gemini / Grok (#3296 / #3391)

## The gap

`createAgentInner` already births agents on all four providers (anthropic / openai /
google / xai). `setProvider` -- the post-birth "change what this agent runs on" path --
still owns only claude <-> codex: its guard refuses anything but `anthropic` / `openai`,
and its runner map is `provider === 'openai' ? 'codex' : 'claude'`. So an existing agent
can be created on Gemini or Grok but never SWITCHED onto (or off) them. This closes that.

The sibling setters already crossed this line: `setAccount` dispatches to
`setGeminiAccount` / `setGrokAccount` (engine/create.js), and `setModel`'s
`agentProvider` derivation already handles gemini/grok. `setProvider` is the one
post-birth setter left behind.

## Design (mirror the create path and the existing account setters, not invent)

### engine/create.js `setProvider`
1. Provider guard widened to also accept `google` / `xai` (mirror createAgentInner's
   four-way guard).
2. Runner + runnerBin maps widened to the same four-way form createAgentInner uses:
   `openai->codex, google->gemini, xai->grok, else claude`; runnerBin picks
   geminiBin/grokBin from `binPaths` (which already returns them).
3. The "already runs on X" refusal and the "we could not find the X runner" refusal
   gain Gemini/Grok labels. The existing OpenAI/Claude wording is preserved verbatim so
   `create.runner-dir-1616.test.js` (asserts `/could not find the OpenAI runner/`) stays
   green.
4. Account resolution, provider-aware:
   - codex: the existing elaborate block is UNTOUCHED (only runs for `runner === 'codex'`),
     so `create.setprovider-writes-2811.test.js` (a codex-only exact-writes snapshot)
     stays green.
   - gemini/grok: a NEW block mirroring `setGeminiAccount`/`setGrokAccount` +
     createAgentInner's google/xai arms. Default (no `opts.accountDir`) = the machine-global
     API-key door, constructed directly (it is legitimately absent from `list()` because
     `rowFor` gates on a stored key), configDir null. Named account = resolved in
     `list()`, REFUSED if unknown (fail closed, the silent-wrong-account guard), configDir
     `= acct.isDefault ? null : acct.dir`. No "nobody signed in" refusal and no
     picker/pickedByPerson machinery: gemini/grok's default is an env-key door an agent CAN
     start on, unlike codex where an unsigned default home leaves a dead agent (#1211/#1373).
     Gated on `!DRY_RUN`, exactly as the codex block is.
5. The single final `rewriteAgentJob` writes a provider-aware `configDir` (codex keeps its
   `#1600` expression; gemini/grok use `switchAccount && !isDefault ? dir : null`; claude
   null). The brief rename already works for all four runners via `briefFilename`
   (codex/grok->AGENTS.md, gemini->GEMINI.md, claude->CLAUDE.md).
6. Result gains a generic `account` field (the resolved Gemini/Grok row, null for
   claude/codex); `openaiAccount` is unchanged.

### server.js POST /api/agent/:name/provider
The route was anthropic/openai-shaped (labelled google/xai as "Claude", read only
`wrote.openaiAccount`). Generalized:
- `label`: openai->OpenAI, google->Gemini, xai->Grok, else Claude.
- `dropped`: switching TO anthropic keeps the existing "starts on your main Claude account"
  sentence; switching to any non-anthropic provider says the previous model choice does not
  cross (the target provider picks its own) and it leaves its previous account behind. The
  OpenAI wording is behavior-equivalent (openai still reads correctly).
- `acct = wrote.openaiAccount || wrote.account`; the account-noun phrase in `runsOn` is
  provider-aware ("OpenAI sign-in" / "Gemini account" / "Grok account"). `whichAcct`
  already renders "(API key ending XXXX)" from `keyTail`, which gemini/grok rows carry.
- `signInNote` (OpenAI-sign-in-specific copy) is now gated on `provider === 'openai'` so it
  never fires for a gemini/grok default account whose `authMode` is undefined.

openai behavior is preserved, so `server.switch-account-1373.test.js` live assertions stay
green.

## What I rejected
- Reimplementing codex's picker/pickedByPerson/"nobody signed in" saga for gemini/grok:
  rejected. That machinery exists for codex's dead-agent-on-unsigned-default failure, which
  gemini/grok do not have (env-key door). Mirroring the simpler create/setAccount path is
  correct and lower-risk.
- Splitting engine from route into two PRs: rejected. A route that labels a gemini switch
  "Claude it is" is a visibly wrong half-slice; the coherent unit is both files.
- Supporting named-account switch under DRY_RUN validation: rejected, to mirror codex
  (which skips the whole account block under DRY_RUN). A DRY_RUN preview will not catch an
  unknown named account; documented, parallel to codex.

## Weakest premise
That the server `/provider` route is the only consumer of `setProvider`'s result that needs
provider-aware rendering. The web page (connect/switch UI) is ICK/Mona lane and may read
the same result shape; I add a generic `account` field and keep `openaiAccount`, so the
page keeps whatever it read before. If the page needs `account` surfaced, that is a
follow-up in their lane, not a regression this introduces.

## Tests
New `engine/create.setprovider-google-xai-3296.test.js`: claude->gemini, claude->grok,
gemini->claude, gemini->grok switches; brief rename CLAUDE.md->GEMINI.md and ->AGENTS.md;
named-account resolution and unknown-named-account REFUSED; runner-not-found REFUSED;
already-runs-on REFUSED; configDir written for a named non-default account and omitted for
the default. Existing codex snapshot + 1373 route tests must stay green (codex path
untouched).
