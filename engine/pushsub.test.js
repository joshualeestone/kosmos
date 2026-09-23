'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pushsub = require('./pushsub');

test('pushsub -- store and retrieve subscriptions', async (t) => {
  // Clear any prior state
  pushsub.clearAllSubscriptions();

  // Store a subscription
  const result = pushsub.storeSubscription(
    'account1',
    'device1',
    'https://fcm.googleapis.com/fcm/send/xyz123',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg'
  );
  assert.strictEqual(result.ok, true);

  // Retrieve subscriptions for the account
  const subs = pushsub.getSubscriptionsForAccount('account1');
  assert.strictEqual(subs.length, 1);
  assert.strictEqual(subs[0].endpoint, 'https://fcm.googleapis.com/fcm/send/xyz123');
  assert.strictEqual(subs[0].deviceId, 'device1');
});

test('pushsub -- upsert: update existing subscription', async (t) => {
  pushsub.clearAllSubscriptions();

  // Store initial subscription
  pushsub.storeSubscription(
    'account2',
    'device1',
    'https://push.example.com/123',
    'key1_111111111111111111111111111111111111111111111111',
    'auth1_1111111111111111111111'
  );

  // Store updated subscription for the same endpoint
  pushsub.storeSubscription(
    'account2',
    'device1',
    'https://push.example.com/123',
    'key2_222222222222222222222222222222222222222222222222',
    'auth2_2222222222222222222222'
  );

  // Should have only one subscription (the updated one)
  const subs = pushsub.getSubscriptionsForAccount('account2');
  assert.strictEqual(subs.length, 1);
  assert.strictEqual(subs[0].p256dh, 'key2_222222222222222222222222222222222222222222222222');
});

test('pushsub -- remove subscription', async (t) => {
  pushsub.clearAllSubscriptions();

  const endpoint = 'https://push.example.com/456';
  pushsub.storeSubscription('account3', 'device1', endpoint, 'key3_333333333333333333333333333333333333333333333333', 'auth3_3333333333333333333333');

  // Remove it
  const result = pushsub.removeSubscription('account3', endpoint);
  assert.strictEqual(result.ok, true);

  // Verify it's gone
  const subs = pushsub.getSubscriptionsForAccount('account3');
  assert.strictEqual(subs.length, 0);
});

test('pushsub -- validate endpoint must be https', async (t) => {
  pushsub.clearAllSubscriptions();

  assert.throws(
    () => pushsub.storeSubscription(
      'account4',
      'device1',
      'http://insecure.example.com/push',  // http, not https
      'key4_444444444444444444444444444444444444444444444444',
      'auth4_4444444444444444444444'
    ),
    /endpoint must be a valid https URL/
  );
});

test('pushsub -- validate key sizes', async (t) => {
  pushsub.clearAllSubscriptions();

  // p256dh too short
  assert.throws(
    () => pushsub.storeSubscription(
      'account5',
      'device1',
      'https://push.example.com/789',
      'short',  // too short
      'auth5_5555555555555555555555'
    ),
    /p256dh key out of bounds/
  );

  // auth too short
  assert.throws(
    () => pushsub.storeSubscription(
      'account5',
      'device1',
      'https://push.example.com/789',
      'key5_555555555555555555555555555555555555555555555555',
      'short'  // too short
    ),
    /auth key out of bounds/
  );
});

test('pushsub -- empty account returns empty array', async (t) => {
  pushsub.clearAllSubscriptions();

  const subs = pushsub.getSubscriptionsForAccount('nonexistent-account');
  assert.strictEqual(Array.isArray(subs), true);
  assert.strictEqual(subs.length, 0);
});
