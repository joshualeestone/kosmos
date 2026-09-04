'use strict';
/* #2067: the restricted-markdown renderer (pjRich) for agent dialogue, checked
 * in the real page. Two layers, both against the SHIPPED function, never a copy:
 *
 *   1. pjRich() called IN the page over a battery of inputs -- markdown renders,
 *      HTML stays inert, markers never leak, plain text is byte-identical to the
 *      page's own esc(). A copy of the renderer here would be a guard that
 *      cannot fail; this drives web/index.html's own function.
 *   2. The talk thread PAINTED with a markdown agent message, so the DOM and the
 *      computed CSS (heading weight, code background) are exercised end to end,
 *      in both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-richtext-2067.js
 *      (HEADED=0 on a machine with no console session)
 *
 * It MEASURES IN THE PAGE (innerHTML of the real bubble, getComputedStyle of a
 * real .mdh/.mdc) rather than judging a screenshot, so it is mode-independent.
 * The dangerous-answer control is a message carrying <script> and an
 * onerror image: the check FAILS if either reaches the DOM as a tag.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; } else { problems.push(name + (detail ? ' -- ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADED === '0',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });

  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;   // the open agent's avatar under file://
      problems.push(`[${theme}] console: ${m.text()}`);
    });
    await page.addInitScript(() => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;                        // refuse the app's 5s tick
      window.__fx = null;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/thread')) return enc(window.__fx);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
        return enc({});
      };
    });
    await page.goto(PAGE);

    /* ---- Layer 1: the shipped pjRich, called in the page. ---- */
    const r = await page.evaluate(() => {
      const pj = (s) => pjRich(s);
      return {
        escExists: typeof esc === 'function',
        pjExists: typeof pjRich === 'function',
        // plain text byte-identical to the page's own esc (the no-regress control)
        plain: pj('hello world') === esc('hello world'),
        plainMultiline: pj('a\nb') === esc('a\nb'),
        plainAngles: pj('a < b & c > "d"') === esc('a < b & c > "d"'),
        // built by concatenation so browser-checks-selectors.test.js does not
        // read this markdown input (a '#' with no space) as a CSS id selector.
        hashtag: pj('#' + 'hashtag stays') === esc('#' + 'hashtag stays'),
        dashword: pj('well-being ok') === esc('well-being ok'),
        snake: pj('my_var and your_var') === esc('my_var and your_var'),
        empty: pj('') === '',
        // markdown
        bold: pj('a **b** c'),
        italic: pj('a *b* c'),
        strike: pj('a ~~b~~ c'),
        code: pj('run `kosmos open`'),
        heading: pj('# Title'),
        ul: pj('- one'),
        ol: pj('1. first'),
        quote: pj('> quoted'),
        hr: pj('---'),
        fence: pj('```\ncode\nline\n```'),
        // degrade / safety (the dangerous-answer controls)
        script: pj('<script>alert(1)</script>'),
        img: pj('<img src=x onerror=alert(1)>'),
        boldScript: pj('**<script>x</script>**'),
        urlQuote: pj('https://x.test/"onmouseover="alert(1)'),
        jsLink: pj('[x](javascript:alert(1))'),
        mdLink: pj('[click here](https://evil.test)'),
        // a markdown link to a NON-http target must ALSO strip to its text, not
        // show raw [text](url) markup (the http-only fast path used to leak it).
        mdLinkRel: pj('[the docs](docs/help.md)'),
        mdLinkMail: pj('[email me](mailto:x@y.test)'),
        fenceNoLink: pj('```\nhttps://x.test\n```'),
        headingHtml: pj('# <b>hi</b>'),
        // the three URL/emphasis-interaction vectors an earlier version got
        // wrong: (E1) inline code adjacent to a URL must not inject the code
        // tag into the href; (E2) a URL containing underscores must not be
        // italicised mid-URL; (E3) bold text ending in a URL must link the URL
        // and not leak the closing `**`.
        urlCode: pj('http://x/`a`'),
        urlUnderscore: pj('see https://x.test/_a_ now'),
        boldUrl: pj('**see https://x.test**'),
        // preserved behaviour
        url: pj('see https://x.test/p now'),
        emoji: pj('ship it \u{1F680}'),
      };
    });

    // Every <a> pjRich emits must carry both safety attrs and never have a tag
    // injected inside its opening tag — the well-formedness the E1 vector broke.
    const anchorsSafe = (html) => {
      const opens = html.match(/<a\b[^>]*>/g) || [];
      return opens.length > 0 && opens.every((o) =>
        /rel="noreferrer noopener"/.test(o) && /target="_blank"/.test(o) && !/<code|<em|<strong/.test(o));
    };

    const t = `[${theme}]`;
    ok(t + ' esc/pjRich exist', r.escExists && r.pjExists);
    ok(t + ' plain==esc', r.plain);
    ok(t + ' plain multiline==esc', r.plainMultiline);
    ok(t + ' plain angles/quote==esc', r.plainAngles);
    ok(t + ' no-space hash stays plain', r.hashtag);
    ok(t + ' well-being stays plain', r.dashword);
    ok(t + ' snake_case not italic', r.snake);
    ok(t + ' empty', r.empty);
    ok(t + ' bold', /<strong>b<\/strong>/.test(r.bold), r.bold);
    ok(t + ' italic', /<em>b<\/em>/.test(r.italic), r.italic);
    ok(t + ' strike', /<s>b<\/s>/.test(r.strike), r.strike);
    ok(t + ' inline code', /<code class="mdc">kosmos open<\/code>/.test(r.code), r.code);
    ok(t + ' heading tag', /<span class="mdh">Title<\/span>/.test(r.heading), r.heading);
    ok(t + ' heading strips #', !/# /.test(r.heading), r.heading);
    ok(t + ' unordered list', /<span class="mdli">one<\/span>/.test(r.ul), r.ul);
    ok(t + ' ul strips dash', !/- one/.test(r.ul), r.ul);
    ok(t + ' ordered list', /data-n="1\."/.test(r.ol) && />first<\/span>/.test(r.ol), r.ol);
    ok(t + ' quote', /<span class="mdq">quoted<\/span>/.test(r.quote), r.quote);
    ok(t + ' quote strips >', !/&gt; /.test(r.quote), r.quote);
    ok(t + ' hr', r.hr === '<span class="mdhr"></span>', r.hr);
    ok(t + ' fenced code renders', /<span class="mdcb">code\nline<\/span>/.test(r.fence), r.fence);
    ok(t + ' fenced code no leak', !/```/.test(r.fence), r.fence);
    // DANGEROUS-ANSWER CONTROLS: a tag must NEVER survive as a tag.
    ok(t + ' script inert', !/<script/i.test(r.script) && /&lt;script&gt;/.test(r.script), r.script);
    ok(t + ' img onerror inert', !/<img/i.test(r.img) && /&lt;img/.test(r.img), r.img);
    ok(t + ' bold+script inert', !/<script/i.test(r.boldScript) && /<strong>&lt;script&gt;/.test(r.boldScript), r.boldScript);
    ok(t + ' url quote cannot break attr', !/onmouseover="alert/.test(r.urlQuote) && /&quot;/.test(r.urlQuote), r.urlQuote);
    ok(t + ' no javascript: link', !/href="javascript:/.test(r.jsLink), r.jsLink);
    ok(t + ' md link text only, not anchored', /click here/.test(r.mdLink) && !/href="https:\/\/evil\.test"/.test(r.mdLink), r.mdLink);
    ok(t + ' md link (relative) stripped to text', r.mdLinkRel === 'the docs', r.mdLinkRel);
    ok(t + ' md link (relative) no raw markup', !/\]\(/.test(r.mdLinkRel) && !r.mdLinkRel.includes('docs/help.md'), r.mdLinkRel);
    ok(t + ' md link (mailto) stripped to text', r.mdLinkMail === 'email me', r.mdLinkMail);
    ok(t + ' md link (mailto) no raw markup', !/\]\(/.test(r.mdLinkMail) && !r.mdLinkMail.includes('mailto:'), r.mdLinkMail);
    ok(t + ' fenced code not linkified', !/<a class="xlink"/.test(r.fenceNoLink), r.fenceNoLink);
    ok(t + ' heading html inert', /<span class="mdh">&lt;b&gt;hi&lt;\/b&gt;<\/span>/.test(r.headingHtml), r.headingHtml);
    ok(t + ' bare url autolink kept', /<a class="xlink" href="https:\/\/x\.test\/p"/.test(r.url), r.url);
    ok(t + ' emoji passes', /\u{1F680}/u.test(r.emoji), r.emoji);
    // E1: code adjacent to a URL — the code tag must never land inside an href,
    // the code still renders, and any anchor present is well-formed.
    ok(t + ' E1 no code tag in href', !/href="[^"]*<code/.test(r.urlCode), r.urlCode);
    ok(t + ' E1 code still rendered', /<code class="mdc">a<\/code>/.test(r.urlCode), r.urlCode);
    ok(t + ' E1 anchor (if any) well-formed', !/<a\b/.test(r.urlCode) || anchorsSafe(r.urlCode), r.urlCode);
    // E2: underscore URL linked whole, never italicised.
    ok(t + ' E2 underscore url linked whole', /href="https:\/\/x\.test\/_a_"/.test(r.urlUnderscore), r.urlUnderscore);
    ok(t + ' E2 no <em> in url', anchorsSafe(r.urlUnderscore) && !/<em>/.test(r.urlUnderscore), r.urlUnderscore);
    // E3: bold ending in a URL — bold applied, url linked, no ** leak.
    ok(t + ' E3 bold applied', /<strong>/.test(r.boldUrl), r.boldUrl);
    ok(t + ' E3 url linked', /href="https:\/\/x\.test"/.test(r.boldUrl), r.boldUrl);
    ok(t + ' E3 no ** leak', !r.boldUrl.includes('**'), r.boldUrl);
    ok(t + ' E3 anchor well-formed', anchorsSafe(r.boldUrl), r.boldUrl);

    /* CONTROL: prove pjRich can actually MANGLE if it were wrong, i.e. the plain
       arm is a real equality and not both sides being the same broken thing. A
       message with markdown must DIFFER from esc(). */
    const differs = await page.evaluate(() => pjRich('a **b**') !== esc('a **b**'));
    ok(t + ' markdown output differs from esc (control)', differs);

    /* ---- Layer 2: paint the real talk thread and read the DOM + CSS. ---- */
    // Arm the fixture and view state, then AWAIT the async paint (paintTalk
    // fetches the thread), then read the DOM in a separate call -- reading in
    // the same synchronous evaluate would run before the fetch->paint resolves.
    await page.evaluate(() => {
      CURRENT = { sessionName: 'april', name: 'April' };
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      window.__fx = {
        messages: [{
          from: 'april',
          at: new Date().toISOString(),
          text: '## Status\n\nDone **three** things:\n- fixed the `bug`\n- shipped it \u{1F680}\n\n> next: review\n\n<script>alert(1)</script>\n\nsee https://kosmos.test/pr/42',
        }],
        olderCount: 0, historyBecause: null, historyUnfilable: false,
        presence: 'on', presenceBecause: null, asking: false,
        question: null, questionBecause: null, options: null,
      };
    });
    await page.evaluate(() => paintTalk('april', 'April'));
    const dom = await page.evaluate(() => {
      const b = document.querySelector('#d-dmthread .dm-b');
      const mdh = b && b.querySelector('.mdh');
      const mdc = b && b.querySelector('.mdc');
      const csH = mdh ? getComputedStyle(mdh) : null;
      const csC = mdc ? getComputedStyle(mdc) : null;
      return {
        html: b ? b.innerHTML : null,
        hasStrong: !!(b && b.querySelector('strong')),
        hasHeading: !!mdh,
        hasLi: !!(b && b.querySelector('.mdli')),
        hasCode: !!mdc,
        hasQuote: !!(b && b.querySelector('.mdq')),
        hasLink: !!(b && b.querySelector('a.xlink')),
        scriptEl: !!(b && b.querySelector('script')),
        rawScriptText: b ? b.innerHTML.includes('<script>alert(1)</script>') : false,
        headingWeight: csH ? csH.fontWeight : null,
        codeBg: csC ? csC.backgroundColor : null,
        emoji: b ? b.textContent.includes('\u{1F680}') : false,
      };
    });
    ok(t + ' DOM: bubble exists', dom.html !== null);
    ok(t + ' DOM: bold rendered', dom.hasStrong, dom.html);
    ok(t + ' DOM: heading rendered', dom.hasHeading);
    ok(t + ' DOM: list rendered', dom.hasLi);
    ok(t + ' DOM: inline code rendered', dom.hasCode);
    ok(t + ' DOM: quote rendered', dom.hasQuote);
    ok(t + ' DOM: url autolinked', dom.hasLink);
    ok(t + ' DOM: emoji shown', dom.emoji);
    // dangerous-answer, at the DOM level: the injected script is neither an
    // element nor present as a raw tag string in the bubble.
    ok(t + ' DOM: no <script> element', !dom.scriptEl, 'a script element reached the bubble');
    ok(t + ' DOM: no raw script tag string', !dom.rawScriptText, dom.html);
    // CSS wired: the heading is bold, the code has a ground.
    ok(t + ' CSS: heading is bold', dom.headingWeight === '700' || Number(dom.headingWeight) >= 700, dom.headingWeight);
    ok(t + ' CSS: code has a background', dom.codeBg && dom.codeBg !== 'rgba(0, 0, 0, 0)' && dom.codeBg !== 'transparent', dom.codeBg);

    await page.close();
  }

  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
