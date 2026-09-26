# guidecount-3894

kosmos#3894 asked whether the auto-created setup guide should count as a created agent. Measured: it already does,
lazily: createAgent records its birth in created.jsonl and the #3038 beacon sends createdCount() (the log total) on
the person's next checkbox-on create. Decided: keep it (a real agent; the birth log is the source #3038 chose), no
immediate ping (the person made no choice). Change: a comment at the guide's create call saying so.
