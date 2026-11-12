'use strict';
/**
 * kosmos#8423: the install's in-flight marker (#1728, logs/install.started) and its status file were written under the
 * installed root without checking the root is absolute. A test that sets a root in another platform's form
 * (C:\Users\someone\Kosmos on a Mac) is relative here, so the marker landed in the working directory: the repo, where a
 * dirty main stops a release cut. Now both are written only under an absolute root, as #8421's record already is.
 * The installer is an injected child-shaped runner and the root a throwaway folder: nothing here installs anything.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const update = require('./update');

function setUp(root) {
  const children = [];
  update.resetCache();
  update.setPlatform('darwin');
  update.setInstalledRoot(() => root);
  update.setInstallRunner(() => { const c = new EventEmitter(); c.unref = () => {}; children.push(c); return c; });
  return children;
}
function clear() { update.setInstalledRoot(null); update.setInstallRunner(null); update.setPlatform(null); update.resetCache(); }
const walk = (d) => fs.readdirSync(d).flatMap((n) => { const q = path.join(d, n); return fs.statSync(q).isDirectory() ? walk(q) : [q]; });

test('kosmos#8423: a person\'s install under a root that is not absolute writes nothing in the working directory', () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'absroot-cwd-'));
  const cwd = process.cwd();
  let children = [];
  try {
    children = setUp('C:\\Users\\someone\\Kosmos');
    process.chdir(box);
    update.beginInstall({});
    assert.equal(children.length, 1, 'CONTROL: the install did not launch, so this shows nothing');
    assert.deepEqual(walk(box), [], 'a file was written relative to the working directory');
    assert.equal(update.installStartedFile(), null);
    assert.equal(update.installStatusFile(), null, 'the status file would be written under a relative root');
  } finally { process.chdir(cwd); clear(); fs.rmSync(box, { recursive: true, force: true }); }
});

test('kosmos#8423 CONTROL: under an absolute root the marker is still written where it belongs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'absroot-root-'));
  let children = [];
  try {
    children = setUp(root);
    assert.equal(update.installStatusFile(), path.join(root, 'logs', 'install.status'));
    update.beginInstall({});
    assert.equal(children.length, 1);
    assert.ok(fs.existsSync(path.join(root, 'logs', 'install.started')), 'the in-flight marker was not written under an absolute root');
  } finally { clear(); fs.rmSync(root, { recursive: true, force: true }); }
});
