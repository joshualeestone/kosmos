'use strict';
/**
 * #4632: the roles and teams catalogue is downloaded, not shipped, so a test that needs it stores
 * this fixture the way a download would: signed (with a key pair made for this process and handed
 * to engine/catalogue.js through useKeyForTest) into the sandboxed data root.
 *
 * catalogue-fixture.json is a build of joshualeestone/kosmos-catalogue (`node build.js`, its
 * dist/catalogue.json); refresh it from there when a test needs newer roles or teams.
 *
 *   const fixture = require('../test-support/catalogue-fixture');
 *   fixture.install(SANDBOX);   // after AGENT_WORKFORCE_DATA points into SANDBOX
 *
 * install() refuses unless the data root is inside the sandbox the test made, so it can never
 * write into the operator's real Kosmos folder.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = path.join(__dirname, 'catalogue-fixture.json');

/** Sign `text` with a fresh key pair and store it as the catalogue; returns the private key so a
 *  test can sign variants of its own. */
function storeSigned(text, serial) {
  const catalogue = require('../engine/catalogue');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  catalogue.useKeyForTest(publicKey.export({ type: 'spki', format: 'pem' }));
  const body = serial === undefined ? text : text.replace(/"serial": \d+/, `"serial": ${serial}`);
  const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('base64');
  const file = catalogue.cacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sig, text: body }));
  return privateKey;
}

/**
 * Store the fixture as the board's catalogue and merge its roles into ROLES.
 * @param {string} sandbox the folder the test made and pointed AGENT_WORKFORCE_DATA into
 * @returns {crypto.KeyObject} the private key the fixture was signed with
 */
function install(sandbox) {
  const store = require('../engine/store');
  require('./data-root-sandbox').assertSandboxedDataRoot(sandbox, [store.ROOT]);
  const key = storeSigned(fs.readFileSync(FIXTURE, 'utf8'), 1);
  require('../engine/roles').remerge();
  return key;
}

module.exports = { FIXTURE, install, storeSigned };
