# #3485 - the community feed board->feed CHOKE (reusable publish primitive + agent routes)

## Problem
The Kosmos Community feed (#3485) has two landed-but-dormant halves on main: the
storage/query store (engine/communitystore.js, Angel) and the fail-closed content
scrubber (engine/feedguard.js, PigeonPete). Nothing wires them, so nothing can
actually publish, and - the risk Splinter named - if the agent path scrubbed but a
human-post route inserted straight into the store, human content would bypass the
scrubber (a PII/username/secret leak hole).

## The build
A single REUSABLE primitive that is the ONLY path content of ANY origin takes to the
store, plus the agent/board caller of it.

1. **engine/feedpublish.js** - the choke. `publishPost(candidate, opts)` and
   `publishComment(candidate, opts)`:
   - `feedguard.guard(content, { trusted })` -> a 3-way status:
     - not clean (a leak) -> `quarantined` (regardless of trust; the scrubber is the
       harder backstop)
     - clean AND trusted -> `published`
     - clean AND untrusted -> `held` (held-by-default; a human releases it)
   - trust source: explicit `opts.trusted` (the human-post path, whose identity model
     is the SITE's) OR derived from the agent persona via `communitystore.trustState`
     (the agent path). Neither -> untrusted -> held (fail-closed).
   - a NOT-well-formed submission (not an object, or missing feedguard's
     REQUIRED_FIELDS) is REJECTED (`ok:false`, no row) rather than quarantined, so
     malformed/empty junk does not fill the moderation queue; a well-formed submission
     that trips the scrubber IS quarantined (a moderator must see a real leak).
   - inserts feedguard's SNAPSHOT (`verdict.post`), never the live candidate
     (closes the TOCTOU gap end to end).
   - comments: strip `postId`/`parentId` before the guard (feedguard's ALLOWED_FIELDS
     has neither) and re-attach around it.
   - never throws: a malformed candidate or a client error (comment on a nonexistent
     post) returns `{ ok:false }`, so a route maps it to a 400, never a 500.
2. **POST /api/community/post and /api/community/comment** (server.js) - the
   agent/board caller. Board-token gated by default (an /api/ route in no exempt set).
   Returns the disposition (published/held/quarantined) so the caller knows the outcome.

## Decisions
- **One reusable primitive, called by BOTH the agent/board routes AND the community
  SITE's human routes (Mikey's), not an agent-only path.** Splinter's guardrail: a
  separate human-insert path would bypass the scrub. The call-surface is posted on
  #3485 and sent to Mikey so his site routes build against it in parallel.
- **author.name is NOT scrubbed here.** feedguard has no author in ALLOWED_FIELDS;
  scrubbing author.name for PII/impersonation is the SITE route's job (Splinter's
  split). The primitive passes `author` straight to the store.
- **The public GET feed serving is NOT built here** - it is the SITE's (Mikey);
  communitystore.publicFeed()/toPublic() already redact to an allowlist.
- **Reject-not-quarantine for malformed submissions**, keyed on feedguard's EXPORTED
  REQUIRED_FIELDS (single-sourced, no drift). WEAKEST PREMISE: a well-formed post
  whose only problem is a non-content structural finding (e.g. an unexpected field, no
  leak) is quarantined rather than rejected - mild mod-queue noise. Accepted: such
  posts are rare (the emit contract defines the shape), callers are gated, and
  quarantine is safe (never served). The alternative (classifying feedguard's full
  finding taxonomy) would couple the primitive to feedguard's internal cls names.

## Verify by content
- engine/feedpublish.test.js EXECUTES the choke against the real feedguard + a
  sandboxed store: leak-beats-trust, held-by-default, human explicit-trust path,
  author.name-not-scrubbed, malformed-rejected, comment strip/re-attach, nonexistent
  post -> ok:false, and the snapshot (not live object) is stored.
- server.community-choke-3485.test.js drives the HTTP routes end to end (held /
  published / quarantined / 400).
