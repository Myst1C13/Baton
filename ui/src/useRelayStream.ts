import { useEffect, useState } from "react";
import { RelayEvent, type RelayEvent as RelayEventT } from "../../packages/shared";

export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface RelayStream {
  events: RelayEventT[];
  status: StreamStatus;
}

/** Merge replayed/live events without duplicates while preserving source order. */
export function mergeRelayEvents(
  first: RelayEventT[],
  second: RelayEventT[]
): RelayEventT[] {
  const seen = new Set<string>();
  const merged: RelayEventT[] = [];
  for (const event of [...first, ...second]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(event);
  }
  return merged;
}

/**
 * Subscribe to the server's session broadcaster (`WS /ws/sessions/:id`) and
 * hydrate the Redis/in-memory timeline over HTTP. Reconnects with bounded
 * exponential backoff and deduplicates replayed/live events by id.
 */
export function useRelayStream(
  sessionId: string | null,
  base = "ws://127.0.0.1:4000",
  apiBase = "http://127.0.0.1:4000"
): RelayStream {
  const [events, setEvents] = useState<RelayEventT[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");

  useEffect(() => {
    if (!sessionId) {
      setStatus("idle");
      return;
    }
    setEvents([]);
    setStatus("connecting");

    const url = `${base.replace(/\/$/, "")}/ws/sessions/${encodeURIComponent(sessionId)}`;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;

    const hydrate = async (): Promise<void> => {
      try {
        const response = await fetch(
          `${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(sessionId)}/events`
        );
        if (!response.ok) return;
        const body = (await response.json()) as { events?: unknown[] };
        const history = (body.events ?? [])
          .map((event) => RelayEvent.safeParse(event))
          .filter((result) => result.success)
          .map((result) => result.data);
        if (!cancelled) {
          setEvents((live) => mergeRelayEvents(history, live));
        }
      } catch {
        // Live streaming still works when replay is temporarily unavailable.
      }
    };

    const connect = (): void => {
      if (cancelled) return;
      setStatus("connecting");
      const ws = new WebSocket(url);
      socket = ws;

      ws.onopen = () => {
        attempts = 0;
        setStatus("open");
        void hydrate();
      };
      ws.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const result = RelayEvent.safeParse(parsed);
        if (result.success) {
          setEvents((prev) => mergeRelayEvents(prev, [result.data]));
        }
      };
      ws.onerror = () => {
        if (!cancelled) setStatus("error");
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        const delay = Math.min(4000, 250 * 2 ** attempts++);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [sessionId, base, apiBase]);

  return { events, status };
}
