'use strict';
/*
 * kosmos#9026: which test seed the first Kosmos+ sign-in gate (tools/plus-signin-auto.sh) signs in with.
 *
 * Every run registers the throwaway board under the seed's own Kosmos+ address, and the coordinator asks Let's Encrypt
 * for a certificate for that exact name. Let's Encrypt refuses a sixth certificate for the same name within a week
 * (its duplicate-certificate limit), so one seed runs the gate about five times a week (measured 11-24: the sixth run in
 * an hour got HTTP 429 on /v1/mac/cert). This keeps a ledger of the runs that reached the certificate step, per seed,
 * beside the gate's records, and picks the seed used least in the last week that is still under the limit. When every
 * seed given is used up, the gate says so before any download, with when the next one frees, rather than finding out
 * from a 429 after the download and the boot.
 *
 * Rows are one JSON line each, { seed, at }. Counted, never trusted for more: a ledger that cannot be read counts as
 * empty (the worst case is the 429 the gate already reads as "cannot tell"), and a run recorded here that then failed
 * before the certificate is counted anyway (the safe side). The ledger is per machine: runs from two machines with one
 * seed are not seen by each other.
 *
 *   node tools/lib/plus-seed-ledger.js pick <ledger> <seed>...   prints the seed to use, or exits 3 with the reason
 *   node tools/lib/plus-seed-ledger.js record <ledger> <seed>     appends a row for now
 */
const fs = require('node:fs');
const path = require('node:path');

/* Let's Encrypt's duplicate-certificate limit: certificates for the same exact name, per rolling week. */
const LIMIT = 5;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function rows(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && typeof r.seed === 'string' && Number.isFinite(Date.parse(r.at))) out.push({ seed: r.seed.toLowerCase(), atMs: Date.parse(r.at) });
  }
  return out;
}

/* { seed } to use, or { none: true, freesAtMs } when every seed has LIMIT runs in the window. Least used first; a tie
   goes to the order given. */
function pick(file, seeds, nowMs = Date.now(), o = {}) {
  const limit = Number.isInteger(o.limit) ? o.limit : LIMIT;
  const windowMs = Number.isFinite(o.windowMs) ? o.windowMs : WINDOW_MS;
  const given = seeds.map((s) => String(s).toLowerCase()).filter((s, i, all) => s && all.indexOf(s) === i);
  const recent = rows(file).filter((r) => r.atMs <= nowMs && nowMs - r.atMs < windowMs);
  const uses = given.map((seed, i) => ({ seed, i, at: recent.filter((r) => r.seed === seed).map((r) => r.atMs).sort((a, b) => a - b) }));
  const open = uses.filter((u) => u.at.length < limit).sort((a, b) => a.at.length - b.at.length || a.i - b.i);
  if (open.length) return { seed: open[0].seed, used: open[0].at.length };
  /* Each full seed frees when its oldest counted run leaves the window. */
  const freesAtMs = Math.min(...uses.map((u) => u.at[u.at.length - limit] + windowMs));
  return { none: true, freesAtMs };
}

function record(file, seed, nowMs = Date.now()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ seed: String(seed).toLowerCase(), at: new Date(nowMs).toISOString() }) + '\n');
}

if (require.main === module) {
  const [cmd, file, ...seeds] = process.argv.slice(2);
  if (cmd === 'pick' && file && seeds.length) {
    const p = pick(file, seeds);
    if (p.seed) { process.stdout.write(p.seed + '\n'); process.exit(0); }
    process.stdout.write('every seed given (' + seeds.join(', ') + ') has had ' + LIMIT + ' certificates in the last 7 days, '
      + 'Let\'s Encrypt\'s limit for one name; the next one frees at ' + new Date(p.freesAtMs).toISOString() + '\n');
    process.exit(3);
  }
  if (cmd === 'record' && file && seeds.length === 1) { record(file, seeds[0]); process.exit(0); }
  process.stderr.write('usage: plus-seed-ledger.js pick <ledger> <seed>... | record <ledger> <seed>\n');
  process.exit(2);
}

module.exports = { pick, record, rows, LIMIT, WINDOW_MS };
