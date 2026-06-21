/**
 * Relay server — bootstrap
 * ------------------------
 * The only entry point that has side effects: validate env, build the app, bind
 * the port, and install graceful shutdown. Everything it uses is built and
 * tested in isolation (`env.ts`, `app.ts`), so this file stays thin.
 */

import type { Server } from "node:http";
import { loadEnv } from "./env";
import { createApp } from "./app";

/** Drain in-flight requests, then exit. Idempotent + force-quits if stuck. */
function installGracefulShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[relay:server] ${signal} received — shutting down…`);

    server.close((err) => {
      if (err) {
        console.error("[relay:server] error during shutdown:", err);
        process.exit(1);
      }
      console.log("[relay:server] closed cleanly.");
      process.exit(0);
    });

    // Don't hang forever if a connection refuses to drain.
    setTimeout(() => {
      console.error("[relay:server] shutdown timed out — forcing exit.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function main(): void {
  const env = loadEnv();
  const server = createApp(env);

  server.listen(env.PORT, () => {
    console.log(
      `[relay:server] listening on http://localhost:${env.PORT} (web=${env.WEB_URL})`
    );
  });

  installGracefulShutdown(server);
}

main();
