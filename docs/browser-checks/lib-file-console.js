'use strict';
/* kosmos#9161: the console lines a browser check that opens web/index.html as file:// may ignore, in one place.
 * With no board, the page's start-up fetches to /api/... are refused and logged as console errors. A headed run (full
 * Chrome) words that refusal as
 *   Access to fetch at 'file:///api/settings' from origin 'null' has been blocked by CORS policy: ...
 * which the headless shell does not. The CORS arm needs both a file:/// URL and the null origin. The first three arms
 * are carried over unchanged from the copies this replaces, and are as broad as they were.
 * browser-checks-file-console-9161.test.js pins what it ignores and what it must not.
 */
const FILE_PAGE_NOISE = new RegExp([
  'ERR_FILE_NOT_FOUND',
  'URL scheme "file"',
  'Failed to (fetch|load)',
  "Access to fetch at 'file:///[^']*' from origin 'null' has been blocked by CORS policy",
].join('|'));

function isFilePageNoise(text) {
  return FILE_PAGE_NOISE.test(String(text == null ? '' : text));
}

module.exports = { FILE_PAGE_NOISE, isFilePageNoise };
