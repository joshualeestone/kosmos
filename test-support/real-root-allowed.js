'use strict';
/**
 * kosmos#5418: a test process is never given this machine's real data root unless it says so.
 * A control that reads the real root's PATH on purpose (to prove the product's derivation) runs
 * its read inside this: the real root is allowed, and the legacy migration is off, so the read
 * cannot rename anything. The environment is restored afterwards.
 */
function withRealRootAllowed(fn) {
  const saved = { KOSMOS_ALLOW_REAL_ROOT: process.env.KOSMOS_ALLOW_REAL_ROOT, KOSMOS_NO_LEGACY_MIGRATION: process.env.KOSMOS_NO_LEGACY_MIGRATION };
  process.env.KOSMOS_ALLOW_REAL_ROOT = '1';
  process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
module.exports = { withRealRootAllowed };
