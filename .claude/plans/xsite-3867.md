# xsite-3867

kosmos#3867: server.xsite-1636.test.js's teardown did not await server.close() and removed SANDBOX at once; under a
loaded full suite rmSync can hit ENOTEMPTY. Await the close, then rmSync with maxRetries 10 / retryDelay 100 (the
server.world-boot-sandbox-2628 idiom).
