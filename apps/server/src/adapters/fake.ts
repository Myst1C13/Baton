/**
 * Relay server — fake agent adapter
 * ---------------------------------
 * A deterministic, in-memory `AgentAdapter` for tests and local wiring. It does
 * NOT spawn a real process or call any provider CLI — it emits schema-valid
 * `RelayEvent`s and tracks its own lifecycle, so the orchestrator can be
 * exercised end-to-end without Claude or Codex.
 */

import { randomUUID } from "node:crypto";
import { RelayEvent } from "../../../../packages/shared/events";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentStartOptions,
  AgentStatus,
  AgentUsage,
  RelayEventSink,
} from "./types";

export interface FakeAgentOptions {
  id?: string;
  displayName?: string;
  models?: string[];
  supportsInput?: boolean;
  supportsResume?: boolean;
  /** Optional deterministic workspace action used by the bundled demo. */
  onStart?: (
    opts: AgentStartOptions
  ) =>
    | FakeWorkspaceChange[]
    | void
    | Promise<FakeWorkspaceChange[] | void>;
  /** Optional delayed output used to exercise automatic runtime triggers. */
  startupOutput?: string;
  startupDelayMs?: number;
}

export interface FakeWorkspaceChange {
  path: string;
  additions?: number;
  deletions?: number;
}

export class FakeAgentAdapter implements AgentAdapter {
  private state: AgentStatus = "idle";
  private sink: RelayEventSink = () => {};
  private sessionId = "";
  private readonly caps: AgentCapabilities;
  private readonly onStart?: FakeAgentOptions["onStart"];
  private readonly startupOutput?: string;
  private readonly startupDelayMs: number;
  private startupTimer: NodeJS.Timeout | null = null;

  /** Inputs received via `sendInput`, exposed for test assertions. */
  readonly received: string[] = [];

  constructor(opts: FakeAgentOptions = {}) {
    this.caps = {
      id: opts.id ?? "fake",
      displayName: opts.displayName ?? "Fake Agent",
      supportsInput: opts.supportsInput ?? true,
      supportsResume: opts.supportsResume ?? true,
      models: opts.models ?? ["fake-1"],
      contextWindow: 200_000,
    };
    this.onStart = opts.onStart;
    this.startupOutput = opts.startupOutput;
    this.startupDelayMs = opts.startupDelayMs ?? 750;
  }

  capabilities(): AgentCapabilities {
    return this.caps;
  }

  status(): AgentStatus {
    return this.state;
  }

  usage(): AgentUsage {
    return { tokens: this.received.join("").length, window: this.caps.contextWindow ?? 200_000 };
  }

  async start(opts: AgentStartOptions, onEvent: RelayEventSink): Promise<void> {
    if (this.state === "starting" || this.state === "running") {
      throw new Error("FakeAgentAdapter is already started.");
    }
    this.sink = onEvent;
    this.sessionId = opts.sessionId;
    this.state = "starting";
    const changes = (await this.onStart?.(opts)) ?? [];
    this.emit("agent.started", {
      provider: this.caps.id,
      model: opts.model ?? this.caps.models[0] ?? "",
      cwd: opts.cwd,
      resumed: Boolean(opts.manifestPath),
    });
    for (const change of changes) {
      this.emit("file.changed", { ...change });
    }
    if (opts.prompt) {
      this.emit("terminal.output", {
        stream: "stdout",
        chunk: `demo agent received task: ${opts.prompt}\n`,
      });
    }
    // A synchronous event sink may request stop() while start() is emitting.
    // Never resurrect an adapter that was stopped during launch.
    if (this.state === "starting") this.state = "running";
    if (this.state === "running" && this.startupOutput) {
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (this.state !== "running") return;
        this.emit("terminal.output", {
          stream: "stderr",
          chunk: this.startupOutput,
        });
      }, this.startupDelayMs);
      this.startupTimer.unref();
    }
  }

  sendInput(data: string): void {
    if (this.state !== "running") {
      throw new Error(`Cannot sendInput while status is "${this.state}".`);
    }
    this.received.push(data);
    this.emit("terminal.output", { stream: "stdout", chunk: `echo: ${data}` });
  }

  async stop(): Promise<void> {
    if (this.state === "exited") return;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    const wasLive = this.state === "running" || this.state === "starting";
    this.state = "exited";
    if (wasLive) {
      this.emit("process.exited", { exitCode: 0, signal: null });
    }
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    this.sink(
      RelayEvent.parse({
        id: `evt-${randomUUID()}`,
        sessionId: this.sessionId,
        type,
        timestamp: new Date().toISOString(),
        payload,
      })
    );
  }
}
