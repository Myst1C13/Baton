/**
 * Focused API test — GET /health.
 * Binds the real app to an ephemeral port and asserts the live HTTP response,
 * so it exercises routing, JSON serialization, and the env layer together.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app";
import { loadEnv } from "./env";

test("GET /health returns 200 ok JSON", async () => {
  const env = loadEnv({ PORT: "0", WEB_URL: "http://localhost:3000" });
  const server = createApp(env);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("content-type"),
      "application/json; charset=utf-8"
    );

    const body = (await res.json()) as { status: string; uptime: number };
    assert.equal(body.status, "ok");
    assert.equal(typeof body.uptime, "number");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
