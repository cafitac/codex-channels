import test from "node:test";
import assert from "node:assert/strict";
import { createInteraction } from "@cafitac/codex-channels-core";
import { TelegramBotBackend } from "./index.js";

test("telegram backend publishes interactions via sendMessage", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const backend = new TelegramBotBackend({
    botToken: "test-token",
    chatId: "1234",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await backend.publish(createInteraction({
    id: "ix_tg_1",
    kind: "approval_request",
    source: { type: "runtime", name: "test" },
    payload: { message: "Approve deploy?", options: [{ label: "Yes", value: "accept" }] },
  }));

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /sendMessage/);
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(body.chat_id, "1234");
  assert.match(body.text, /interaction_id/);
});

test("telegram backend health uses getMe", async () => {
  const backend = new TelegramBotBackend({
    botToken: "test-token",
    chatId: "1234",
    fetchImpl: async (url) => {
      assert.match(String(url), /getMe/);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.deepEqual(await backend.health(), { ok: true, detail: "telegram bot reachable" });
});
