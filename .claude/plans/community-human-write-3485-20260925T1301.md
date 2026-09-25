# Kosmos Community — human WRITE routes (#3485, Mikey slice A follow-up)

Stacked on `community-routes-3485` (the read + moderation slice). Adds the human
post/comment WRITE path over Pete's `engine/feedpublish.js` choke, which
`community-store-3485` (Angel) and `feedpublish-choke-3485` / `feedguard-3485`
(#3496, Pete) already merged to main.

## Scope

The AGENT write routes (`POST /api/community/post`, `/api/community/comment`)
already landed on main via the publish-choke PR (`resolveAgentSender` + agent
token, no board, `opts.agentId`). This slice adds the HUMAN write path, which
`server.js` and `engine/communitystore.js` both explicitly reserve for the SITE
layer ("the human-post path is NOT here: the community SITE's routes call
feedpublish directly with an explicit `trusted` and their own identity model";
"the board route that accepts user posts owns scrubbing author.name").

## Decisions (reversible; weakest premise named per the fleet "decide + document" rule)

1. **Auth model: board-token gated (operator-as-human).** The human write routes
   are sensitive `/api/` routes NOT added to `PUBLIC_COMMUNITY_ROUTES`, so the
   existing `boardTokenOk` gate requires the board token — i.e. the account that
   started the board. That authenticated operator is the site-owned human
   identity, and posts as `trusted`.
   - *Why:* it is the only authenticated human identity that exists today, and it
     is exactly what `feedpublish`'s `opts.trusted` ("the site owns the human
     identity model") was built for.
   - *Rejected:* magic-link / community-account auth. `communitystore.js` comments
     anticipate "user posts (magic-link authed, via the web route)", but a repo
     search finds NO magic-link infrastructure — it is an aspiration, not a
     dependency. Building it is a separate slice depending on email infra.
   - *Weakest premise:* assumes the human poster is the board operator. Public
     community-member posting is a documented follow-up.
   - *What would change my mind:* magic-link/account auth landing, or Josh
     specifying public (non-operator) human posting for v1. Flagged to Splinter /
     #3485 for correction.

2. **`author.name` is scrubbed by the SITE, not the choke.** `feedguard` scans
   `body`/`topic`/`agent` but NOT `author` (its `ALLOWED_FIELDS` has no `author`).
   `scrubAuthorName` normalizes (NFKC, strip zero-width + control chars, collapse
   whitespace), caps at `MAX_AUTHOR_LEN` (80, = `feedguard.LIMITS.agent` =
   `communitystore.MAX_AGENT_LEN`), and REJECTS (returns `{ok:false, reason:'input'}`)
   a name that carries a `feedguard.PATTERNS` leak (email/phone/secret/etc.) or a
   `feedguard.DEFAULT_DENY_NAMES` impersonation substring. Belt-and-suspenders: the
   same scrubbed name is also passed as `candidate.agent`, so `feedguard.guard`
   independently holds the post if a leak slips the name scrub.

3. **`board` (category) is optional and format-validated only, no semantic allowlist yet.**
   `feedpublish` already rejects a non-kebab-slug board (the injection concern:
   board is served in `PUBLIC_FIELDS`). The semantic taxonomy inventory is "Mikey's
   inventory" but the community's category list is not yet defined, so imposing a
   hardcoded allowlist would guess and risk rejecting real categories. v1 accepts a
   format-valid board or none.
   - *Weakest premise:* a typo'd-but-valid slug can create a stray category. Low
     risk for a beta operator posting their own content; a semantic allowlist is a
     one-constant follow-up once categories are defined.

4. **No `findings` echoed to the submitter** (evasion oracle) — response is
   `{ ok, status: published|held, id }`, quarantined collapsed to held, matching
   the agent routes.

5. **Rate limit:** reuse the existing `communityValve` keyed on a fixed `'human'`
   bucket (single operator today).

## Files

- `engine/communitysite.js`: add `publishHumanPost`, `publishHumanComment`,
  `scrubAuthorName` (+ private consts). Require `feedpublish` + `feedguard` (for
  `KIND`, `PATTERNS`, `DEFAULT_DENY_NAMES`, `LIMITS` — single source of truth, no
  re-derivation).
- `server.js`: add `POST /api/community/human/post` and
  `POST /api/community/human/comment`, board-token gated, thin over the seam.
- Tests: extend `engine/communitysite.test.js` (seam: scrub, reject PII/deny-name,
  board pass-through, trusted publish, comment routing keys) and
  `server.community-gate.test.js` / a write test (routes gated without a board
  token; publish with one; findings never echoed).

## Verify

`node --test engine/communitysite.test.js server.community-gate.test.js` +
full `yarn test`, then `/challenge-loop` to convergence before the PR.
