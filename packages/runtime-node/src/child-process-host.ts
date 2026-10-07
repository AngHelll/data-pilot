/**
 * Host-side launcher for the engine child process.
 * Uses process.execPath so the extension can run without a separate Node install.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
  PROTOCOL_VERSION,
  type EngineOp,
  type IpcRequest,
  type IpcResponse,
} from "@data-pilot/contracts";

export interface HostOptions {
  /** Absolute path to engine-worker entry (ts or js). Required. */
  workerEntry: string;
  trustMode?: "trusted" | "untrusted-limited";
  rssLimitMb?: number;
  /** Override executable; defaults to process.execPath (VS Code / Electron Node). */
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export class ChildProcessHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: IpcResponse) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout | undefined;
    }
  >();
  private ready = false;
  private stderrLines: string[] = [];
  private seq = 0;

  constructor(private readonly options: HostOptions) {
    if (!options.workerEntry) {
      throw new Error("ChildProcessHost requires options.workerEntry");
    }
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get lastStderr(): string[] {
    return [...this.stderrLines];
  }

  async start(): Promise<{ startupMs: number; readyEvent?: unknown }> {
    if (this.child) {
      throw new Error("ChildProcessHost already started");
    }
    const started = performance.now();
    const workerEntry = this.options.workerEntry;
    const execPath = this.options.execPath ?? process.execPath;
    const isTs = workerEntry.endsWith(".ts");
    const args = isTs ? ["--import", "tsx", workerEntry] : [workerEntry];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.env,
      DATA_PILOT_TRUST_MODE: this.options.trustMode ?? "trusted",
    };
    // Required when execPath is VS Code / Cursor Electron (not plain Node).
    if (!this.options.execPath || this.options.execPath === process.execPath) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    if (this.options.rssLimitMb && this.options.rssLimitMb > 0) {
      env.DATA_PILOT_RSS_LIMIT_MB = String(this.options.rssLimitMb);
    }

    this.child = spawn(execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let readyEvent: unknown;
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Engine child did not become ready within 5s"));
      }, 5000);

      this.child!.stderr.setEncoding("utf8");
      this.child!.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          this.stderrLines.push(line);
          try {
            const evt = JSON.parse(line) as { event?: string };
            if (evt.event === "ready") {
              readyEvent = evt;
              this.ready = true;
              clearTimeout(timeout);
              resolve();
            }
          } catch {
            // non-JSON stderr retained for diagnostics
          }
        }
      });

      this.child!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      let response: IpcResponse;
      try {
        response = JSON.parse(line) as IpcResponse;
      } catch {
        return;
      }
      const waiter = this.pending.get(response.requestId);
      if (!waiter) return;
      if (waiter.timer) clearTimeout(waiter.timer);
      this.pending.delete(response.requestId);
      waiter.resolve(response);
    });

    this.child.on("exit", (code, signal) => {
      for (const [id, waiter] of this.pending) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(
          new Error(
            `Engine exited before response (code=${code}, signal=${signal}, requestId=${id})`,
          ),
        );
      }
      this.pending.clear();
      this.ready = false;
      this.child = null;
    });

    await readyPromise;
    return { startupMs: performance.now() - started, readyEvent };
  }

  async request(
    op: EngineOp,
    payload?: unknown,
    options: RequestOptions = {},
  ): Promise<IpcResponse> {
    const requestId = `req-${++this.seq}-${Date.now()}`;
    return this.requestWithId(requestId, op, payload, options);
  }

  /** Spike/testing helper — allows cancel to target a known requestId. */
  async requestWithId(
    requestId: string,
    op: EngineOp,
    payload?: unknown,
    options: RequestOptions = {},
  ): Promise<IpcResponse> {
    if (!this.child || !this.ready) {
      throw new Error("Engine child is not running");
    }
    const msg: IpcRequest = {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      op,
      ...(payload !== undefined ? { payload } : {}),
    };

    return new Promise<IpcResponse>((resolve, reject) => {
      const timer =
        options.timeoutMs !== undefined
          ? setTimeout(() => {
              this.pending.delete(requestId);
              reject(new Error(`IPC timeout after ${options.timeoutMs}ms (${op})`));
            }, options.timeoutMs)
          : undefined;
      this.pending.set(requestId, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify(msg)}\n`);
    });
  }

  async cancel(targetRequestId: string): Promise<IpcResponse> {
    return this.request("cancelJob", { requestId: targetRequestId }, { timeoutMs: 2000 });
  }

  /** Force-kill the child (SIGKILL). Used for RSS/native-failure recovery. */
  kill(signal: NodeJS.Signals = "SIGKILL"): void {
    this.child?.kill(signal);
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.rl?.close();
      this.rl = null;
      this.ready = false;
      return;
    }
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.rl?.close();
      this.rl = null;
      this.child = null;
      this.ready = false;
      return;
    }
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 500).unref();
    });
    this.rl?.close();
    this.rl = null;
    this.child = null;
    this.ready = false;
  }

  /** Restart after kill/crash — returns new startup timing. */
  async recover(): Promise<{ startupMs: number }> {
    await this.stop().catch(() => undefined);
    this.stderrLines = [];
    this.ready = false;
    this.child = null;
    return this.start();
  }
}
