'use strict';

/**
 * Web Push subscription storage and routing.
 *
 * Stores browser PushSubscriptions (endpoint + encryption keys) per account.
 * Routes coordinator requests through to subscription storage and retrieval.
 * Coordinator handles VAPID encryption, JWT signing, and push service delivery.
 */

const path = require('node:path');
const fs = require('node:fs');
const store = require('./store');

// Subscriptions are stored per account in a JSON file: { account_id: [{ endpoint, keys }] }
function subscriptionsPath() {
  return path.join(store.ROOT, 'push-subscriptions.json');
}

// Load subscriptions from disk, defaulting to empty object.
function loadSubscriptions() {
  const filePath = subscriptionsPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data) || {};
  } catch (e) {
    // Corrupted or malformed file; start fresh.
    return {};
  }
}

// Write subscriptions to disk atomically.
function saveSubscriptions(subscriptions) {
  const filePath = subscriptionsPath();
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(subscriptions, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    throw new Error(`failed to save push subscriptions: ${e.message}`);
  }
}

// Store or update a subscription for an account.
// Called by coordinator's /v1/push/subscribe route (already authenticated).
function storeSubscription(accountId, deviceId, endpoint, p256dh, auth) {
  if (!accountId || !deviceId || !endpoint || !p256dh || !auth) {
    throw new Error('missing required subscription fields');
  }
  // Validate endpoint is an https URL.
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1024) {
    throw new Error('endpoint must be a valid https URL under 1024 bytes');
  }
  // Validate key sizes are reasonable.
  if (typeof p256dh !== 'string' || p256dh.length < 50 || p256dh.length > 256) {
    throw new Error('p256dh key out of bounds');
  }
  if (typeof auth !== 'string' || auth.length < 10 || auth.length > 64) {
    throw new Error('auth key out of bounds');
  }

  const subs = loadSubscriptions();
  if (!subs[accountId]) {
    subs[accountId] = [];
  }

  // Remove any existing subscription for this endpoint (upsert pattern).
  subs[accountId] = subs[accountId].filter((s) => s.endpoint !== endpoint);

  // Add the new subscription.
  subs[accountId].push({
    endpoint,
    deviceId,
    p256dh,
    auth,
    storedAt: new Date().toISOString(),
  });

  saveSubscriptions(subs);
  return { ok: true };
}

// Remove a subscription for an account.
// Called by coordinator's /v1/push/unsubscribe route.
function removeSubscription(accountId, endpoint) {
  if (!accountId || !endpoint) {
    throw new Error('missing account or endpoint');
  }

  const subs = loadSubscriptions();
  if (!subs[accountId]) {
    return { ok: true }; // Already absent.
  }

  const before = subs[accountId].length;
  subs[accountId] = subs[accountId].filter((s) => s.endpoint !== endpoint);

  if (subs[accountId].length < before) {
    saveSubscriptions(subs);
  }

  return { ok: true };
}

// Retrieve all subscriptions for an account (for event fan-out).
function getSubscriptionsForAccount(accountId) {
  if (!accountId) {
    return [];
  }

  const subs = loadSubscriptions();
  return subs[accountId] || [];
}

// Clear all subscriptions (used in tests).
function clearAllSubscriptions() {
  const filePath = subscriptionsPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  storeSubscription,
  removeSubscription,
  getSubscriptionsForAccount,
  clearAllSubscriptions,
};
