import test from "node:test";
import assert from "node:assert/strict";
import { createInteraction } from "@cafitac/codex-channels-core";
import { DiscordBotBackend } from "./index.js";

test("discord backend publishes interactions via channel messages API", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const backend = new DiscordBotBackend({
    botToken: "discord-test-token",
    channelId: "999",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    },
  });

  await backend.publish(createInteraction({
    id: "ix_discord_1",
    kind: "approval_request",
    source: { type: "runtime", name: "test" },
    payload: { message: "Approve deploy?", options: [{ label: "Yes", value: "accept" }] },
  }));

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/channels\/999\/messages/);
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.match(body.content, /interaction_id/);
});

test("discord backend health uses users/@me", async () => {
  const backend = new DiscordBotBackend({
    botToken: "discord-test-token",
    channelId: "999",
    fetchImpl: async (url) => {
      assert.match(String(url), /users\/@me/);
      return new Response(JSON.stringify({ id: "bot" }), { status: 200 });
    },
  });

  assert.deepEqual(await backend.health(), { ok: true, detail: "discord bot reachable" });
});
