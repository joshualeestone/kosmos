# Plan: fix #2128 - dependsOnClaude keys on agents, not a configured account

## Problem
An OpenAI-only user (OpenAI connected, Claude not) saw "Kosmos cannot reach a Claude
subscription" on every page. `/api/status` set `dependsOnClaude` true whenever a
`~/.claude` account was merely configured (`Array.isArray(known) && known.length > 0`,
added in #2096). Josh's dev box has a real Claude account he depends on for nothing, so
his OpenAI-only run reddened the banner globally. The client (renderConnection, #2096)
already suppresses on `dependsOnClaude === false`; the server just never sent false.

## Change
Extract the rule to a top-level, exported predicate in `server.js`:

    function someAgentNeedsClaude(agentList) {
      return Array.isArray(agentList)
        && agentList.some((a) => a && a.runner !== 'codex');
    }

and compute `const dependsOnClaude = someAgentNeedsClaude(agents.concat(offline))`.

Rule: true iff some agent is not positively a codex (OpenAI) runner. An unknown runner
(`''` / `'claude'` / `undefined`) still counts, so a real Claude failure is never hidden;
no agents (fresh install) or every agent codex -> false. `known` (accounts.list()) is
retained for the account rows; it no longer forces this dependency.

## Rejected
- Keeping the `known.length > 0` term but AND-ing a "no codex account" check: still fires
  on a dev box that has both a Claude account and OpenAI-only runners, which is Josh's case.
- Adding gemini/grok to the excluded set now: speculative; those runners are not creatable,
  and the card's intent is that unknown runners COUNT as Claude-dependent (safe fail).

## Weakest premise
That `agents.concat(offline)` always carries a correct `runner` field for every agent. The
review verified offline agents carry a real runner (`profile.provider === 'openai' ? 'codex'
: 'claude'`), and unknown/missing runners intentionally count as Claude-dependent, so the
predicate fails safe if a runner is ever absent.

## Tests
`server.depends-on-claude-2096.test.js`: four predicate cases (some non-codex -> true; every
codex -> false; no agents -> false) plus defensive null/undefined and unknown-runner, plus
the HTTP regression (configured account, no agents -> false, which fails against the old code).
Frontend guard unchanged: `web.openai-only-banner-2096.test.js` (5/5).

## Verify (live)
Requires a real OpenAI-only machine (fresh codex account, no Claude account). Batches into
the clean-machine verify pass; not done-at-merge.
