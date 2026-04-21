import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliEntry = join(__dirname, "..", "dist", "index.js");

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate ephemeral port"));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, failure: () => string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch {
      // ignore transient failures while the process or server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(failure());
}

test("bridge-stdio exposes local runtime and returns json-rpc responses", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-channels-cli-"));
  const stateFile = join(stateDir, "state.json");
  const port = await getFreePort();

  const child = spawn(process.execPath, [cliEntry, "bridge-stdio", "--port", String(port), "--state-file", stateFile], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitFor(() => stderr.includes('"command":"bridge-stdio"'), 2000, () => `bridge startup timeout: ${stderr}`);

    child.stdin.write(JSON.stringify({
      id: 501,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thr_cli",
        turnId: "turn_cli",
        questions: [{ id: "env", question: "Which environment?" }],
      },
    }) + "\n");

    await waitFor(async () => {
      const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
      const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
      return interactionsJson.interactions.some((item) => item.id === "codex-501");
    }, 2000, () => "bridge-stdio interaction never appeared");

    const respondResponse = await fetch(`http://127.0.0.1:${port}/interactions/codex-501/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "text", values: ["staging"] }),
    });
    assert.equal(respondResponse.ok, true);

    await waitFor(() => stdout.includes('"id":501'), 2000, () => `bridge response timeout: ${stdout}`);

    const parsed = JSON.parse(stdout.trim());
    assert.deepEqual(parsed, { id: 501, result: { answers: { env: { answers: ["staging"] } } } });
  } finally {
    child.kill();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("bridge-spawn boots the local runtime and reports startup metadata", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "codex-channels-cli-spawn-"));
  const stateFile = join(tempDir, "state.json");
  const port = await getFreePort();
  const fakeChild = join(tempDir, "fake-codex.mjs");
  await writeFile(fakeChild, `setInterval(() => {}, 1000);`, "utf8");

  const child = spawn(process.execPath, [cliEntry, "bridge-spawn", "--port", String(port), "--state-file", stateFile, "--spawn-mode", "raw", "--codex-command", process.execPath, "--codex-arg", fakeChild], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitFor(() => stderr.includes('"command":"bridge-spawn"'), 2000, () => `bridge-spawn startup timeout: ${stderr}`);
    const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
    const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
    assert.equal(interactionsJson.interactions.some((item) => item.id === "bootstrap-preview"), true);
  } finally {
    child.kill();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("plugin-bootstrap writes a workspace marketplace entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-marketplace-"));
  const marketplaceFile = join(dir, ".agents", "plugins", "marketplace.json");

  const child = spawn(process.execPath, [cliEntry, "plugin-bootstrap", "--scope", "workspace", "--plugin-path", ".", "--marketplace-file", marketplaceFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.command, "plugin-bootstrap");

  const marketplace = JSON.parse(await readFile(marketplaceFile, "utf8")) as { plugins: Array<{ name: string; source: { path: string } }> };
  assert.equal(marketplace.plugins[0]?.name, "codex-channels");
  assert.equal(marketplace.plugins[0]?.source.path, ".");

  await rm(dir, { recursive: true, force: true });
});

test("submit publishes one interaction and returns the resolved response", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-submit-"));
  const stateFile = join(dir, "state.json");
  const interactionFile = join(dir, "interaction.json");
  const port = await getFreePort();

  await writeFile(interactionFile, JSON.stringify({
    id: "submit-1",
    kind: "user_input_request",
    source: { type: "system", name: "test" },
    payload: { message: "Which env?" },
    createdAt: new Date().toISOString(),
    status: "pending",
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "submit", "--port", String(port), "--state-file", stateFile, "--interaction-file", interactionFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  try {
    await waitFor(async () => {
      const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
      const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
      return interactionsJson.interactions.some((item) => item.id === "submit-1");
    }, 2000, () => "submit interaction never appeared");

    const respondResponse = await fetch(`http://127.0.0.1:${port}/interactions/submit-1/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "text", values: ["staging"] }),
    });
    assert.equal(respondResponse.ok, true);

    await waitFor(() => stdout.includes('"ok":true'), 2000, () => `submit response timeout: ${stdout}`);
    const payload = JSON.parse(stdout.trim());
    assert.deepEqual(payload, {
      ok: true,
      response: {
        interactionId: "submit-1",
        action: "text",
        values: ["staging"],
        respondedAt: payload.response.respondedAt,
      },
    });
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("doctor reports runtime reachability and next steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-doctor-"));
  const stateFile = join(dir, "state.json");
  const port = await getFreePort();

  const child = spawn(process.execPath, [cliEntry, "doctor", "--port", String(port), "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.runtime.reachable, false);
  assert.equal(payload.interactionCount, 0);
  assert.match(payload.next[0], /demo/);

  await rm(dir, { recursive: true, force: true });
});

test("inspect prints persisted interactions without a running server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-inspect-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({
    interactions: [{
      id: "inspect-1",
      kind: "approval_request",
      source: { type: "system", name: "test" },
      payload: { message: "Approve deploy?" },
      createdAt: new Date().toISOString(),
      status: "delivered",
    }],
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "inspect", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /inspect-1/);
  assert.match(stdout, /approval_request/);

  await rm(dir, { recursive: true, force: true });
});

test("reply resolves an interaction on the running local runtime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-reply-"));
  const stateFile = join(dir, "state.json");
  const port = await getFreePort();

  const demo = spawn(process.execPath, [cliEntry, "demo", "--port", String(port), "--state-file", stateFile, "--timeout-ms", "10000"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let demoStdout = "";
  demo.stdout.on("data", (chunk) => {
    demoStdout += chunk.toString();
  });

  try {
    await waitFor(async () => {
      const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
      const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
      return interactionsJson.interactions.some((item) => item.id.startsWith("demo-"));
    }, 2000, () => `reply interaction never appeared: ${demoStdout}`);

    const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
    const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
    const interactionId = interactionsJson.interactions.find((item) => item.id.startsWith("demo-"))?.id;
    assert.ok(interactionId);

    const reply = spawn(process.execPath, [cliEntry, "reply", "--port", String(port), "--id", interactionId!, "--text", "staging"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const replyExit = await new Promise<number | null>((resolve) => reply.once("exit", resolve));
    assert.equal(replyExit, 0);

    await waitFor(() => demoStdout.includes('"ok": true') || demoStdout.includes('"ok":true'), 2000, () => `demo did not resolve via reply: ${demoStdout}`);
  } finally {
    demo.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("demo publishes an interaction and returns the resolved response", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-demo-"));
  const stateFile = join(dir, "state.json");
  const port = await getFreePort();

  const child = spawn(process.execPath, [cliEntry, "demo", "--port", String(port), "--state-file", stateFile, "--timeout-ms", "10000"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  try {
    await waitFor(async () => {
      const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
      const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
      return interactionsJson.interactions.some((item) => item.id.startsWith("demo-"));
    }, 2000, () => `demo interaction never appeared: ${stdout}`);

    const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
    const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
    const interactionId = interactionsJson.interactions.find((item) => item.id.startsWith("demo-"))?.id;
    assert.ok(interactionId);

    const reply = spawn(process.execPath, [cliEntry, "reply", "--port", String(port), "--id", interactionId!, "--text", "staging"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const replyExit = await new Promise<number | null>((resolve) => reply.once("exit", resolve));
    assert.equal(replyExit, 0);

    await waitFor(() => stdout.includes('"ok": true') || stdout.includes('"ok":true'), 2000, () => `demo did not resolve: ${stdout}`);
    assert.match(stdout, /codex-channels demo is running/);
    assert.match(stdout, /interaction:/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
