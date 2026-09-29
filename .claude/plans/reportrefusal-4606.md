# #4606: report, report show and reply say a token is missing

Card: joshualeestone/kosmos#4606 (follow-up to #4602, #4580 item 13). STACKED on tokenless-4602 (PR #4633), per Splinter; rebase onto main once #4633 merges.

## Change
server.js `resolveAgentSender`, the `denyPaneFallback` arm (only reached with no agent token in a header or the body): when no board token was presented either, the refusal reads "no board token or agent token came with this request, and <the route's own sentence>". A board token that was sent and did not match keeps the route's sentence exactly. Refusal unchanged; words only.
Covers POST /api/report, GET /api/report and POST /api/reply (their `denyBecause`) and the default. The fifth caller (project attribution after a post) answers nobody, so its words are never seen.

## Tests
server.report-refusal-4606.test.js (7): each route tokenless (new sentence, own sentence follows, still refused), each route with a wrong board token (today's words exactly), the right board token still records. Mutation (sentence removed): 3 fail. Neighbours: #1968 loopback, #4602, and every test naming "account that started it" pass.
