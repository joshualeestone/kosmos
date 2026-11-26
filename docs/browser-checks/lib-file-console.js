'use strict';
/* kosmos#9161: the console lines a browser check that opens web/index.html as file:// may ignore, in ONE place.
 *
 * Such a check has no board, so the page's own start-up fetches to /api/... cannot load, and Chromium logs each
 * refusal as a console error. Fourteen checks each carried a copy of the pattern that skipped those lines, and the
 * copies knew only the headless shell's words. A headed run (full Chrome) words the same refusal as
 *   Access to fetch at 'file:///api/settings' from origin 'null' has been blocked by CORS policy: ...
 * so every headed hand run of those checks was red (35 to 754 false FAILs each), while the gate, headless, was green.
 *
 * The CORS arm is anchored to a file:/// URL and the null origin, so a CORS refusal of a real http(s) request is still
 * a FAIL. browser-checks-file-console-9161.test.js pins every arm against the exact lines both modes print, and the
 * lines this must NOT ignore.
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
