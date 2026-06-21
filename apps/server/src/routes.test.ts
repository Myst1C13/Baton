/**
 * Error-route tests — the centralized handler must produce consistent JSON for
 * unknown paths (404) and unsupported methods (405 + Allow), binding the real
 * app to an ephemeral port.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./app";
import { loadEnv } from "./env";

async function withServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const env = loadEnv({ PORT: "0", WEB_URL: "http://localhost:3000" });
  const server: Server = createApp(env);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("unknown route returns 404 JSON envelope", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    assert.equal(
      res.headers.get("content-type"),
      "application/json; charset=utf-8"
    );
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "not_found");
  });
});

test("POST /health returns 405 with an Allow: GET header", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`, { method: "POST" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "method_not_allowed");
  });
});
