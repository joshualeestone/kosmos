'use strict';
/**
 * #4632: the roles and teams catalogue is downloaded, not shipped, so a test that needs it stores
 * this fixture the way a download would: signed (with a key pair made for this process and handed
 * to engine/catalogue.js through useKeyForTest) into the sandboxed data root.
 *
 * The catalogue is test-support/catalogue-published/catalogue.json, the file joshualeestone/
 * kosmos-catalogue published (refresh it and its .sig from Pages together when a test needs newer
 * roles or teams). It is re-signed here with a test key, so its own signature is not used.
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

// One copy of the catalogue: the published file the browser harness also serves (with its own
// signature there); tests re-sign it with their own key and set their own serial.
const FIXTURE = path.join(__dirname, 'catalogue-published', 'catalogue.json');   // serial 1790733661 as published

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
  const key = storeSigned(fs.readFileSync(FIXTURE, 'utf8'), require('../engine/catalogue').MIN_SERIAL);
  require('../engine/roles').remerge();
  return key;
}

/**
 * For a test file that reads every role: sandbox the data roots (before any engine module loads,
 * since store resolves its root at require time) and store the fixture, so the file sees the same
 * 104 roles a board holding the catalogue sees, and never the operator's own stored copy.
 * Call it at the top of the file, before requiring anything from engine/.
 * @returns {string} the sandbox folder (removed when the process exits)
 */
function sandboxWithCatalogue(label) {
  const os = require('node:os');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `${label || 'roles'}-catalogue-`));
  process.env.AGENT_WORKFORCE_WORKERS = path.join(sandbox, 'workers');
  process.env.AGENT_WORKFORCE_LAUNCH = path.join(sandbox, 'LaunchAgents');
  process.env.AGENT_WORKFORCE_HOME = path.join(sandbox, 'home');
  process.env.AGENT_WORKFORCE_DATA = path.join(sandbox, 'support');
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(sandbox, 'claude.json');
  process.on('exit', () => { try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ } });
  install(sandbox);
  return sandbox;
}

module.exports = { FIXTURE, install, storeSigned, sandboxWithCatalogue };
