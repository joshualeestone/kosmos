'use strict';
/* kosmos#7568: is the coordinator key the live service answers with on the service key set this cut ships?
   (tools/lib/service-keys-live.sh calls it at release.sh step 1d3.)

     node tools/check-service-keys-live.js <service-keys.json>    with the coordinator's /v1/meta on stdin

   A Kosmos Cloud box pins the keys the release ships (#7561), and a Mac's connector is handed the same list
   (engine/servicekeys-check.js expectedCoordinatorKeys). A set without the live key makes every new box and every
   sign-in refuse the real service. The comparison is the board's own (engine/servicekeys.js pinnedIsListed: the
   key in the pin's spelling turned into SPKI, then matched against each listed key's text), so the cut and the
   board cannot disagree about what "listed" means.

   The set's keys are read from its JSON, not from a verified set: whether the set verifies is the staging check's
   question (tools/check-service-keys.js, step 4), and this one must answer even while no recovery key is pinned.
   Prints the answer; exits 0 when the live key is listed, 1 otherwise (not listed, or anything it cannot read). */
const fs = require('fs');
const path = require('path');
const { pinnedIsListed, pinnedSpki } = require(path.join(__dirname, '..', 'engine', 'servicekeys.js'));

const no = (why) => { console.error('service key set vs the live coordinator: ' + why); process.exit(1); };

const setFile = process.argv[2];
if (!setFile) no('usage: check-service-keys-live.js <service-keys.json> (meta on stdin)');
let meta;
try { meta = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { no('/v1/meta answered, but not with JSON (a proxy or error page?), so the live key is UNKNOWN'); }
const live = meta && typeof meta === 'object' ? meta.coordinator_pubkey : undefined;
if (typeof live !== 'string' || !live) no('/v1/meta names no coordinator_pubkey, so the live key is UNKNOWN');
let set;
try { set = JSON.parse(fs.readFileSync(setFile, 'utf8')); } catch (e) { no('cannot read ' + setFile + ' as JSON (' + e.message + ')'); }
const keys = set && Array.isArray(set.service_keys) ? set.service_keys : null;
if (!keys) no(setFile + ' has no service_keys list');
// pinnedIsListed answers false, not null, for a pin that is not a key: told apart first, so junk is not called a mismatch.
if (!pinnedSpki(live)) no('/v1/meta coordinator_pubkey is not a key (' + JSON.stringify(live).slice(0, 80) + ')');
if (!keys.length) no(setFile + ' lists no keys at all, so it cannot list the live coordinator key ' + live);
if (!pinnedIsListed(live, { ok: true, keys })) {
  const kids = keys.map((k) => (k && k.kid) || '?').join(', ');
  no('the live coordinator key ' + live + ' is NOT on the set (' + keys.length + ' key(s): ' + kids + '). Every new cloud box and every sign-in under this release would refuse the real service.');
}
console.log('service key set vs the live coordinator: the live key ' + live + ' is listed');
