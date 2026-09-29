'use strict';

/** Print self and inclusive wall-sample time from the #4468 V8 CPU profile. */
const fs = require('node:fs');

const file = process.argv[2];
if (!file) throw new Error('usage: node test-support/summarize-cpuprofile-4468.js <file.cpuprofile>');
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);

const self = new Map();
const inclusive = new Map();
let elapsedUs = 0;
for (let i = 0; i < (profile.samples || []).length; i += 1) {
  const id = profile.samples[i];
  const delta = profile.timeDeltas ? profile.timeDeltas[i] : 1000;
  elapsedUs += delta;
  self.set(id, (self.get(id) || 0) + delta);
  const seen = new Set();
  for (let at = id; at && !seen.has(at); at = parent.get(at)) {
    seen.add(at);
    inclusive.set(at, (inclusive.get(at) || 0) + delta);
  }
}

function label(id) {
  const frame = (nodes.get(id) || {}).callFrame || {};
  const url = String(frame.url || '').replace(/^file:\/\//, '');
  return `${frame.functionName || '(anonymous)'} ${url}:${Number(frame.lineNumber || -1) + 1}`;
}

function grouped(values) {
  const out = new Map();
  for (const [id, us] of values) out.set(label(id), (out.get(label(id)) || 0) + us);
  return out;
}

function top(values) {
  return [...grouped(values).entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([frame, us]) => ({
    seconds: Math.round(us / 1000) / 1000,
    percent: Math.round((us / elapsedUs) * 1000) / 10,
    frame,
  }));
}

process.stdout.write(JSON.stringify({
  samples: (profile.samples || []).length,
  elapsed_seconds: Math.round(elapsedUs / 1000) / 1000,
  self: top(self),
  inclusive: top(inclusive),
}, null, 2) + '\n');
