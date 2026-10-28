'use strict';
/**
 * kosmos#7490: the board page, compressed for a browser that says it accepts it.
 *
 * The page is one file of about 6 MB. On this computer's own screen that costs nothing, but over Kosmos+ it
 * crosses the tunnel and the relay to a phone, and uncompressed it was most of a minute there (#7489). The
 * relay cannot compress it: the tunnel ends TLS on this computer, so the relay only ever carries encrypted
 * bytes. So the board does it, here.
 *
 * Only the PAGE. API answers stay uncompressed on purpose: several put text a caller controls beside a
 * secret (a token, a ticket), which is the BREACH pattern under compression. The relay keeps the same rule
 * for its own routes (kosmos-relay coordinator/src/lib.rs, #4105).
 *
 * The page is read and stamped per request (server.js, #271: so an update arrives), so the compressed bytes
 * are cached against the exact bytes they came from: a changed page is compressed again, an unchanged one
 * never is. Brotli quality 9 takes about a quarter of a second on the page once (1.5 MB from 5.8 MB); 11
 * saves another 130 KB for 7 seconds of CPU, which is not worth it on a person's computer.
 */
const zlib = require('node:zlib');

const BROTLI_QUALITY = 9;
const GZIP_LEVEL = 6;

/** The encoding to send for an Accept-Encoding header: 'br', 'gzip', or null (send it as it is).
    Brotli is preferred when both are accepted; a q=0 entry refuses that encoding, `*` stands for any
    encoding not named. */
function pickEncoding(acceptEncoding) {
  if (typeof acceptEncoding !== 'string' || !acceptEncoding.trim()) return null;
  const q = new Map();
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q.set(name.trim(), Number.isFinite(weight) ? weight : 0);
  }
  const accepts = (enc) => (q.has(enc) ? q.get(enc) > 0 : (q.has('*') && q.get('*') > 0));
  if (accepts('br')) return 'br';
  if (accepts('gzip')) return 'gzip';
  return null;
}

function compress(encoding, buf, done) {
  if (encoding === 'br') {
    zlib.brotliCompress(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }, done);
  } else {
    zlib.gzip(buf, { level: GZIP_LEVEL }, done);
  }
}

/** A one-page cache: the last bytes served and their compressed forms, made on first ask. */
function makePageCompressor() {
  let source = null;
  let forms = new Map();   // encoding -> Promise<Buffer>
  return function compressed(encoding, buf) {
    if (!source || source.length !== buf.length || !source.equals(buf)) {
      source = Buffer.from(buf);
      forms = new Map();
    }
    if (!forms.has(encoding)) {
      const made = new Promise((resolve, reject) => compress(encoding, source, (err, out) => (err ? reject(err) : resolve(out))));
      made.catch(() => { if (forms.get(encoding) === made) forms.delete(encoding); });   // a failure is tried again next time
      forms.set(encoding, made);
    }
    return forms.get(encoding);
  };
}

/** Sends `buf` with `headers`, compressed when the request accepts it. Always says `vary: accept-encoding`,
    so no cache in between hands a compressed page to a browser that did not ask for one. A compression that
    fails sends the page as it is. */
function sendPage(req, res, headers, buf, compressed) {
  const encoding = pickEncoding(req.headers['accept-encoding']);
  const head = req.method === 'HEAD';
  const plain = () => {
    res.writeHead(200, { ...headers, vary: 'accept-encoding', 'content-length': buf.length });
    res.end(head ? undefined : buf);
  };
  if (!encoding) { plain(); return; }
  compressed(encoding, buf).then((out) => {
    res.writeHead(200, { ...headers, vary: 'accept-encoding', 'content-encoding': encoding, 'content-length': out.length });
    res.end(head ? undefined : out);
  }, plain);
}

module.exports = { pickEncoding, makePageCompressor, sendPage, BROTLI_QUALITY, GZIP_LEVEL };
