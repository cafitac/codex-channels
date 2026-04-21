import test from "node:test";
import assert from "node:assert/strict";
import { createInteraction } from "@cafitac/codex-channels-core";
import { SlackBotBackend } from "./index.js";

test("slack backend publishes interactions via chat.postMessage", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const backend = new SlackBotBackend({
    botToken: "xoxb-test-token",
    channelId: "C123",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await backend.publish(createInteraction({
    id: "ix_slack_1",
    kind: "approval_request",
    source: { type: "runtime", name: "test" },
    payload: { message: "Approve deploy?", options: [{ label: "Yes", value: "accept" }] },
  }));

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /chat\.postMessage/);
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(body.channel, "C123");
  assert.match(body.text, /interaction_id/);
});

test("slack backend health uses auth.test", async () => {
  const backend = new SlackBotBackend({
    botToken: "xoxb-test-token",
    channelId: "C123",
    fetchImpl: async (url) => {
      assert.match(String(url), /auth\.test/);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.deepEqual(await backend.health(), { ok: true, detail: "slack bot reachable" });
});
