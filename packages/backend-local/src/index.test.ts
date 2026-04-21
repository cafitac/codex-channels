import test from "node:test";
import assert from "node:assert/strict";
import { InteractionRuntime, createInteraction } from "@cafitac/codex-channels-core";
import { LocalHttpChannelServer, LocalMemoryBackend } from "./index.js";

test("local http channel server lists and resolves interactions", async () => {
  const runtime = new InteractionRuntime(new LocalMemoryBackend());
  const server = new LocalHttpChannelServer(runtime);
  const { url } = await server.start({ port: 4417 });

  try {
    const delivered = await runtime.publish(createInteraction({
      id: "ix_http_1",
      kind: "user_input_request",
      source: { type: "runtime", name: "test" },
      payload: { message: "Choose target" },
    }));

    assert.equal(delivered.status, "delivered");

    const listResponse = await fetch(`${url}/interactions`);
    const listJson = await listResponse.json() as { interactions: Array<{ id: string }> };
    assert.equal(listJson.interactions[0]?.id, "ix_http_1");

    const respondResponse = await fetch(`${url}/interactions/ix_http_1/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "text", values: ["staging"] }),
    });
    const respondJson = await respondResponse.json() as { interaction: { status: string } };
    assert.equal(respondJson.interaction.status, "resolved");
  } finally {
    await server.stop();
  }
});
