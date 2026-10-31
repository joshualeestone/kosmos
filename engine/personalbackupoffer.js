'use strict';
/**
 * kosmos#7404 (backupscreens-7404): whether this board offers personal backup on its Settings page, and at what price.
 *
 *   shown: KOSMOS_PERSONAL_BACKUP=1 in the board's environment, the same word that turns it on at the coordinator, so
 *          one switch names both. Off by default: no panel and no routes (server.js answers them 404).
 *   price: KOSMOS_PERSONAL_BACKUP_PRICE when it is in the shape Stripe prices come in ("$5/month", engine/remote.js
 *          PRICE_SHAPE); anything else, or unset, is null. Never a made-up figure.
 *
 * The price is Josh's decision (#7404). This reader is a placeholder until it is set; when it is, the price should come
 * from the coordinator's own answer, as address prices do, and this is what gets replaced.
 */
const { PRICE_SHAPE } = require('./remote');

function offer(env = process.env) {
  const shown = String((env && env.KOSMOS_PERSONAL_BACKUP) || '').trim() === '1';
  const said = String((env && env.KOSMOS_PERSONAL_BACKUP_PRICE) || '').trim();
  return { shown, price: shown && PRICE_SHAPE.test(said) ? said : null };
}

module.exports = { offer };
