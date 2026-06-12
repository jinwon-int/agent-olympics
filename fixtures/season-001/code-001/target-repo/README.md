# agent-codebench — gateway delivery report pipeline

Small TypeScript pipeline that turns raw gateway delivery samples into the
nightly per-node report.

```sh
npm install
npm test            # build + unit tests
npm run report      # render the nightly report from data/samples.json
```

- `src/types.ts` — sample and summary types
- `src/report.ts` — parse / summarize / render
- `src/index.ts` — CLI entrypoint for the nightly job
- `test/report.test.ts` — unit tests (node:test)
- `data/samples.json` — latest nightly sample drop from the probe workers

## Open incident: nightly report job crashing

Since the **v0.3.0 report pipeline refactor** the nightly job intermittently
crashes:

```
TypeError: Cannot read properties of undefined (reading 'retries')
    at summarize (dist/src/report.js:...)
```

Ops note: the crash started appearing on nights when a gateway node was
registered shortly before the report ran. The probe worker only attaches
measurements after a node's **first measurement cycle completes**; a node that
reports an outcome before that cycle has no measurements yet. The unit tests
pass and `tsc` is clean, so the regression has not been reproduced in the
suite so far. `data/samples.json` is the sample drop from the most recent
crashing night.
