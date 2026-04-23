import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InteractionRuntime } from "@cafitac/codex-channels-core";
import { LocalMemoryBackend } from "@cafitac/codex-channels-backend-local";
import {
  CodexInteractionBridge,
  CodexJsonRpcLoop,
  HERMIT_CODEX_APP_SERVER_RESPONSE_MODE_ENV,
  HERMIT_CODEX_APP_SERVER_WRITER_ENCODING_ENV,
  HERMIT_CODEX_APP_SERVER_WRITER_FD_ENV,
  SpawnedCodexAppServerLoop,
  SpawnedHermitCodexAppServerLoop,
  buildHermitCodexAppServerWriterEnv,
  buildHermitCodexAppServerWriterStdio,
  mapCodexRequestToInteraction,
  mapInteractionResponseToCodexResult,
  mapServerRequestResolved,
} from "./index.js";

test("maps Codex command approval requests into approval interactions", () => {
  const interaction = mapCodexRequestToInteraction({
    id: 61,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thr_1",
      turnId: "turn_1",
      command: "rm -rf tmp",
      reason: "cleanup",
    },
  });

  assert.equal(interaction.kind, "approval_request");
  assert.equal(interaction.codex?.threadId, "thr_1");
  assert.match(interaction.payload.message, /cleanup/);
});

test("maps user input responses back into Codex tool response payloads", () => {
  const interaction = mapCodexRequestToInteraction({
    id: "abc",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thr_2",
      turnId: "turn_2",
      questions: [{ id: "target", question: "Where?" }],
    },
  });

  const result = mapInteractionResponseToCodexResult(interaction, {
    interactionId: interaction.id,
    action: "text",
    values: ["staging"],
    respondedAt: new Date().toISOString(),
  });

  assert.deepEqual(result, { answers: { target: { answers: ["staging"] } } });
});

test("maps server/requestResolved notifications into a compact resolved shape", () => {
  assert.deepEqual(
    mapServerRequestResolved({ method: "server/requestResolved", params: { threadId: "thr_3", requestId: 99 } }),
    { threadId: "thr_3", requestId: 99 },
  );
});

test("bridge converts a pending interaction reply into a json-rpc result", async () => {
  const runtime = new InteractionRuntime(new LocalMemoryBackend());
  const bridge = new CodexInteractionBridge(runtime, { timeoutMs: 1000 });

  const pending = bridge.handleServerRequest({
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thr_4",
      turnId: "turn_4",
      command: "echo hi",
    },
  });

  setTimeout(() => {
    void runtime.resolve({
      interactionId: "codex-7",
      action: "text",
      values: ["acceptForSession"],
      respondedAt: new Date().toISOString(),
    });
  }, 10);

  const response = await pending;
  assert.deepEqual(response, { id: 7, result: { decision: "acceptForSession" } });
});

test("json-rpc loop writes bridge responses for interactive requests", async () => {
  const runtime = new InteractionRuntime(new LocalMemoryBackend());
  const bridge = new CodexInteractionBridge(runtime, { timeoutMs: 1000 });
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => {
    written += chunk.toString();
  });

  const loop = new CodexJsonRpcLoop(bridge, input, output);
  const running = loop.run();
  input.write(JSON.stringify({
    id: 88,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thr_5",
      turnId: "turn_5",
      questions: [{ id: "target", question: "Where?" }],
    },
  }) + "\n");

  setTimeout(() => {
    void runtime.resolve({
      interactionId: "codex-88",
      action: "text",
      values: ["prod"],
      respondedAt: new Date().toISOString(),
    });
    input.end();
  }, 20);

  await running;
  const parsed = JSON.parse(written.trim());
  assert.deepEqual(parsed, { id: 88, result: { answers: { target: { answers: ["prod"] } } } });
});

test("builds Hermit writer env with fd and encoding defaults", () => {
  const env = buildHermitCodexAppServerWriterEnv({
    writerFd: 5,
    encoding: "utf-16le",
    env: { PATH: "/tmp/bin" },
  });

  assert.equal(env.PATH, "/tmp/bin");
  assert.equal(env[HERMIT_CODEX_APP_SERVER_WRITER_FD_ENV], "5");
  assert.equal(env[HERMIT_CODEX_APP_SERVER_WRITER_ENCODING_ENV], "utf-16le");
  assert.equal(env[HERMIT_CODEX_APP_SERVER_RESPONSE_MODE_ENV], "stdin");
});

test("builds Hermit writer stdio with a piped extra fd", () => {
  assert.deepEqual(
    buildHermitCodexAppServerWriterStdio(5),
    ["pipe", "pipe", "pipe", "ignore", "ignore", "pipe"],
  );
});

test("spawned loop can bridge a raw child process that emits interactive requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-channels-transport-'));
  const script = join(dir, 'fake-server.mjs');
  await writeFile(script, `
process.stdout.write(JSON.stringify({ id: 41, method: 'item/tool/requestUserInput', params: { threadId: 'thr_spawn', turnId: 'turn_spawn', questions: [{ id: 'target', question: 'Where?' }] } }) + '\n');
process.stdin.on('data', (chunk) => {
  const msg = JSON.parse(String(chunk).trim());
  if (msg.id === 41) process.exit(msg.result?.answers?.target?.answers?.[0] === 'stage' ? 0 : 1);
});
`, 'utf8');

  const runtime = new InteractionRuntime(new LocalMemoryBackend());
  const bridge = new CodexInteractionBridge(runtime, { timeoutMs: 1000 });
  const loop = new SpawnedCodexAppServerLoop(bridge, {
    command: process.execPath,
    extraArgs: [script],
    mode: 'raw',
  });

  const running = loop.start();
  setTimeout(() => {
    void runtime.resolve({
      interactionId: 'codex-41',
      action: 'text',
      values: ['stage'],
      respondedAt: new Date().toISOString(),
    });
  }, 50);

  await running;
  await rm(dir, { recursive: true, force: true });
});

test("spawned Hermit loop can read requests from the injected writer fd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-hermit-transport-"));
  const script = join(dir, "fake-hermit.mjs");
  await writeFile(
    script,
    `
import fs from 'node:fs';
const writerFd = Number(process.env.HERMIT_CODEX_APP_SERVER_WRITER_FD || "3");
fs.writeSync(writerFd, JSON.stringify({
  id: 55,
  method: 'item/tool/requestUserInput',
  params: {
    threadId: 'thr_hermit',
    turnId: 'turn_hermit',
    questions: [{ id: 'target', question: 'Where?' }],
  },
}) + '\\n');
process.stdin.once('data', (chunk) => {
  const msg = JSON.parse(String(chunk).trim());
  process.exit(msg.result?.answers?.target?.answers?.[0] === 'stage' ? 0 : 1);
});
`,
    "utf8",
  );

  const runtime = new InteractionRuntime(new LocalMemoryBackend());
  const bridge = new CodexInteractionBridge(runtime, { timeoutMs: 1000 });
  const loop = new SpawnedHermitCodexAppServerLoop(bridge, {
    command: process.execPath,
    args: [script],
    env: {},
    writerFd: 3,
  });

  const running = loop.start();
  setTimeout(() => {
    void runtime.resolve({
      interactionId: "codex-55",
      action: "text",
      values: ["stage"],
      respondedAt: new Date().toISOString(),
    });
  }, 50);

  await running;
  await rm(dir, { recursive: true, force: true });
});
