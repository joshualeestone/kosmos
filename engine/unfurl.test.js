'use strict';
/**
 * Link previews (#357): the gate, the caps, the parser, the cache.
 *
 * Nothing here touches the network. The fetcher and the resolver are the
 * module's own seams, and the control at the end proves a refusal is a
 * refusal BEFORE any byte moves: the fake fetcher counts its calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const unfurl = require('./unfurl');

function fakeResponse({ status = 200, type = 'text/html; charset=utf-8', body = '', headers = {} } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const h = new Map(Object.entries({ 'content-type': type, ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    body: {
      getReader() {
        let sent = false;
        return {
          read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) })),
          cancel: async () => {},
        };
      },
    },
    arrayBuffer: async () => bytes,
  };
}

function world({ pages = {}, resolve = {} } = {}) {
  const calls = [];
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    const p = pages[url];
    if (!p) throw new Error('no such page in the fixture: ' + url);
    if (typeof p === 'function') return p();
    return fakeResponse(p);
  });
  unfurl.setResolver(async (host) => {
    if (host in resolve) return resolve[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    return [{ address: '93.184.216.34', family: 4 }];   // the public internet, by default
  });
  return calls;
}

test.afterEach(() => unfurl.resetForTests());

test('private and local addresses are refused by number, in every range that matters', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(unfurl.privateAddress(ip), true, ip + ' was allowed');
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(unfurl.privateAddress(ip), false, ip + ' was refused');
  }
  assert.equal(unfurl.privateAddress('not-an-ip'), true, 'something that is not an address must be refused, never guessed');
});

test('the gate refuses by name too: a public-looking host that resolves to a private address never gets fetched', async () => {
  const calls = world({ resolve: { 'evil.example': ['93.184.216.34', '127.0.0.1'] } });
  const got = await unfurl.preview('http://evil.example/');
  assert.equal(got.ok, false);
  assert.match(got.because, /this computer or this network/);
  assert.deepEqual(calls, [], 'the fetcher was called for a refused target');
});

test('the gate refuses the schemes, hosts and shapes it should, all before a fetch', async () => {
  const calls = world();
  for (const [url, why] of [
    ['ftp://example.com/x', /only http and https/],
    ['file:///etc/passwd', /only http and https/],
    ['http://localhost:16180/api/status', /this computer or this network/],
    ['http://board.local/', /this computer or this network/],
    ['http://metadata.internal/', /this computer or this network/],
    ['http://user:pw@example.com/', /sign-in/],
    ['http://[::1]/', /this computer or this network/],
    ['not a url', /not a web address/],
    ['', /not a web address/],
  ]) {
    const got = await unfurl.preview(url);
    assert.equal(got.ok, false, url + ' was allowed');
    assert.match(got.because, why, url + ': ' + got.because);
  }
  assert.deepEqual(calls, [], 'a refused target reached the fetcher: ' + JSON.stringify(calls));
});

test('a redirect is gated like a first request, and too many redirects is a refusal', async () => {
  const calls = world({
    pages: {
      'https://a.example/': { status: 302, headers: { location: 'http://127.0.0.1:16180/api/status' } },
      'https://b.example/': { status: 301, headers: { location: '/1' } },
      'https://b.example/1': { status: 301, headers: { location: '/2' } },
      'https://b.example/2': { status: 301, headers: { location: '/3' } },
      'https://b.example/3': { status: 301, headers: { location: '/4' } },
      'https://b.example/4': { body: '<title>never</title>' },
    },
  });
  const hop = await unfurl.preview('https://a.example/');
  assert.equal(hop.ok, false);
  assert.match(hop.because, /this computer or this network/);
  assert.deepEqual(calls, ['https://a.example/'], 'the redirect target was fetched');
  const loop = await unfurl.preview('https://b.example/');
  assert.equal(loop.ok, false);
  assert.match(loop.because, /too many times/);
  assert.ok(!calls.includes('https://b.example/4'), 'the fourth redirect was followed');
});

test('the tags are read: og first, twitter and <title> as fallbacks, entities decoded, relative image resolved, the bare URL kept', async () => {
  world({
    pages: {
      'https://site.example/post': {
        body: `<html><head>
          <title>Fallback &amp; Title</title>
          <meta property="og:title" content="The Real &quot;Title&quot;">
          <meta name="description" content="plain description">
          <meta property="og:description" content="og description">
          <meta property="og:image" content="/img/card.png">
          <meta property="og:site_name" content="Site">
        </head><body>hello</body></html>`,
      },
      'https://twitter-only.example/': { body: '<head><title>T &lt;x&gt;</title><meta name="twitter:image" content="https://cdn.example/t.jpg"></head>' },
    },
  });
  const got = await unfurl.preview('https://site.example/post');
  assert.equal(got.ok, true);
  assert.equal(got.title, 'The Real "Title"');
  assert.equal(got.description, 'og description');
  assert.equal(got.image, 'https://site.example/img/card.png', 'the relative image was not resolved against the page');
  assert.equal(got.site, 'Site');
  assert.equal(got.url, 'https://site.example/post');
  const fb = await unfurl.preview('https://twitter-only.example/');
  assert.equal(fb.title, 'T <x>');
  assert.equal(fb.image, 'https://cdn.example/t.jpg');
});

test('a page with no tags is "nothing to show", a non-page is refused, and neither throws', async () => {
  world({
    pages: {
      'https://bare.example/': { body: '<html><body>no head to speak of</body></html>' },
      'https://pdf.example/x.pdf': { type: 'application/pdf', body: '%PDF' },
      'https://down.example/': { status: 503, body: '' },
      'https://boom.example/': () => { throw new Error('ECONNRESET'); },
    },
  });
  assert.deepEqual(await unfurl.preview('https://bare.example/'), { ok: false, because: 'nothing to show' });
  assert.match((await unfurl.preview('https://pdf.example/x.pdf')).because, /not a page/);
  assert.match((await unfurl.preview('https://down.example/')).because, /answered 503/);
  assert.match((await unfurl.preview('https://boom.example/')).because, /could not be reached/);
});

test('the page read stops at the cap rather than reading a site dry, and the head it did read still yields the tags', async () => {
  const head = '<head><meta property="og:title" content="Big"></head>';
  const big = head + 'x'.repeat(unfurl.PAGE_MAX * 2);
  world({ pages: { 'https://big.example/': { body: big } } });
  const got = await unfurl.preview('https://big.example/');
  /* A media-heavy page is past the cap; its tags are in the first bytes.
     Keeping the head is the difference between a preview and none for most
     real pages, and the cap still bounds what is read. */
  assert.equal(got.ok, true, JSON.stringify(got));
  assert.equal(got.title, 'Big');
});

