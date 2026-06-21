import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createApp, createAppRuntime } from "./app";
import { SessionBroadcaster } from "./broadcaster";
import { loadEnv } from "./env";
import { SessionManager } from "./session-manager";
import { RelayEvent } from "../../../packages/shared/events";

test("the production app mounts sessions and the session WebSocket", async () => {
  const broadcaster = new SessionBroadcaster();
  const sessions = new SessionManager();
  const server = createApp(loadEnv({ PORT: "0" }), { broadcaster, sessions });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const create = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Complete the Relay demo.",
        verificationCommand: "npm test",
        workspaceDir: process.cwd(),
      }),
    });
    assert.equal(create.status, 201);
    const session = (await create.json()) as { id: string };

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/sessions/${session.id}`
    );
    const received = new Promise<RelayEvent>((resolve, reject) => {
      ws.on("message", (data: WebSocket.RawData) =>
        resolve(RelayEvent.parse(JSON.parse(data.toString())))
      );
      ws.on("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    broadcaster.emitDemoEvent(session.id, "session.started");
    const event = await received;
    assert.equal(event.sessionId, session.id);
    assert.equal(event.type, "session.started");
    ws.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("createAppRuntime exposes the exact injected dependencies", () => {
  const broadcaster = new SessionBroadcaster();
  const sessions = new SessionManager();
  const runtime = createAppRuntime(loadEnv({ PORT: "0" }), {
    broadcaster,
    sessions,
  });

  assert.equal(runtime.sessions, sessions);
  assert.equal(runtime.broadcaster, broadcaster);
  runtime.server.close();
});
