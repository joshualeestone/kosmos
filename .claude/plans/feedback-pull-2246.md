# feedback-pull-2246: `kosmos feedback pull` - the collect -> triage bridge

**Card:** kosmos#2296 (self-carded; routed by Splinter). The gap identified in #2295.
Post-launch priority (not launch-blocking: collected reports are listable
server-side, satisfying Josh's "collect so we can review"), built now so the full
author -> transmit -> collect -> triage loop is ready when Josh reviews feedback.

## The gap

The feedback loop was joined author -> transmit (feedbacksend.js) -> collect
(chaoskosmos-site /api/feedback #97, stores each report as JSON to @vercel/blob
under an unguessable name) but NOT collect -> triage: triage (#2246) reads `.md`
reports from a `--dir`, and nothing retrieved the blobs into that dir.

## The change

- **engine/feedbackpull.js** (new): `pull(dir, opts)` lists the feedback blobs
  (Vercel Blob REST, `feedback/` prefix, paged with a seen-cursor + MAX_PAGES
  guard and a bounded-timeout fetch), fetches each JSON record, and writes it as
  `<date>__<install>.md` in feedback.js's exact frontmatter+body shape so triage
  reads it unchanged. Read-only against the store; malformed blob skipped-with-note;
  write-then-rename; idempotent (per-(install,date) rewrite). Token read via
  `secrets-map.sh value <target>` (target `vercel-blob-feedback`, os.homedir, fail-
  closed to null) so the build is NOT blocked on provisioning - a clear "not filed"
  message until the token exists. Endpoint env-overridable (AGENT_WORKFORCE_BLOB_API).
  Injectable transport (setTransport) for tests.
- **engine/feedback.js**: `frontmatterDate(raw)` - so triage dates a pulled
  `<date>__<install>.md` file (not a bare `YYYY-MM-DD.md`) from its frontmatter,
  keeping `--since` working on the collected corpus.
- **install/kosmos**: `feedback pull [--dir PATH]` verb; triage `--dir` date now
  falls back to `frontmatterDate`.

## Decisions

- **Filename `<date>__<install>.md`, generated_at deliberately NOT in it.** The
  collect route keeps ONE record per (install, date) (deletes the prior same-day
  blob on re-send), so (install, date) is a 1:1 key and the name is collision-free
  and idempotent. Rejected keying on generated_at (would pile up files on re-pull).
  **Weakest premise:** the Vercel Blob REST *list* response shape - built + tested
  against the documented shape via the transport seam + a local-HTTP-stub test; a
  live run once the token is filed confirms/corrects it, localised to one function.
- **Token via secrets-map, not env/hard-path** (Splinter's steer): map is the
  single source of truth, token never in argv/repo/error, not blocked on provisioning.
- **Read-only + fail-closed + fire-and-forget-shaped**, mirroring feedbacksend.js/ping.js.

## Challenge-loop (3 iterations, converged)

- iter-1: fixed the source-sweep guards (#1732 os.homedir not process.env.HOME;
  #265 excused setTransport) + the blind-review WARNING (frozen store.ROOT const ->
  lazy defaultDir()); made the token-not-filed test deterministic.
- iter-2: added real-transport coverage (local-HTTP-stub test of defaultList/
  defaultGet: Bearer token, prefix, cursor paging, parse) + a paging cap/seen-cursor
  guard + fetch timeouts.
- iter-3: single-lined the frontmatter header values (a newline in generated_at
  cannot shift the boundary; red-capable test); the filename WARNING deferred as a
  verified benign transient (store dedups one-per-(install,date)).

Full node suite green (4700/0); engine/feedbackpull.test.js + feedback.test.js +
the triage shell test all pass.
