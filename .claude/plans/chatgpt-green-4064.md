# chatgpt-green-4064: a working ChatGPT sign-in stays green when AI Models is reopened

kosmos#4064, assigned by Liu Kang (m1306). After #3997 a ChatGPT sign-in's green came only from the live check's 30s
cache (engine/codexsigninlive.js), so every reopen of Settings > AI Models more than 30s after the last check painted
the row amber ("Signed in", checking) for the length of a fresh `codex doctor`, about 3.5s. Grok's free check records
its answer with `observed.sawDir(XAI, dir, OK, at)` and stays green for the observed window (5 minutes).

## Done looks like
Reopening AI Models 61s after a green shows no amber while the new check runs, measured by a gated browser check and a
server test that both fail on main; and a control: a dead answer after a recorded green reads Not connected and the
older green does not come back.

## Change
- engine/codexsigninlive.js: `cachedAnswer(dir)` returns the fresh cache entry's `{ verdict, at }` (null otherwise).
- server.js, the OpenAI overlay in /api/accounts, ChatGPT rows only (`authMode === 'chatgpt'`):
  a live answer is recorded `observed.sawDir(OPENAI, dir, OK, answer.at)` (dated when it was learned, as Grok's is);
  a dead answer `forgetDir`s it; the recorded observation is read (not on a read that answered dead) and the newest of
  it and the agent observation feeds the unchanged `observed.verdict`. #3997's `deadIsNewer` guard is kept as is.
- API-key rows are untouched: their `connected` is already a real /v1/models proof.

## Measured
- server.chatgpt-green-4064.test.js: 3/3 on the branch. On main's server.js and codexsigninlive.js the reopen test fails
  (`state: unknown, liveCheckPending: true`, no badge). With the `forgetDir` line deleted, the dead control fails at the
  read after the dead answer's own cache has expired (the old green comes back), so that line is guarded.
- docs/browser-checks/render-chatgpt-green-4064.js: see the PR for the branch and main runs.

## Rejected
- Lengthening the check's 30s cache: it would also hold a dead answer, or a repair, for longer; the card asks for the
  Grok shape, which keeps the check fresh and only carries the green.
- Recording from inside codexsigninlive: the observed store is the board's, and the Grok path records in server.js;
  keeping both in the overlay keeps the two providers readable side by side.

## Weakest part
The green's tooltip is the observed-outcome sentence ("a real request on this account succeeded recently ... not a
probe"), which describes an agent's request, not the free check. Grok's check-derived green already says the same, so
this is left alone here and flagged; a wording change would cover both providers.
Also: the green is recorded when /api/accounts is READ after the check finished (the overlay), not the moment the check
finishes. The page reads again while a check is pending (#3997 follow-ups), so in practice it is recorded; a check
nobody reads the list after leaves no record, which only matters to the next reopen within 30s, which the cache covers.

## Decided, not missed: a new sign-in in the same folder
Nothing on main invalidates on a sign-in: the check's cache is keyed by folder alone (`homeKey(dir)`), and an agent's
recorded success is too, for 5 minutes. With this change a check's green is carried the same way, so a DIFFERENT account
signed into the same folder inside 5 minutes shows green until its own check answers (the reopen starts it; about 3.5s)
and, if that answer is dead, red from then on (forgetDir). Main already does this for 30s through the cache and for 5
minutes through an agent's success; closing it for all three means keying observations by identity, a wider change
than this card, so it is left and named here.

## What would change my mind
A path where a recorded green survives a dead answer for longer than one read, or where it paints an API-key row.
