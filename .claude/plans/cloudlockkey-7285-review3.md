# cloudlockkey-7285 review 3 (blind, CTO lens)

## What I checked

- The diff `cloudlock-7285...cloudlockkey-7285` for engine/remote.js, server.js, server.cloudowndevice-7285.test.js, engine/remote.joincode-4794.test.js.
- The guard in server.js against the stated rule: refuse when id equals x-kosmos-session-device, or when any allowed row with that id lists a key equal to x-kosmos-session-key; device id alone without keys or key header; 409 own_device_cloud_unknown on an unreadable list with a key header (both `ok:false` and a thrown read); busy words for a Forget or sign-in in flight; pending rows not checked.
- Every caller of deviceRemove and deviceDeny (server.js:12333-12334; engine internals at remote.js:2419, 2450, 2535, 2787, 2970). The only remote-reachable ones are the guarded route; the waiting routes are refused for remote requests.
- deviceRemove and deviceDeny run checkId with the same REQUEST_ID that devicesList filters rows by, so no removable id can be missing from the guard's list view.
- Every consumer of devicesList (server.js GET /api/remote/devices and the guard only), so `keys` reaches no other route; the GET strip removes it.
- Exporting `busy`: no other module reads `remote.busy`, and nothing enumerates the module's exports; engine-internal calls use the local function, so the test stub cannot affect the engine.
- Test isolation: all server-test stubs restored in test.after; the thrown-read stub restored in a finally; the busy stub restored in a finally; the engine test's FAKE_LIST is deleted by beforeEach.
- Ran with node --test: server.cloudowndevice-7285.test.js (7/7), engine/remote.joincode-4794.test.js (21/21), engine/remote.test.js (242/242), web.allow-card.test.js (13/13), all exit 0.
- Mutation reasoning on the new tests: removing the GET strip, the busy check, the keys comparison, the unreadable-list refusal, or the engine's keys normalisation each turns at least one new assertion red.

## Findings

- [NIT] server.js:12302 (`own` helper) and server.js:12320. The key header is split on commas and each piece compared, but the list's keys are never shape-checked (engine/remote.js:2698 keeps any non-empty string). The rule says the header is printable ASCII with no spaces, which allows a comma. A key containing a comma would be split into pieces, none equal to the row's key, and a sibling removal would go through: a lockout that fails open. Real keys are `k1.` plus base64url (REQUEST_ID, remote.js:2143), so this is not reachable today. Fix: compare the whole raw header value as well as its pieces (more candidates only ever refuse), or keep only keys matching the k1 shape in devicesList and say so.
- [NIT] server.js:12314 comment "Every row with that id (review 1): ... a second row must never fail open" has no test. `.some` does handle it, but nothing would catch a regression to `.find`. Fix: add a LIST with two rows for one id where only the second holds `k1.mine`, and assert 409.
- [NIT] server.cloudowndevice-7285.test.js:107 test title says "the list is read only with a key header", but only the negative arm is asserted (listReads 0 without a key header). There is no assertion that a request already refused by its headers skips the list read, nor that a non-cloud or local request skips it. Fix: reset listReads and assert 0 after a header-matched refusal and after a local request, so the title is what the test proves.
- [NIT] server.js:12305-12320. The list is read, then the engine removes after another await, with no lock between. If a sign-in adds the requested id to this session's key in that window, the removal goes through. The window is a tunnel spawn long and needs a concurrent sign-in by the same browser, so it is acceptable, but the comment block presents the check as complete. Fix: one sentence in the comment naming the window, or nothing if the tunnel owner considers it unreachable.

No logic error found within the stated rule: every lockout case listed (own device id, own key on a sibling row, own key not first among several, key-only refusal with a device header naming another row, unreadable list) is refused, and the controls (another key, a row with no keys, keys absent, an unlisted id, no key header) go through.

Totals: 0 BLOCKER, 0 WARNING, 4 NIT
