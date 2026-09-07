# #2347 item C: S2 folder Next-gate needs a prompt-free presence signal (native half)

## Problem (Josh 0.6.41 re-test, item C)
On the S2 folder-access screen, Next does NOT gray until access is allowed - Josh could
click Next without granting. Renet root-caused it into the native lane and routed it here.

## Why S2 can't gate on the file verdict (the asymmetry Renet found)
S3 gates fine because its anchor is the SLEEP gate (pmset = a pure read, always checkable).
S2's only gate is file-access, and the file-access probe IS the TCC prompt (native
fileaccessprompt enumerates Documents/Desktop/Downloads). So there is deliberately NO
entry-time file verdict (a periodic refresh re-introduces the #2125 permflood). On S2 entry
fileaccessstatus.read() returns {checkable:false} (ENOENT) -> the gate fail-safes to enabled
-> Next clickable. Exactly Josh's symptom.

## The fix (native half; Renet builds the front-end half)
Expose a PROMPT-FREE presence signal on the file gate's own route:
  GET /api/file-access-status -> { checkable, granted?, because?, nativePresent }
nativePresent = promptrequest.nativePresent() = a11ystatus.read().checkable === true - the
a11y-status freshness the app already maintains via the axcheck loop (launch + 60s), which
fires NO prompt and needs no folder access. Defaults false on any error (fail-safe direction).

Front-end (Renet, confirmed contract): block S2 Next when `nativePresent === true &&
granted !== true`. Covers all cases: granted -> enable; present+not-granted -> BLOCK (entry,
no verdict yet, subsumes today's checkable:true+granted:false case); no native app -> fail-safe
enable (browser tester never stranded). The Allow click still fires the prompts (no entry
ambush; #2125 preserved), and the post-click fileaccessprompt writes granted:true -> enable.

## Why nativePresent is the right signal (and the alternative is wrong)
The only other option (have the native app write a granted:false at entry) requires a
file-access probe = the TCC prompt = the ambush we must avoid. nativePresent reads a
prompt-free status the app writes anyway, so a probe-free entry gate is possible. This works
because #2371 (merged) fixed the bundled-tmux path so the axcheck hatch actually runs and
a11y-status is fresh on a real install -> nativePresent()===true.

## Tests
server.fileaccess-present-2347.test.js (live route, real server): nativePresent TRUE when a
fresh a11y-status is present, FALSE with no native writer (browser fail-safe), FALSE when
a11y-status is stale (>5min; a quit app must not block). Proves the { ..., nativePresent }
shape Renet wires against.

## Verification tiers
- TIER-1 (done): live-route test proving the response shape; the presence logic itself
  (a11ystatus.checkable) is covered by a11y-status.test.js.
- TIER-2 (Josh's fresh-account re-test, front-end): S2 Next grays on entry (native present,
  not granted) and enables after Allow. Rides the re-test with Renet's front-end half.

## Caveat (flagged to Renet)
Sub-second entry window: if the app just launched and axcheck has not written a11y-status yet,
nativePresent is momentarily false -> Next briefly enabled -> frPollGates re-evaluates within
~1s once a11y-status lands and grays it. Acceptable (poll catches up).
