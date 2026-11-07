'use strict';
/**
 * kosmos#8165 review 7: the view of a room that the quote tag and the person's claim line read while posts are being
 * delivered (withPending): the record's rows earlier than the post, plus this room's earlier pending posts that the
 * room will show, the m-rows in id order in their own slots, whether or not anything is pending.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const messages = require('./messages');

const P = 'proj-view-8165';
const post = (id, extra) => Object.assign({ kind: 'post', id, project: P, from: 'x', text: 't ' + id, at: '2026-11-07T00:00:00.000Z' }, extra || {});
const view = (rows, own) => messages._withPendingForTests(rows, P, own).map((r) => r.id || r.kind);

test.afterEach(() => messages.resetForTests());

test('kosmos#8165 r7: the m-rows are in id order in their own slots, with nothing pending too', () => {
  const valve = { kind: 'valve', project: P };
  assert.deepEqual(view([post('m5'), valve, post('m3'), post('m4')]), ['m3', 'valve', 'm4', 'm5']);
  assert.deepEqual(view([post('m11'), post('m10')]), ['m10', 'm11'], 'recorded out of order, nothing pending: still id order');
});

test('kosmos#8165 r7: only rows earlier than the post being written, recorded or pending', () => {
  messages._setPendingForTests('m12', { projectId: P, at: Date.now(), row: post('m12', { pending: true }) });
  messages._setPendingForTests('m9', { projectId: P, at: Date.now(), row: post('m9', { pending: true }) });
  assert.deepEqual(view([post('m8'), post('m11'), post('m14')], 'm12'), ['m8', 'm9', 'm11']);
});

test('kosmos#8165 r7: a pending post the record could not take is not in the view; another room\'s never is', () => {
  messages._setPendingForTests('m20', { projectId: P, at: Date.now(), unrecorded: true, row: post('m20', { pending: true }) });
  messages._setPendingForTests('m21', { projectId: 'other', at: Date.now(), row: Object.assign(post('m21', { pending: true }), { project: 'other' }) });
  messages._setPendingForTests('m22', { projectId: P, at: Date.now(), row: post('m22', { pending: true }) });
  assert.deepEqual(view([post('m19')]), ['m19', 'm22']);
});

test('kosmos#8165 r7: a pending post older than the hour is not in the view', () => {
  messages._setPendingForTests('m30', { projectId: P, at: Date.now() - 61 * 60 * 1000, row: post('m30', { pending: true }) });
  assert.deepEqual(view([post('m29')]), ['m29']);
});
