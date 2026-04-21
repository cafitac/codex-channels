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
