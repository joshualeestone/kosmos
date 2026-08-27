'use strict';
/**
 * One-time adoption (#570).
 *
 * 🔑 JOSH RULED THIS, 2026-08-27: given "strict, recreate the seventeen" or
 * "mint once for agents Kosmos can already vouch for, then strict", he chose
 * adoption. This is that, and only that.
 *
 * 🛑 WHY THERE IS NO API ROUTE. An endpoint that mints credentials is a
 * network-reachable credential minter, which is the thing the credential
 * exists to prevent. Adoption runs locally, from the CLI, or not at all.
 *
 * 🛑 WHY IT RECORDS THE BASIS AND NOT JUST THE FACT. His own caveat when he
 * chose it: "the adoption step itself trusts what is on the machine today."
 * That is true, and it means an adopted credential is WEAKER EVIDENCE than a
 * created one. If the record does not say so, nobody can tell them apart
 * later, and "we vouched for whatever was running that afternoon" silently
 * becomes "Kosmos created this agent".
 */
const store = require('./store');
const sendertoken = require('./sendertoken');

const ORIGIN_CREATED = 'created';
const ORIGIN_ADOPTED = 'adopted';

/**
 * What adoption WOULD do, computed without writing anything.
 * `rows` are roster rows: { sessionName, isNamedOurs }.
 */
function plan(rows) {
  const out = { eligible: [], skipped: [] };
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = r && r.sessionName;
    if (!name) { out.skipped.push({ name: String(name), because: 'no session name' }); continue; }
    if (r.isNamedOurs !== true) {
      /* The roster gate is the same one `sendertoken.resolve` applies. Adopting
         a row we would not then accept a token from is a credential that can
         never be used, and a record asserting we vouched for something we do
         not recognise. */
      out.skipped.push({ name, because: 'not one of ours' });
      continue;
    }
    const had = safeProfile(name);
    if (had && had.origin) {
      out.skipped.push({ name, because: 'already has provenance: ' + had.origin });
      continue;
    }
    out.eligible.push({ name, vouchedOn: vouch(r, had) });
  }
  return out;
}

/* The EVIDENCE, not a verdict. What was actually true at the moment we
   vouched, so a reader in six months can judge the vouch rather than inherit
   it. */
function vouch(row, had) {
  return {
    sessionName: row.sessionName,
    isNamedOurs: row.isNamedOurs === true,
    hadProfile: !!had,
    profileUpdatedAt: (had && had.updatedAt) || null,
  };
}

function safeProfile(name) {
  try { return store.readProfile(name); } catch (e) { return null; }
}

/**
 * Perform it. Returns one result per eligible agent.
 * `by` is who ran it; recorded, because "who vouched" is half of a vouch.
 */
function apply(rows, by) {
  const at = new Date().toISOString();
  const done = [];
  for (const item of plan(rows).eligible) {
    let minted = null;
    try { minted = sendertoken.mint(item.name); } catch (e) { minted = null; }
    if (!minted || minted.ok !== true) {
      done.push({ name: item.name, ok: false, because: 'mint failed' });
      continue;
    }
    try {
      store.writeProfile(item.name, {
        origin: ORIGIN_ADOPTED,
        adoptedAt: at,
        adoptedBy: by || 'unknown',
        vouchedOn: item.vouchedOn,
      });
    } catch (e) {
      done.push({ name: item.name, ok: false, because: 'profile write failed' });
      continue;
    }
    done.push({ name: item.name, ok: true, instance: minted.instance });
  }
  return done;
}

module.exports = { plan, apply, ORIGIN_CREATED, ORIGIN_ADOPTED };
