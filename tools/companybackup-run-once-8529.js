#!/usr/bin/env node
'use strict';
/**
 * kosmos#8529: ONE company backup run on this board's data, as the hourly tick does it (engine/backuptick.js
 * startHere): the gate (mayBackUp), the roots of this world (rootsFor(inputsHere())), then backuprun.runBackup.
 * Started by hand instead of by the hour's timer, so a throwaway run does not wait an hour. Not done here: the tick's
 * Antigravity staging (no Antigravity agent in such a run). Run it with the board's own environment
 * (tools/companybackup-e2e-8529.js passes boardEnv), while the board's own tick has not fired (it fires an hour after
 * the board starts), so two runs never overlap on one data root. Prints one JSON line. Never throws.
 */
(async () => {
  const out = { ok: false };
  try {
    const tick = require('../engine/backuptick');
    out.mayBackUp = tick.mayBackUp();
    if (!out.mayBackUp) { out.because = 'this computer is not enrolled with a company whose words were accepted here'; return; }
    const plan = tick.rootsFor(tick.inputsHere());
    out.roots = plan.roots.map((r) => r.name);
    out.left = plan.left;
    // The snapshot id, as backuprun.js newSnapshotId makes it (UTC time and 4 random bytes), recorded so a reader of what
    // this run stored can open its manifest (its sealed context names the snapshot); the run itself is unchanged.
    // A run can take a second snapshot in a granted week (backuprun), so every id it made is kept, in order.
    out.snapshots = [];
    const snapshotId = (ms) => {
      const id = new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + require('crypto').randomBytes(4).toString('hex');
      out.snapshots.push(id);
      return id;
    };
    out.storeRoot = require('../engine/store').ROOT;   // where this board keeps backupkeys/ and backupstate/
    const r = await require('../engine/backuprun').runBackup({ roots: plan.roots }, { snapshotId });
    out.ok = !!(r && r.ok);
    out.because = r && r.because;
    // For a reader of what this run stored (kosmos#8529): the public half of the key the manifest is signed with.
    try {
      const dk = require('../engine/backupdevicekey').deviceKey();
      if (dk && dk.ok) out.devicePublicKey = dk.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    } catch { /* not said: the run's own answer stands */ }
    out.result = r && typeof r === 'object'
      ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? { length: v.length } : v && typeof v === 'object' ? Object.keys(v) : v]))
      : r;
  } catch (e) {
    out.because = 'threw: ' + (e && e.message ? e.message : e);
  } finally {
    console.log(JSON.stringify(out));
  }
})();
