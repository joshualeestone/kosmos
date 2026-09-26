# #1307: webhooks in project settings (Josh, 2026-08-28)

## Finished looks like
- Project settings has a Webhooks section directly below Project members (Josh's words): + New
  webhook makes one with a prefilled name (Webhook 1, 2...), editable; its full link is shown with
  a Copy button; each row can be deleted (asks first). Each action saves on its own, like members.
- The link, POST http://127.0.0.1:<port>/hooks/<id>/<secret> with JSON { "title", "detail" }, adds
  a task to the project, marked as added by that webhook (by name), given to nobody.
- engine/webhooks.js keeps each webhook in the board's own data (minted and held by the Mac, never
  the coordinator), the secret only as a sha256 hash, keyed by a random id (the name is a label;
  renaming never changes the link). Timing-safe verify; unknown id and wrong secret answer the
  same 404. At most 20 per project; 30 calls a minute each.
- server.js: the board-token gate exempts ONLY the exact /hooks/<16 hex>/<43 base64url> POST;
  network peers are still refused by remoteWriteGuard (it is not in REMOTE_AGENT_ROUTES). JSON only,
  since a plain-text POST is refused by the board's cross-site guard. The settings routes are
  ordinary board-token /api routes and never return a hash.
- Tests: server.webhooks-1307.test.js (enforcing board, 9 arms); render-webhooks-1307.js (browser).

## Calls (on #1307)
- A call adds a task (rejected: messaging an agent, starting a run: an outside caller should not
  set work going silently).
- The link is shown once (a hash cannot be shown again); a lost link means a new webhook.
- For now programs on this computer only; the internet path needs the Kosmos+ tunnel to admit the
  hook path with the Mac's own check (Baron's lane, crates/tunnel), filed as its own card.
- Weakest premise: that a task is what Josh meant; if he wanted a room message, only the one line
  that acts on a call changes.
