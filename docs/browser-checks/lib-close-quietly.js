'use strict';
/* #6022: close a check's browser without crashing on a route handler still in flight.
   A page polls /api/status on a timer, so when a check closes its browser a poll can be mid-route: the handler's
   route.fetch() then rejects with "Request context disposed", unhandled, and Node exits 1 AFTER every assertion passed.
   That aborted the 0.7.42 cut (#5921) and the first 0.7.44 cut (render-rename-say). unrouteAll with ignoreErrors stops
   waiting for those handlers and swallows what they throw later, so this unroutes every open page of every context
   first, then closes. Assertions are untouched: by the time a check closes, it has already said what it found. */
async function closeQuietly(browser) {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  }
  await browser.close();
}

module.exports = { closeQuietly };
