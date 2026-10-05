'use strict';

/**
 * Measurement harness for kosmos#4468. It starts one real board with every
 * writable root and every tmux read pointed into a disposable sandbox, then
 * drives page polls, direct messages and room posts while the board writes a
 * V8 CPU profile. It never discovers, restarts or attaches to a live board.
 *
 * Run behind tools/heavy-gate.sh --twice:
 *   node test-support/profile-board-load-4468.js [seconds]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const fleet = require('./fleet');
const { stopBoard } = require('./board-child');

const REPO = path.resolve(__dirname, '..');
const AGENTS = 25;
const TABS = 3;
const POSTS_PER_MINUTE = 6;
const SECONDS = Math.max(1, Number(process.argv[2] || 60));

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function summary(values) {
  return {
    count: values.length,
    median_ms: Math.round(percentile(values, 0.5) * 10) / 10,
    p95_ms: Math.round(percentile(values, 0.95) * 10) / 10,
    max_ms: Math.round(Math.max(...values) * 10) / 10,
  };
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-profile-4468-'));
  const workers = path.join(sb, 'workers');
  const panes = path.join(sb, 'panes.txt');
  const screen = path.join(sb, 'screen.txt');
  const tmux = path.join(sb, 'fake-tmux.sh');
  const profileDir = path.join(sb, 'profile');
  const dataRoot = path.join(sb, 'data');
  const kosmosData = path.join(dataRoot, 'Kosmos');
  const projectFolders = Array.from({ length: 3 }, (_, i) => path.join(sb, `project-folder-${i + 1}`));
  for (const dir of [workers, profileDir, kosmosData, ...projectFolders]) fs.mkdirSync(dir, { recursive: true });

  const specs = Array.from({ length: AGENTS }, (_, i) => fleet.agent(`load-agent-${i + 1}`, {
    pane: `0.${i}`,
    state: i % 7 === 0 ? 'needs_you' : (i % 3 === 0 ? 'working' : 'idle'),
    displayName: `Load Agent ${i + 1}`,
    role: i % 4 === 0 ? 'Researcher' : 'Builder',
  }));
  fs.writeFileSync(panes, specs.map(fleet.line).join('\n') + '\n');
  fs.writeFileSync(screen, 'Worked for 1m 02s\n> \n');
  fs.writeFileSync(tmux, `#!/bin/sh
case "$1" in
  list-panes) cat "$AGENT_WORKFORCE_FAKE_PANES"; exit 0 ;;
  list-sessions) exit 0 ;;
  capture-pane) cat "$AGENT_WORKFORCE_FAKE_SCREEN"; exit 0 ;;
  display-message)
    target=""
    prev=""
    for arg in "$@"; do [ "$prev" = "-t" ] && target="$arg"; prev="$arg"; done
    number="\${target#%}"
    case "$*" in
      *'#{session_name}'*) printf 'load-agent-%s-discord\\n' "$number" ;;
      *) printf '2.1.212\\t\\t0\\n' ;;
    esac
    exit 0 ;;
  *) exit 0 ;;
esac
`);
  fs.chmodSync(tmux, 0o755);
  for (const spec of specs) {
    const dir = path.join(workers, spec.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `You are **${spec.displayName}**, ${spec.role}.\n`);
  }
  const agentNames = specs.map((spec) => spec.name);
  const projects = projectFolders.map((folder, i) => ({
    id: `loadroom${i + 1}`,
    name: `Load room ${i + 1}`,
    description: '',
    folder,
    agents: agentNames,
    everSeen: Object.fromEntries(agentNames.map((name) => [name, true])),
    told: Object.fromEntries(agentNames.map((name) => [name, { state: 'told', because: null, at: '2026-01-01T00:00:00.000Z' }])),
    parent: null,
    made: { via: 'process', by: null, at: '2026-01-01T00:00:00.000Z' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  for (let i = 0; i < projectFolders.length; i += 1) {
    fs.writeFileSync(path.join(projectFolders[i], 'BRIEF.md'), `# Load room ${i + 1}\n`);
  }
  fs.writeFileSync(path.join(kosmosData, 'projects.json'), JSON.stringify(projects, null, 2) + '\n');

  const child = spawn(process.execPath, [
    '--cpu-prof', `--cpu-prof-dir=${profileDir}`, '--cpu-prof-name=board-25.cpuprofile',
    path.join(REPO, 'server.js'),
  ], {
    env: {
      ...process.env,
      HOME: sb,
      PORT: '0',
      NODE_TEST_CONTEXT: 'profile-4468',
      AGENT_WORKFORCE_DATA: dataRoot,
      AGENT_WORKFORCE_WORKERS: workers,
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: tmux,
      AGENT_WORKFORCE_FAKE_PANES: panes,
      AGENT_WORKFORCE_FAKE_SCREEN: screen,
      // Writes reach only the sandbox tmux above. Dry-run would refuse before
      // the real send path, so it would profile a failure the live board does not take.
      AGENT_WORKFORCE_DRY_RUN: '',
      AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created',
      // Review 1 (homepage counts): run outside node --test, so the report and the community go nowhere real either.
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
      AGENT_WORKFORCE_COMMUNITY_URL: 'http://127.0.0.1:9/',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (b) => { stdout += b; });
  child.stderr.on('data', (b) => { stderr += b; });

  try {
    const deadline = Date.now() + 15000;
    let port;
    while (!port && Date.now() < deadline && child.exitCode === null) {
      const m = stdout.match(/Kosmos on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) port = Number(m[1]);
      else await wait(25);
    }
    if (!port) throw new Error(`board did not start; stdout=${stdout}; stderr=${stderr}`);
    const base = `http://127.0.0.1:${port}`;

    const timings = { status: [], projects: [], msg: [], post: [] };
    const failures = [];
    const until = performance.now() + SECONDS * 1000;
    async function hit(kind, url, options) {
      const began = performance.now();
      try {
        const response = await fetch(base + url, options);
        const responseBody = Buffer.from(await response.arrayBuffer()).toString('utf8');
        if (!response.ok) failures.push(`${kind}:${response.status}:${responseBody.slice(0, 240)}`);
        if ((kind === 'msg' || kind === 'post') && response.ok) {
          let parsed;
          try { parsed = JSON.parse(responseBody); } catch { /* recorded below */ }
          if (!parsed || !parsed.delivery || parsed.delivery.state !== 'placed') {
            failures.push(`${kind}:delivery:${responseBody.slice(0, 240)}`);
          }
        }
      } catch (error) {
        const cause = error && error.cause && (error.cause.code || error.cause.message);
        failures.push(`${kind}:${error && error.message ? error.message : error}${cause ? `:${cause}` : ''}`);
      } finally {
        timings[kind].push(performance.now() - began);
      }
    }
    async function periodic(everyMs, offsetMs, fn) {
      if (offsetMs >= SECONDS * 1000) return;
      await wait(offsetMs);
      while (performance.now() < until) {
        const began = performance.now();
        await fn();
        const left = everyMs - (performance.now() - began);
        const remaining = until - performance.now();
        if (remaining <= 0) break;
        if (left > 0) await wait(Math.min(left, remaining));
      }
    }
    async function once(offsetMs, fn) {
      if (offsetMs >= SECONDS * 1000) return;
      await wait(offsetMs);
      await fn();
    }

    const jobs = [];
    for (let tab = 0; tab < TABS; tab += 1) {
      jobs.push(periodic(5000, tab * 1000, async () => {
        await hit('status', '/api/status');
        await hit('projects', '/api/projects');
      }));
    }
    for (let i = 0; i < AGENTS; i += 1) {
      const from = specs[i];
      const to = specs[(i + 1) % AGENTS];
      const fromPane = `%${i + 1}`;
      jobs.push(once(Math.floor(i * (60000 / AGENTS)), () => hit('msg', '/api/msg', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from_pane: fromPane, to: to.name, text: `load message from ${from.name}` }),
      })));
      if (i < POSTS_PER_MINUTE) {
        jobs.push(once(Math.floor(i * (60000 / POSTS_PER_MINUTE)), () => hit('post', '/api/post', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from_pane: fromPane, project: `loadroom${(i % 3) + 1}`, text: `load post from ${from.name}`, new_post: true, reply_expected: false }),
        })));
      }
    }
    await Promise.all(jobs);
    const childBeforeStop = { exit_code: child.exitCode, signal: child.signalCode };
    const dead = await stopBoard(child);
    if (!dead) throw new Error('profiled board did not stop');
    const profile = path.join(profileDir, 'board-25.cpuprofile');
    if (!fs.existsSync(profile)) throw new Error(`CPU profile was not written; stderr=${stderr}`);
    const result = {
      agents: AGENTS,
      tabs: TABS,
      posts_per_minute: POSTS_PER_MINUTE,
      seconds: SECONDS,
      timings: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, summary(v)])),
      failures,
      board_stderr: stderr.trim(),
      child_before_stop: childBeforeStop,
      profile,
      sandbox: sb,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    // Keep the sandbox so the caller can inspect the profile, then remove it explicitly.
  } catch (error) {
    await stopBoard(child);
    fs.rmSync(sb, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
