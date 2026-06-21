/**
 * RelayIDE — Redis Event Store
 * ----------------------------
 * The bridge between the orchestrator and Redis. It SUBSCRIBES to the
 * orchestrator's event stream (`orchestrator.on("event")`) and persists every
 * RelayEvent to Redis so the UI can render a live timeline AND rebuild it after
 * a refresh/reconnect (the "refresh-survival" property).
 *
 * IMPORTANT BOUNDARY: the engine never imports Redis. This file imports the
 * orchestrator (one direction only). Persistence is fire-and-forget — a Redis
 * hiccup must NEVER block or break a switch transaction.
 *
 * What it stores (per session):
 *   relay:session:{id}:events    STREAM  the full normalized timeline (replayable)
 *   relay:session:{id}           HASH    current session state (fast load on connect)
 *   relay:session:{id}:handoff   STRING  the latest handoff packet (the bridge artifact)
 *   relay:session:{id}:terminal  LIST    bounded recent timeline excerpts
 */

import Redis from "ioredis";
import { Orchestrator, OrchestratorEvent } from "./orchestrator";

export interface EventStoreOptions {
  sessionId: string;
  /** redis://host:port — defaults to localhost. */
  redisUrl?: string;
  /** Cap on the bounded terminal list. */
  maxTerminal?: number;
}

export class EventStore {
  private readonly redis: Redis;
  private readonly sessionId: string;
  private readonly maxTerminal: number;

  constructor(opts: EventStoreOptions) {
    this.sessionId = opts.sessionId;
    this.maxTerminal = opts.maxTerminal ?? 500;
    this.redis = new Redis(opts.redisUrl ?? "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 1,
    });
    // A Redis problem is logged, never thrown into the engine.
    this.redis.on("error", (err) =>
      console.warn(`[event-store] redis error: ${err.message}`)
    );
  }

  private key(suffix?: string): string {
    const base = `relay:session:${this.sessionId}`;
    return suffix ? `${base}:${suffix}` : base;
  }

  /** Subscribe to the orchestrator and persist every event it emits. */
  attach(orchestrator: Orchestrator): void {
    orchestrator.on("event", (event) => {
      // Fire-and-forget: persistence must not block the switch transaction.
      void this.record(event).catch((err) =>
        console.warn(`[event-store] failed to persist ${event.type}: ${err.message}`)
      );
    });
  }

  private async record(event: OrchestratorEvent): Promise<void> {
    const pipe = this.redis.pipeline();

    // 1. timeline — the replayable "what happened" log
    pipe.xadd(this.key("events"), "*", "data", JSON.stringify(event));

    // 2. session state — what a freshly-connected UI needs immediately
    pipe.hset(this.key(), {
      sessionId: this.sessionId,
      lastEvent: event.type,
      agent: event.agent ?? "",
      updatedAt: event.timestamp,
    });

    // 3. the handoff packet — the artifact that bridges old → new session
    if (event.type === "handoff.created") {
      pipe.set(this.key("handoff"), JSON.stringify(event.payload));
    }

    // 4. bounded terminal/timeline excerpts
    pipe.rpush(
      this.key("terminal"),
      `${event.timestamp} ${event.type} ${JSON.stringify(event.payload)}`
    );
    pipe.ltrim(this.key("terminal"), -this.maxTerminal, -1);

    await pipe.exec();
  }

  /**
   * Rebuild the entire timeline from the Stream. This is the refresh-survival
   * path: on (re)connect the UI calls this to redraw everything, then tails the
   * stream for new events.
   */
  async replay(): Promise<OrchestratorEvent[]> {
    const rows = await this.redis.xrange(this.key("events"), "-", "+");
    return rows.map(([, fields]) => JSON.parse(fields[1]) as OrchestratorEvent);
  }

  /** Current session state hash (for an instant load on connect). */
  async getState(): Promise<Record<string, string>> {
    return this.redis.hgetall(this.key());
  }

  /** The latest persisted handoff packet, or null. */
  async getHandoff(): Promise<unknown | null> {
    const raw = await this.redis.get(this.key("handoff"));
    return raw ? JSON.parse(raw) : null;
  }

  /** Wipe this session's keys (useful between demo runs). */
  async clear(): Promise<void> {
    await this.redis.del(
      this.key(),
      this.key("events"),
      this.key("handoff"),
      this.key("terminal")
    );
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
