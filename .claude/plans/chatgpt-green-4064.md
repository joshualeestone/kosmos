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
- engine/codexsigninlive.js: where the check's cache is written (livenessDetailed and livenessNow), a live answer is also
  recorded `observed.sawDir(OPENAI, dir, OK, at)` (dated when it was learned, as Grok's is) and a dead one
  `forgetDir`s it. At the cache write, so every caller counts (the list, Check now, codexauthprobe), not only a later
  read of the list (review 1: a dead Check now nobody read the list after left the old green standing).
- server.js, the OpenAI overlay in /api/accounts, ChatGPT rows only (`authMode === 'chatgpt'`): the recorded
  observation is read newest-wins with the agent's own and feeds the unchanged `observed.verdict`. A row that is itself
  Not connected (a dead answer, or a subscription the offline id_token check found lapsed) never reads it and forgets
  it (review 1: a recorded green would otherwise paint a lapsed subscription green). #3997's `deadIsNewer` is kept.
- API-key rows are untouched: their `connected` is already a real /v1/models proof, and the read is gated on ChatGPT.

## Measured
- server.chatgpt-green-4064.test.js, 5 tests, all pass on the branch. On main's server.js and codexsigninlive.js the
  reopen test fails (`state: unknown, liveCheckPending: true`, no badge). Each control fails with its line removed:
  the forget on a dead answer (the green comes back once the dead answer leaves its own cache), the record in
  livenessNow (a dead Check now leaves the green), the Not-connected guard (a lapsed subscription paints green), and
  the ChatGPT gate (a recorded answer on an API-key folder paints that row).
- docs/browser-checks/render-chatgpt-green-4064.js: see the PR for the branch and main runs.

## Rejected
- Lengthening the check's 30s cache: it would also hold a dead answer, or a repair, for longer; the card asks for the
  Grok shape, which keeps the check fresh and only carries the green.
- Recording in the /api/accounts overlay, as first built (and as the Grok list path does): an answer learned by Check
  now or codexauthprobe was only recorded if somebody read the list inside its 30s cache (review 1).

## Weakest part
The green's tooltip is the observed-outcome sentence ("a real request on this account succeeded recently ... not a
probe"), which describes an agent's request, not the free check. Grok's check-derived green already says the same, so
this is left alone here and flagged; a wording change would cover both providers.
Also: inside the observed window a DEAD sign-in shows green on reopen for one check's length (the recorded green, then
red when the check answers). That is the same trade the Grok check makes and the reverse of the amber flash this fixes;
the browser check's dead arm expects `green > red` and fails only on green after red.

## Decided, not missed: Check now finishing after a newer check (review 2)
`livenessNow` (Check now) writes its answer unconditionally, by design (#3997 round 3: it must beat a check started
against an older sign-in). So if a list check that started AFTER it finishes first and answers dead, and Check now then
answers live, the live wins. That race predates this branch; with this change the live is also recorded. It is not a
5 minute stuck green: after the check's 30s cache every reopen runs a fresh check, and a dead answer forgets the green
within one check, the same bound as the dead-reopen trade above. It needs two checks seconds apart to disagree, a real
change of sign-in state mid-check. Fixing it means dating each cache entry by when its run STARTED and changing Check
now's precedence, a #3997 behaviour change wider than this card, so it is left and named here.

## Decided, not missed: a new sign-in in the same folder
Nothing on main invalidates on a sign-in: the check's cache is keyed by folder alone (`homeKey(dir)`), and an agent's
recorded success is too, for 5 minutes. With this change a check's green is carried the same way, so a DIFFERENT account
signed into the same folder inside 5 minutes shows green until its own check answers (the reopen starts it; about 3.5s)
and, if that answer is dead, red from then on (forgetDir). Main already does this for 30s through the cache and for 5
minutes through an agent's success; closing it for all three means keying observations by identity, a wider change
than this card, so it is left and named here.

## What would change my mind
A path where a recorded green survives a dead answer for longer than one read, or where it paints an API-key row.