test('the v6 forms that carry a private v4 inside are refused: NAT64, 6to4, IPv4-compatible, site-local', () => {
  for (const ip of ['64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '2002:7f00:1::', '2002:c0a8:101::', '::7f00:1', 'fec0::1', '::ffff:a00:1']) {
    assert.equal(unfurl.privateAddress(ip), true, ip + ' was allowed');
  }
  for (const ip of ['64:ff9b::808:808', '2002:808:808::', '::ffff:808:808']) {
    assert.equal(unfurl.privateAddress(ip), false, ip + ' was refused though it carries a public address');
  }
});

test('the parser survives an apostrophe inside double quotes, single-quoted attributes, and ignores tags inside comments and scripts', async () => {
  world({
    pages: {
      'https://q.example/': {
        body: `<head><!-- <meta property="og:title" content="commented out"> -->
          <script>var s = '<meta property="og:title" content="scripted">';</script>
          <meta property='og:title' content="Josh's page, here">
          <meta name='description' content='single "quoted" description'></head>`,
      },
    },
  });
  const got = await unfurl.preview('https://q.example/');
  assert.equal(got.title, "Josh's page, here");
  assert.equal(got.description, 'single "quoted" description');
});

test('an SVG is refused by the image proxy even when the site calls it an image', async () => {
  world({ pages: { 'https://cdn.example/x.svg': { type: 'image/svg+xml', body: '<svg onload="alert(1)"/>' } } });
  const got = await unfurl.image('https://cdn.example/x.svg');
  assert.equal(got.ok, false);
  assert.match(got.because, /not an image this board will show/);
});

test('a refusal is remembered for a minute, an answer for ten', async () => {
  const calls = world({ pages: { 'https://blip.example/': () => { throw new Error('ECONNRESET'); } } });
  await unfurl.preview('https://blip.example/');
  assert.equal(unfurl.peek('https://blip.example/').ok, false);
  assert.equal(calls.length, 1);
});


test('the image proxy serves only image types, caps the size, and refuses the same targets', async () => {
  const calls = world({
    pages: {
      'https://cdn.example/a.png': { type: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      'https://cdn.example/page': { type: 'text/html', body: '<title>not an image</title>' },
      'https://cdn.example/huge.jpg': { type: 'image/jpeg', body: Buffer.alloc(unfurl.IMAGE_MAX + 1) },
    },
  });
  const ok = await unfurl.image('https://cdn.example/a.png');
  assert.equal(ok.ok, true);
  assert.equal(ok.type, 'image/png');
  assert.equal(ok.bytes.length, 4);
  assert.match((await unfurl.image('https://cdn.example/page')).because, /not an image/, 'a page came back through the image proxy');
  assert.match((await unfurl.image('https://cdn.example/huge.jpg')).because, /too large/);
  const before = calls.length;
  assert.match((await unfurl.image('http://10.0.0.5/x.png')).because, /this computer or this network/);
  assert.equal(calls.length, before, 'a private image target was fetched');
});

test('answers are cached, refusals included, so a room repainting every five seconds fetches once', async () => {
  const calls = world({ pages: { 'https://once.example/': { body: '<title>Once</title>' }, 'https://nope.example/': { status: 404, body: '' } } });
  await unfurl.preview('https://once.example/');
  await unfurl.preview('https://once.example/');
  await unfurl.preview('https://nope.example/');
  await unfurl.preview('https://nope.example/');
  assert.deepEqual(calls, ['https://once.example/', 'https://nope.example/']);
});

test('CONTROL: the fake fetcher is what answers, so a green above is about this code and not the internet', async () => {
  const calls = world({ pages: { 'https://ctl.example/': { body: '<title>ctl</title>' } } });
  const got = await unfurl.preview('https://ctl.example/');
  assert.equal(got.title, 'ctl');
  assert.deepEqual(calls, ['https://ctl.example/']);
});

test('firstLink finds the first http(s) link and drops trailing punctuation; peek and warm read and fill the cache without blocking', async () => {
  assert.equal(unfurl.firstLink('see https://a.example/x, then https://b.example'), 'https://a.example/x');
  assert.equal(unfurl.firstLink('no link here'), null);
  assert.equal(unfurl.firstLink('(https://c.example/p).'), 'https://c.example/p');
  assert.equal(unfurl.firstLink('ftp://not.example'), null);
  const calls = world({ pages: { 'https://warm.example/': { body: '<title>Warm</title>' } } });
  assert.equal(unfurl.peek('https://warm.example/'), null, 'a never-asked link reads as cached');
  unfurl.warm('https://warm.example/');
  unfurl.warm('https://warm.example/');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1, 'two warms in flight fetched twice');
  const hit = unfurl.peek('https://warm.example/');
  assert.equal(hit && hit.title, 'Warm');
  assert.ok(hit.fetchedAt && !Number.isNaN(Date.parse(hit.fetchedAt)), 'no fetchedAt on the preview');
});
