# Spike: child-process runtime (Phase 0)

**Measured:** 2026-10-07T08:54:07.561Z  
**Platform:** linux-x64  
**Node:** v24.21.0  
**execPath:** `/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node`

## Results

| Metric | min | p50 | mean | max | unit |
|---|---:|---:|---:|---:|---|
| Cold startup (tsx worker) | 53.37 | 55.55 | 56.49 | 60.75 | ms |
| IPC ping RTT | 0.037 | 0.056 | 0.147 | 1.564 | ms |

- Baseline child RSS (after ping): **64.43 MiB**
- Cooperative cancel observed: **true** (50.92 ms wall) — cooperative cancel via cancelJob while preview sleeping
- RSS/kill recover: **true** (recover startup 53.9 ms; peak/limit context 80 MiB)
- Crash recover: **true** (recover startup 54.97 ms)

## Conclusions

- Child process isolation is viable for Phase 0: host can kill and recover after RSS pressure and abrupt exit.
- IPC newline-JSON ping RTT is low enough for interactive preview control messages.
- Startup cost under tsx+TS is higher than a compiled JS worker; package the compiled dist/engine-worker.js in the VSIX.
- Do not build a second (worker-thread) runtime unless a later spike shows clear latency/memory wins (D-001).
- User-facing launch without separate Node remains to be smoke-tested inside VS Code ≥1.101 (open follow-up).

## Exec path note

```
process.execPath=/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node
process.version=v24.21.0
Extension host should spawn with process.execPath (Electron Node) so users need no separate Node install.
This spike runs under the Dev Node binary; VS Code ≥1.101 ships Node 22.15.1 — verify launch once under real Code.
```

Raw JSON: [child-process-results.json](./child-process-results.json)
