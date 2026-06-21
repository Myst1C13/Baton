import assert from "node:assert/strict";
import test from "node:test";
import { RelayEvent, type RelayEvent as RelayEventT } from "../packages/shared";
import { mergeRelayEvents } from "../ui/src/useRelayStream";

function event(id: string, timestamp: string): RelayEventT {
  return RelayEvent.parse({
    id,
    sessionId: "session-1",
    type: "terminal.output",
    timestamp,
    payload: { chunk: id },
  });
}

test("mergeRelayEvents preserves replay order and removes live duplicates", () => {
  const first = event("first", "2026-06-21T00:00:00.000Z");
  const second = event("second", "2026-06-21T00:00:01.000Z");
  const third = event("third", "2026-06-21T00:00:02.000Z");

  assert.deepEqual(
    mergeRelayEvents([first, second], [second, third]).map((item) => item.id),
    ["first", "second", "third"]
  );
});
