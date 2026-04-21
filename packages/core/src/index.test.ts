import test from "node:test";
import assert from "node:assert/strict";
import {
  ChannelBackend,
  InteractionPersistence,
  InteractionRuntime,
  InteractionRegistry,
  createInteraction,
} from "./index.js";

test("interaction registry resolves pending interactions", () => {
  const registry = new InteractionRegistry();
  const interaction = createInteraction({
    id: "ix_1",
    kind: "user_input_request",
    source: { type: "mcp_server", name: "example" },
    payload: { message: "Choose one" },
  });

  registry.register(interaction);
  const resolved = registry.resolve({
    interactionId: interaction.id,
    action: "text",
    values: ["ok"],
    respondedAt: new Date().toISOString(),
  });

  assert.ok(resolved);
  assert.equal(resolved?.status, "resolved");
});

test("channel backend contract shape is implementable", async () => {
  class FakeBackend implements ChannelBackend {
    readonly name = "fake";
    async publish() {}
    async resolve() {}
    async cancel() {}
    async health() { return { ok: true }; }
  }

  const backend = new FakeBackend();
  assert.deepEqual(await backend.health(), { ok: true });
});

test("interaction runtime marks delivery before resolution", async () => {
  const calls: string[] = [];
  class FakeBackend implements ChannelBackend {
    readonly name = "fake";
    async publish() { calls.push("publish"); }
    async resolve() { calls.push("resolve"); }
    async cancel() { calls.push("cancel"); }
    async health() { return { ok: true }; }
  }

  const runtime = new InteractionRuntime(new FakeBackend());
  const interaction = await runtime.publish(createInteraction({
    id: "ix_2",
    kind: "approval_request",
    source: { type: "runtime", name: "test" },
    payload: { message: "approve?" },
  }));

  assert.equal(interaction.status, "delivered");
  await runtime.resolve({
    interactionId: interaction.id,
    action: "accept",
    respondedAt: new Date().toISOString(),
  });
  assert.deepEqual(calls, ["publish", "resolve"]);
});

test("interaction runtime hydrates from persistence", async () => {
  class FakeBackend implements ChannelBackend {
    readonly name = "fake";
    async publish() {}
    async resolve() {}
    async cancel() {}
    async health() { return { ok: true }; }
  }
  class FakePersistence implements InteractionPersistence {
    constructor(private readonly interactions = [createInteraction({
      id: "ix_saved_1",
      kind: "progress_update",
      source: { type: "system", name: "persisted" },
      payload: { message: "saved" },
    })]) {}
    async load() { return this.interactions; }
    async save() {}
  }

  const runtime = await InteractionRuntime.create({ backend: new FakeBackend(), persistence: new FakePersistence() });
  assert.equal(runtime.registry.list()[0]?.id, "ix_saved_1");
});

test("interaction runtime publishAndWait resolves once a response is provided", async () => {
  class FakeBackend implements ChannelBackend {
    readonly name = "fake";
    async publish() {}
    async resolve() {}
    async cancel() {}
    async health() { return { ok: true }; }
  }

  const runtime = new InteractionRuntime(new FakeBackend());
  const interaction = createInteraction({
    id: "ix_wait_1",
    kind: "user_input_request",
    source: { type: "runtime", name: "test" },
    payload: { message: "reply" },
  });

  const pending = runtime.publishAndWait(interaction, 1000);
  setTimeout(() => {
    void runtime.resolve({
      interactionId: interaction.id,
      action: "text",
      values: ["done"],
      respondedAt: new Date().toISOString(),
    });
  }, 10);

  const response = await pending;
  assert.equal(response.values?.[0], "done");
});
