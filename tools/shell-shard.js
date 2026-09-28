'use strict';
/**
 * #4317: split `yarn test:shell` across parallel CI jobs, deterministically.
 *
 * The test job ran the node suite and then `test:shell` (185 commands, run one after another) in
 * one job, 24 to 28 minutes on main. Measured on macos-latest (probe run 36412608975): the node
 * part 517 s, the shell part 1,021 s. So CI runs the node part as one job and the shell commands as
 * SHELL_SHARDS jobs, each command in exactly one of them.
 *
 * WHICH SHARD: a command's sha256, mod the shard count. A new command lands in a shard with no list
 * to edit, and the same command always lands in the same shard. The union of the shards is the
 * full list by construction, and tools.shell-shard-4317.test.js proves it on the real list.
 *
 * HOW A SHARD RUNS: each of its commands with `sh -c`, from the repository root, in the order
 * test:shell lists them, stopping at the first that fails, exactly as the `&&` chain does. It
 * writes nothing into the checkout (a test here scans the repository, and a stray output file in
 * it was once read as a leaked signing id).
 *
 *   node tools/shell-shard.js list <i> <n>     print shard i of n (1-based), one command per line
 *   node tools/shell-shard.js run <i> <n>      run it
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// How many shell jobs test.yml runs. Measured: 2 gives 464 s and 557 s of shell time
// (probe run 36412608975), each well under 60% of the job's 45 minutes with setup.
const SHELL_SHARDS = 2;

function commands(pkg) {
  const script = (pkg || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))).scripts['test:shell'];
  const list = String(script || '').split(' && ').map((c) => c.trim()).filter(Boolean);
  if (!list.length) throw new Error('shell-shard: package.json has no test:shell commands');
  return list;
}

function shardOf(command, n) {
  return (crypto.createHash('sha256').update(command).digest().readUInt32BE(0) % n) + 1;
}

function select(list, i, n) {
  return list.filter((c) => shardOf(c, n) === i);
}

function parseShard(i, n) {
  const ii = Number(i); const nn = Number(n);
  if (!Number.isInteger(nn) || nn < 1 || !Number.isInteger(ii) || ii < 1 || ii > nn) {
    throw new Error(`shell-shard: shard must be i n with 1 <= i <= n (got ${i} ${n})`);
  }
  return [ii, nn];
}

// Run a shard's commands in order, stopping at the first that fails, and return its exit status
// (a signal is 1). `list` is the whole test:shell list, so the count in the first line is honest.
function runShard(list, ii, nn, stdio = 'inherit') {
  const mine = select(list, ii, nn);
  // A shard with nothing to run would pass having run nothing.
  if (!mine.length) { console.error(`shell-shard ${ii}/${nn}: no commands in this shard; refusing to report green`); return 1; }
  console.log(`shell-shard ${ii}/${nn}: ${mine.length} of ${list.length} test:shell commands`);
  for (const c of mine) {
    const r = cp.spawnSync('sh', ['-c', c], { cwd: ROOT, stdio });
    if (r.status !== 0) {
      const why = r.error ? `could not run: ${r.error.message}` : `exit ${r.status === null ? r.signal : r.status}`;
      console.error(`shell-shard ${ii}/${nn}: FAILED (${why}): ${c}`);
      return r.status || 1;
    }
  }
  console.log(`shell-shard ${ii}/${nn}: all ${mine.length} passed`);
  return 0;
}

function main(argv) {
  const [verb, i, n] = argv;
  if (verb !== 'list' && verb !== 'run') { console.error('usage: node tools/shell-shard.js list|run <i> <n>'); return 2; }
  const [ii, nn] = parseShard(i, n);
  if (verb === 'list') { for (const c of select(commands(), ii, nn)) console.log(c); return 0; }
  return runShard(commands(), ii, nn);
}

module.exports = { commands, shardOf, select, parseShard, runShard, SHELL_SHARDS };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
