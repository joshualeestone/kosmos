# svcmedia-7750: Images, video and voice token doors (kosmos#7750)

Finished means: the Connections tab's new "Images, video and voice" group (Mona Lisa's design, branch
design-7750, two commits) has working Replicate and ElevenLabs doors: each pill opens a real token door
backed by a spec in engine/tokendoors.js, the door checks the pasted token with the service's free
"who am I" read, keeps it mode 600 under its variable name, and says the service's reason on a refusal.

## Steps
1. [x] Branch from origin/design-7750 (061b5d8148), keeping her two commits as they are.
2. [x] engine/tokendoors.js: Replicate (REPLICATE_API_TOKEN, GET api.replicate.com/v1/account, Bearer,
   who = username) and ElevenLabs (ELEVENLABS_API_KEY, GET api.elevenlabs.io/v1/user, xi-api-key,
   who = first_name; refusal passes detail.message through). Both proven: false (no live key checked).
   Hints, whereText, where from her card comment 6892089027. Calls re-checked against both API
   references 2026-11-15; the ElevenLabs keys page address is the one its docs name.
3. [x] Tests: engine/tokendoors.test.js new #7750 test (request shape, who, a 200 without a username is
   refused, the permission reason passed through, a bare 401 unchanged); negative control run (breaking
   the passthrough fails it). web.svc-doors.test.js pins both pill sentences.
4. [x] Wider tests: every test that reads the doors (20 files, 244 tests) plus web.conn-shelf; full suite found two reds, both fixed in iteration 1 (the #6022 route guard in mobile-shots.js, and the #2518 surface gate, answered with per-check trailers: none of the four Connections checks asserts the new group or the "coming" text). The Connections checks are run for real before merge.
5. [x] ElevenLabs hint changed to Mona Lisa's wording (fleetbuilders m4355, shortened in m4361 with the optional credit limit dropped): it names account reading, so a key made by following it passes the check.

## Decisions
- ElevenLabs keys can be scoped to endpoint groups, and its docs do not say whether GET /v1/user needs a
  permission of its own. Rather than change her hint, the door passes the service's own reason through,
  so a key refused for a missing permission says which one. Weakest premise: the error body shape
  (detail.message) is from memory of the API, not from a live refusal; with any other shape the door
  falls back to "did not accept that token", which is today's behaviour for every door.
