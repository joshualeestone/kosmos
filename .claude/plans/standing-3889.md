# standing-3889

kosmos#3889: a Mac set up through Settings never cached its Kosmos+ standing (setupComplete read result.data, which
setupRun never sets). Fix: refreshStandingIfStale({ ttlMs: 0 }) after a successful setup, not awaited.
