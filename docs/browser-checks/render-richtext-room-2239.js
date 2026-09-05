'use strict';
/* #2239: rich text in the PROJECT ROOM activity thread, checked in the real
 * page. Josh, 0.6.35 fresh install: "how I had the agents test paragraph breaks
 * and font controls: heading, italics, bold ... and it doesn't render." The two
 * pjRich row surfaces (talk thread, project message list) render restricted
 * markdown; the room thread only escaped + autolinked, so an agent's `**bold**`,
 * `# heading` and paragraph breaks arrived as raw markers and collapsed lines --
 * the surface #2067 deferred to "its own PR". This wires it via pjProse (the
 * fence-free rich prose renderer pjBody hands each non-code segment).
 *
 * Two layers, both against the SHIPPED functions, never a copy:
 *
 *   1. pjBody()/pjProse() called IN the page over a battery -- markdown renders,
 *      HTML stays inert, markers never leak, a cited file still becomes a "Show
 *      me" chip, a bare `>` stays LITERAL (the room has its own server-supplied
 *      quote; web.quoteb owns that contract), and plain single-line text is
 *      byte-identical to the page's own esc(). A copy here would be a guard that
 *      cannot fail; this drives web/index.html's own functions.
 *   2. The real project room PAINTED (via the live server) with a markdown room
 *      post, so the .msg-b DOM and the computed CSS (heading weight, code
 *      background) are exercised end to end, and the dangerous-answer control (a
 *      <script> in the post) is proven inert in the actual bubble.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-richtext-room-2239.js
 *      (HEADED=0 on a machine with no console session)
 *
 * It MEASURES IN THE PAGE (return value of the shipped function; innerHTML of
 * the real .msg-b; getComputedStyle of a real .mdh/.mdc) rather than judging a
 * screenshot, so it is mode-independent.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE member, never a live agent: the room refuses a post when nobody is
     on the project, and naming a real session here would type into that agent's
     live pane. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '✳ idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });

  try {
    for (const theme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
      const t = '[' + theme + ']';
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon/.test(m.text())) errs.push(m.text()); });

      await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

      /* ---- Layer 1: the shipped pjBody/pjProse, called in the page. ---- */
      const r = await p.evaluate(() => {
        const N = new Set(['notes.md', 'plan.md']);
        const body = (s, names) => pjBody(s, names);
        return {
          bodyExists: typeof pjBody === 'function' && typeof pjProse === 'function' && typeof esc === 'function',
          // plain single line byte-identical to the page's own esc (no-regress control)
          plain: body('hello world', N) === esc('hello world'),
          plainAngles: body('a < b & c > "d"', N) === esc('a < b & c > "d"'),
          empty: body('', N) === '',
          // markdown Josh named
          bold: body('a **b** c', N),
          italic: body('a *b* c', N),
          heading: body('# Title', N),
          // paragraph breaks: a blank line becomes a real <br><br>, not collapse
          paras: body('First.\n\nSecond.', N),
          // more markdown that must not regress
          ul: body('- one', N),
          ol: body('1. first', N),
          codeInline: body('run `kosmos open`', N),
          fence: body('before\n```\ncode\nline\n```\nafter', N),
          // the room's citation chip must SURVIVE alongside markdown
          chip: body('see notes.md now', N),
          chipInHeading: body('# See plan.md', N),
          // a bare `>` with no server tag stays LITERAL in the room (web.quoteb)
          gt: body('> just text', N),
          // built by concatenation so browser-checks-selectors.test.js does not
          // read this markdown input (a '#' with no space) as a CSS id selector.
          hashtag: body('#' + 'hashtag stays', N) === esc('#' + 'hashtag stays'),
          // dangerous-answer controls: a tag must NEVER survive as a tag
          script: body('<script>alert(1)</script> and **b**', N),
          img: body('<img src=x onerror=alert(1)>', N),
          // url preserved
          url: body('see https://x.test/p now', N),
        };
      });
      ok(t + ' pjBody/pjProse/esc exist' + (r.bodyExists ? '' : ''));
      if (!r.bodyExists) bad(t + ' pjBody/pjProse/esc exist', 'a required function is missing');
      ok(t + ' plain==esc'); if (!r.plain) bad(t + ' plain==esc', r.plain);
      ok(t + ' plain angles/quote==esc'); if (!r.plainAngles) bad(t + ' plain angles/quote==esc', 'not equal');
      ok(t + ' empty'); if (!r.empty) bad(t + ' empty', String(r.empty));
      if (/<strong>b<\/strong>/.test(r.bold)) ok(t + ' bold'); else bad(t + ' bold', r.bold);
      if (/<em>b<\/em>/.test(r.italic)) ok(t + ' italic'); else bad(t + ' italic', r.italic);
      if (/<span class="mdh">Title<\/span>/.test(r.heading) && !/# /.test(r.heading)) ok(t + ' heading (strips #)'); else bad(t + ' heading', r.heading);
      if (/First\.<br><br>Second\./.test(r.paras)) ok(t + ' paragraph breaks -> <br><br>'); else bad(t + ' paragraph breaks', r.paras);
      if (/<span class="mdli">one<\/span>/.test(r.ul) && !/- one/.test(r.ul)) ok(t + ' unordered list (strips dash)'); else bad(t + ' unordered list', r.ul);
      if (/data-n="1\."/.test(r.ol) && />first<\/span>/.test(r.ol)) ok(t + ' ordered list'); else bad(t + ' ordered list', r.ol);
      if (/<code class="mdc">kosmos open<\/code>/.test(r.codeInline)) ok(t + ' inline code'); else bad(t + ' inline code', r.codeInline);
      if (/<figure class="codeb"><pre>code\nline<\/pre><\/figure>/.test(r.fence) && !/```/.test(r.fence)) ok(t + ' fenced code (no leak, figure kept)'); else bad(t + ' fenced code', r.fence);
      if (/<span class="ref">notes\.md<button class="refgo"/.test(r.chip)) ok(t + ' citation chip survives'); else bad(t + ' citation chip', r.chip);
      if (/<span class="mdh">See <span class="ref">plan\.md/.test(r.chipInHeading)) ok(t + ' chip inside heading'); else bad(t + ' chip inside heading', r.chipInHeading);
      // room-specific: `>` is literal (escaped), never an .mdq quote span
      if (/&gt; just text/.test(r.gt) && !/mdq/.test(r.gt)) ok(t + ' bare > stays literal (room quote contract)'); else bad(t + ' bare > stays literal', r.gt);
      if (r.hashtag) ok(t + ' no-space hash stays plain'); else bad(t + ' no-space hash stays plain', 'differs from esc');
      if (!/<script/i.test(r.script) && /&lt;script&gt;/.test(r.script) && /<strong>b<\/strong>/.test(r.script)) ok(t + ' script inert, bold still applies'); else bad(t + ' script inert', r.script);
      if (!/<img/i.test(r.img) && /&lt;img/.test(r.img)) ok(t + ' img onerror inert'); else bad(t + ' img onerror inert', r.img);
      if (/<a class="xlink" href="https:\/\/x\.test\/p"/.test(r.url)) ok(t + ' bare url autolink kept'); else bad(t + ' url autolink', r.url);

      /* CONTROL: prove the room renderer can actually MANGLE if it were wrong,
         so the plain==esc arm is a real equality, not both sides broken alike. */
      const differs = await p.evaluate(() => pjBody('a **b**', new Set()) !== esc('a **b**'));
      if (differs) ok(t + ' markdown output differs from esc (control)'); else bad(t + ' markdown differs from esc (control)', 'room render equals esc for markdown');

      /* ---- Layer 2: paint the REAL room via the server and read DOM + CSS. ---- */
      const pjName = 'Rich Room ' + theme;
      const made = await p.evaluate(async (name) => {
        const r1 = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r1.ok) return { error: 'project create ' + r1.status };
        const body = await r1.json();
        const id = body.project.id;
        await fetch('/api/project/' + id + '/agent/roomer', { method: 'POST', headers: { 'content-type': 'application/json' } });
        // A markdown room post carrying every element Josh named + a safety control.
        const text = '# Status\n\nDone **three** things and *one* more:\n- fixed the `bug`\n\n<script>alert(1)</script>\n\nsee https://kosmos.test/pr/42';
        const r2 = await fetch('/api/project/' + id + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
        const j = await r2.json().catch(() => null);
        if (j && j.delivery && j.delivery.state === 'could_not') return { error: 'post refused: ' + j.delivery.because };
        return { id };
      }, pjName);
      if (made.error) { bad(t + ' Layer 2 fixture posted a room message', made.error); await p.close(); continue; }

      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText(pjName, { exact: true }).first().click();
      await p.waitForSelector('#pj-room', { state: 'visible' });
      // Wait for the agent's markdown post to paint into a .msg-b bubble.
      await p.waitForFunction(() => {
        const bubbles = document.querySelectorAll('#pj-room .msg-b');
        return Array.from(bubbles).some((b) => b.querySelector('.mdh'));
      }, null, { timeout: 15000 }).catch(() => {});

      const dom = await p.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('#pj-room .msg-b'));
        const b = bubbles.find((x) => x.querySelector('.mdh')) || bubbles[bubbles.length - 1] || null;
        const mdh = b && b.querySelector('.mdh');
        const mdc = b && b.querySelector('.mdc');
        const csH = mdh ? getComputedStyle(mdh) : null;
        const csC = mdc ? getComputedStyle(mdc) : null;
        return {
          found: !!b,
          html: b ? b.innerHTML : null,
          hasStrong: !!(b && b.querySelector('strong')),
          hasEm: !!(b && b.querySelector('em')),
          hasHeading: !!mdh,
          hasLi: !!(b && b.querySelector('.mdli')),
          hasCode: !!mdc,
          hasLink: !!(b && b.querySelector('a.xlink')),
          hasBr: b ? /<br>/.test(b.innerHTML) : false,
          scriptEl: !!(b && b.querySelector('script')),
          rawScriptText: b ? b.innerHTML.includes('<script>alert(1)</script>') : false,
          headingWeight: csH ? csH.fontWeight : null,
          codeBg: csC ? csC.backgroundColor : null,
        };
      });
      if (dom.found) ok(t + ' DOM: a markdown room bubble exists'); else { bad(t + ' DOM: a markdown room bubble exists', 'no .msg-b with .mdh painted'); await p.close(); continue; }
      if (dom.hasHeading) ok(t + ' DOM: heading rendered in room'); else bad(t + ' DOM: heading rendered', dom.html);
      if (dom.hasStrong) ok(t + ' DOM: bold rendered in room'); else bad(t + ' DOM: bold rendered', dom.html);
      if (dom.hasEm) ok(t + ' DOM: italic rendered in room'); else bad(t + ' DOM: italic rendered', dom.html);
      if (dom.hasLi) ok(t + ' DOM: list rendered in room'); else bad(t + ' DOM: list rendered', dom.html);
      if (dom.hasCode) ok(t + ' DOM: inline code rendered in room'); else bad(t + ' DOM: inline code rendered', dom.html);
      if (dom.hasLink) ok(t + ' DOM: url autolinked in room'); else bad(t + ' DOM: url autolinked', dom.html);
      if (dom.hasBr) ok(t + ' DOM: paragraph break is a <br> in room'); else bad(t + ' DOM: paragraph break rendered', dom.html);
      // dangerous-answer, at the DOM level
      if (!dom.scriptEl) ok(t + ' DOM: no <script> element in room'); else bad(t + ' DOM: no <script> element', 'a script element reached the bubble');
      if (!dom.rawScriptText) ok(t + ' DOM: no raw script tag string in room'); else bad(t + ' DOM: no raw script tag string', dom.html);
      // CSS wired to .msg-b: heading bold, code has a ground
      if (dom.headingWeight === '700' || Number(dom.headingWeight) >= 700) ok(t + ' CSS: room heading is bold (' + dom.headingWeight + ')'); else bad(t + ' CSS: room heading is bold', String(dom.headingWeight));
      if (dom.codeBg && dom.codeBg !== 'rgba(0, 0, 0, 0)' && dom.codeBg !== 'transparent') ok(t + ' CSS: room code has a background (' + dom.codeBg + ')'); else bad(t + ' CSS: room code has a background', String(dom.codeBg));

      if (errs.length) bad(t + ' no page errors', errs.join(' | ')); else ok(t + ' no page errors');
      await p.close();
    }
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 40) { console.log('richtext-room: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('richtext-room: ' + failures + ' FAILED'); process.exit(1); }
  console.log('richtext-room: all good, ' + ran + ' checks');
})();
