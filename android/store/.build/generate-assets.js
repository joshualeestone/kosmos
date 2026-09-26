'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
require(path.join(root, 'docs/browser-checks/lib-sandbox-home.js'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-play-listing-'));
const fresh = (name) => {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
process.env.AGENT_WORKFORCE_DATA = fresh('data');
process.env.AGENT_WORKFORCE_WORKERS = fresh('workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fresh('config');
process.env.AGENT_WORKFORCE_LAUNCH = fresh('launch');
process.env.AGENT_WORKFORCE_PROJECTS = fresh('projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(scratch, 'claude.json');

const { chromium } = require('playwright');
const fleet = require(path.join(root, 'test-support/fleet'));
const serverModule = require(path.join(root, 'server.js'));

const output = path.resolve(__dirname, '..');
const phone = path.join(output, 'phone');
fs.mkdirSync(phone, { recursive: true });

async function settle(page) {
  await page.waitForFunction(() => typeof LAST_AT !== 'undefined' && LAST_AT > 0, null, { timeout: 10000 });
  await page.waitForTimeout(700);
}

(async () => {
  const installed = fleet.install([
    fleet.agent('atlas', { displayName: 'Atlas', role: 'Operations lead', state: 'working' }),
    fleet.agent('nova', { displayName: 'Nova', role: 'Researcher', state: 'needs_you' }),
    fleet.agent('pixel', { displayName: 'Pixel', role: 'Designer', state: 'idle' }),
    fleet.agent('quill', { displayName: 'Quill', role: 'Writer', state: 'working' }),
  ]);
  const server = await serverModule.start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) await page.keyboard.press('Escape');
    await page.evaluate(() => { applyLayout('list', true); showTab('agents'); });
    await settle(page);
    await page.screenshot({ path: path.join(phone, '01-team-overview-raw.png') });

    await page.evaluate(() => openDetail('nova'));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(phone, '02-agent-needs-you-raw.png') });

    await page.evaluate(() => { showTab('agents'); openDetail('atlas'); });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(phone, '03-agent-workspace-raw.png') });

    const login = path.join('/Users/mortalkombat/work/kosmos-relay/coordinator/src/signin.html');
    await page.goto(`file://${login}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(phone, '04-kosmos-plus-raw.png') });

    const logo = fs.readFileSync(path.join(root, 'assets/Kosmos-1024-shaped.png')).toString('base64');
    const feature = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
    await feature.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1024px;height:500px;overflow:hidden}
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;background:linear-gradient(135deg,#122448 0%,#17386f 54%,#286ad0 100%);position:relative}
      .glow{position:absolute;width:520px;height:520px;border-radius:50%;right:-110px;top:-165px;background:radial-gradient(circle,rgba(103,165,255,.42),rgba(103,165,255,0) 68%)}
      .stars{position:absolute;inset:0;opacity:.28;background-image:radial-gradient(circle,#fff 0 2px,transparent 3px);background-size:67px 67px;transform:rotate(-8deg) scale(1.15)}
      main{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:50px;padding:45px 100px}
      img{width:190px;height:190px;filter:drop-shadow(0 18px 30px rgba(0,0,0,.28))}
      h1{font-size:63px;line-height:1.02;letter-spacing:-2.7px;margin:0 0 18px;font-weight:750}
      p{font-size:29px;line-height:1.25;margin:0;color:#dbe9ff;font-weight:500;max-width:510px}
    </style><div class="glow"></div><div class="stars"></div><main><img src="data:image/png;base64,${logo}" alt=""><div><h1>Your AI team,<br>in your pocket.</h1><p>See the work. Answer the moments that need you.</p></div></main>`);
    await feature.screenshot({ path: path.join(output, 'feature-graphic-1024x500.png') });
    await feature.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    installed.restore();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
