'use strict';
/**
 * The address the board's sign-in answers with (bootstrap's location, from pathWithoutParam) is always a path on this
 * board: a request whose path normalises to start with more than one slash, or with a backslash, is answered with a
 * single leading slash, so a browser reads it as a path, never as another host.
 *
 *   node --test engine.boardauth-bootpath.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const boardauth = require('./engine/boardauth');

const BASE = 'http://localhost';
const nav = (url) => ({ url, headers: {} });
// A single leading slash, and nothing a browser would read as a host after it.
const sameOrigin = (loc) => typeof loc === 'string' && loc.startsWith('/') && !/^[/\\]{2}/.test(loc);

test('CONTROL: the input below really normalises to a path with two leading slashes', () => {
  assert.strictEqual(new URL('/a/..//x.test/y?boot=N', BASE).pathname, '//x.test/y', 'the case is real, so the next test can fail');
});

test('a path that normalises to two leading slashes is answered as a path on this board', () => {
  for (const [url, param] of [['/a/..//x.test/y?boot=N', 'boot'], ['/a/..//x.test/y?token=T', 'token'], ['/a/..///x.test/y?token=T&tab=a', 'token']]) {
    const loc = boardauth.pathWithoutParam(nav(url), BASE, param);
    assert.ok(sameOrigin(loc), url + ' -> ' + loc);
    assert.strictEqual(loc.split('?')[0], '/x.test/y', url + ' keeps the rest of the path: ' + loc);
  }
  assert.strictEqual(boardauth.pathWithoutParam(nav('/a/..///x.test/y?token=T&tab=a'), BASE, 'token'), '/x.test/y?tab=a', 'other params are kept');
});

test('a backslash at the start is treated the same', () => {
  for (const url of ['/\\x.test/y?token=T', '/a/..\\\\x.test/y?token=T']) {
    const loc = boardauth.pathWithoutToken(nav(url), BASE);
    assert.ok(sameOrigin(loc), url + ' -> ' + loc);
  }
});

test('bootstrap answers the same path: a valid token on that input signs in and stays on this board', () => {
  const b = boardauth.bootstrap({ token: 'T', req: nav('/a/..//x.test/y?token=T'), routingBase: BASE, method: 'GET' });
  assert.ok(b, 'fixture: a valid token on a nav bootstraps');
  assert.ok(sameOrigin(b.location), b.location);
});

test('CONTROL: ordinary paths are unchanged', () => {
  assert.strictEqual(boardauth.pathWithoutToken(nav('/?first-run=1&token=T'), BASE), '/?first-run=1');
  assert.strictEqual(boardauth.pathWithoutToken(nav('/tab/a?token=T'), BASE), '/tab/a');
  assert.strictEqual(boardauth.pathWithoutParam(nav('/?boot=N'), BASE, 'boot'), '/');
});
