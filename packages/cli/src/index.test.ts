import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { buildSelfUpdatePlan, checkForUpdates, compareVersions, dismissVersion, readUpdateState, shouldCheckForUpdates } from "./updates.js";
import { createMenuController, renderMenu, supportsInteractiveMenu } from "./interactive.js";

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

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("compareVersions handles multi-digit semver segments", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
});

test("shouldCheckForUpdates respects TTL", () => {
  assert.equal(shouldCheckForUpdates({}), true);
  assert.equal(shouldCheckForUpdates({ lastCheckedAt: new Date().toISOString() }), false);
  assert.equal(shouldCheckForUpdates({ lastCheckedAt: "1999-01-01T00:00:00.000Z" }), true);
});

test("interactive menu controller wraps selection and renders arrow state", () => {
  const controller = createMenuController([
    { label: "One", value: 1 },
    { label: "Two", value: 2 },
  ], 0).move(-1);

  assert.equal(controller.selected().value, 2);
  const rendered = renderMenu("Choose one", controller);
  assert.match(rendered, /› Two/);
  assert.match(rendered, /Use ↑\/↓ to move/);
});

test("supportsInteractiveMenu requires tty input and output", () => {
  const rawMode = (_mode: boolean) => undefined as unknown as NodeJS.ReadStream;
  assert.equal(supportsInteractiveMenu({ isTTY: true, setRawMode: rawMode }, { isTTY: true }), true);
  assert.equal(supportsInteractiveMenu({ isTTY: false, setRawMode: rawMode }, { isTTY: true }), false);
  assert.equal(supportsInteractiveMenu({ isTTY: true, setRawMode: undefined as unknown as NodeJS.ReadStream["setRawMode"] }, { isTTY: true }), false);
});

test("checkForUpdates respects skip-until-next-version state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-update-state-"));
  const stateFile = join(dir, "update-state.json");

  await withEnv({
    CODEX_CHANNELS_UPDATE_STATE_FILE: stateFile,
    CODEX_CHANNELS_LATEST_VERSION: "0.1.99",
    CODEX_CHANNELS_INSTALL_CONTEXT: "published-package",
  }, async () => {
    await dismissVersion("0.1.99", stateFile);
    const availability = await checkForUpdates({ force: true });
    assert.equal(availability, null);
    const state = await readUpdateState(stateFile);
    assert.equal(state.dismissedVersion, "0.1.99");
  });

  await rm(dir, { recursive: true, force: true });
});

test("explicit self-update ignores dismissed-version state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-self-update-dismissed-"));
  const stateFile = join(dir, "update-state.json");
  const marker = join(dir, "updated.txt");
  const updater = join(dir, "fake-update.mjs");
  await writeFile(updater, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ok');`, "utf8");

  await dismissVersion("0.1.99", stateFile);

  const child = spawn(process.execPath, [cliEntry, "self-update", "--yes"], {
    cwd: dir,
    env: {
      ...process.env,
      CODEX_CHANNELS_UPDATE_STATE_FILE: stateFile,
      CODEX_CHANNELS_LATEST_VERSION: "0.1.99",
      CODEX_CHANNELS_INSTALL_CONTEXT: "published-package",
      CODEX_CHANNELS_UPDATE_COMMAND: process.execPath,
      CODEX_CHANNELS_UPDATE_ARGS: updater,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /Updated codex-channels to v0.1.99/);
  assert.equal(await readFile(marker, "utf8"), "ok");

  await rm(dir, { recursive: true, force: true });
});

test("buildSelfUpdatePlan auto-runs for published installs and falls back for source checkouts", () => {
  const published = buildSelfUpdatePlan({
    currentVersion: "0.1.10",
    latestVersion: "0.1.11",
    stateFile: "/tmp/state.json",
    installContext: "published-package",
  });
  assert.equal(published.canAutoRun, true);
  assert.deepEqual(published.args, ["install", "-g", "@cafitac/codex-channels@latest"]);

  const source = buildSelfUpdatePlan({
    currentVersion: "0.1.10",
    latestVersion: "0.1.11",
    stateFile: "/tmp/state.json",
    installContext: "source-checkout",
  });
  assert.equal(source.canAutoRun, false);
  assert.match(source.manualSteps[0] ?? "", /git pull/);
});

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
  await writeFile(fakeChild, "setInterval(() => {}, 1000);", "utf8");

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


test("pending shows actionable interactions newest-first and skips progress updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-pending-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({
    interactions: [
      {
        id: "bootstrap-preview",
        kind: "progress_update",
        source: { type: "system", name: "codex-channels" },
        payload: { message: "ready" },
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "pending",
      },
      {
        id: "older-request",
        kind: "user_input_request",
        source: { type: "system", name: "test" },
        payload: { message: "Older request" },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      },
      {
        id: "newer-request",
        kind: "approval_request",
        source: { type: "system", name: "test" },
        payload: { message: "Newest request" },
        createdAt: "2026-01-01T00:00:02.000Z",
        status: "delivered",
      }
    ]
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "pending", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.ok(stdout.indexOf("newer-request") < stdout.indexOf("older-request"));
  assert.equal(stdout.includes("bootstrap-preview"), false);

  await rm(dir, { recursive: true, force: true });
});

test("reply-latest resolves the newest actionable interaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-reply-latest-"));
  const stateFile = join(dir, "state.json");
  const port = await getFreePort();

  await writeFile(stateFile, JSON.stringify({
    interactions: [
      {
        id: "older-request",
        kind: "user_input_request",
        source: { type: "system", name: "test" },
        payload: { message: "Older request" },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      },
      {
        id: "newer-request",
        kind: "approval_request",
        source: { type: "system", name: "test" },
        payload: { message: "Newest request" },
        createdAt: "2026-01-01T00:00:02.000Z",
        status: "pending",
      }
    ]
  }), "utf8");

  const serverChild = spawn(process.execPath, [cliEntry, "serve", "--port", String(port), "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverStdout = "";
  serverChild.stdout.on("data", (chunk) => {
    serverStdout += chunk.toString();
  });

  try {
    await waitFor(() => serverStdout.includes('"ok": true') || serverStdout.includes('"ok":true'), 2000, () => `serve startup timeout: ${serverStdout}`);

    const child = spawn(process.execPath, [cliEntry, "reply-latest", "--port", String(port), "--state-file", stateFile, "--text", "approved"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim()) as { interaction?: { id?: string }; response?: { interactionId?: string; values?: string[] } };
    assert.equal(payload.interaction?.id, "newer-request");
    assert.equal(payload.response?.interactionId, "newer-request");
    assert.deepEqual(payload.response?.values, ["approved"]);
  } finally {
    serverChild.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("plugin-bootstrap writes a workspace marketplace entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-marketplace-"));
  const marketplaceFile = join(dir, ".agents", "plugins", "marketplace.json");

  const child = spawn(process.execPath, [cliEntry, "plugin-bootstrap", "--scope", "workspace", "--plugin-path", ".", "--marketplace-file", marketplaceFile], {
    cwd: dir,
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

  const workspaceSkill = join(dir, ".codex", "skills", "codex-channels", "SKILL.md");
  assert.equal(Boolean((await readFile(workspaceSkill, "utf8")).length), true);

  await rm(dir, { recursive: true, force: true });
});

test("plugin-bootstrap defaults to user scope and generates a plugin root plus canonical Codex skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-user-plugin-"));
  const userHome = join(dir, "home");
  const userPlugins = join(userHome, "plugins");
  const userMarketplace = join(userHome, ".agents", "plugins", "marketplace.json");
  const codexHome = join(dir, "codex-home");

  const child = spawn(process.execPath, [cliEntry, "plugin-bootstrap"], {
    cwd: dir,
    env: { ...process.env, HOME: userHome, CODEX_HOME: codexHome },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.scope, "user");
  assert.equal(payload.marketplaceFile, userMarketplace);
  assert.equal(payload.skillPath, join(codexHome, "skills", "codex-channels"));

  const marketplace = JSON.parse(await readFile(userMarketplace, "utf8")) as { plugins: Array<{ name: string; source: { path: string } }> };
  assert.equal(marketplace.plugins[0]?.name, "codex-channels");
  assert.equal(marketplace.plugins[0]?.source.path, "./plugins/codex-channels");

  const pluginRoot = join(userPlugins, "codex-channels");
  assert.equal(Boolean((await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")).length), true);
  assert.equal(Boolean((await readFile(join(pluginRoot, ".mcp.json"), "utf8")).length), true);
  assert.equal(Boolean((await readFile(join(pluginRoot, "skills", "codex-channels", "SKILL.md"), "utf8")).length), true);

  const canonicalSkill = join(codexHome, "skills", "codex-channels", "SKILL.md");
  const canonicalContent = await readFile(canonicalSkill, "utf8");
  assert.match(canonicalContent, /codex-channels plugin-bootstrap/);

  await rm(dir, { recursive: true, force: true });
});

test("help output keeps first-run commands ahead of lower-level bridge commands and mentions self-update", async () => {
  const child = spawn(process.execPath, [cliEntry, "--no-update-check"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const doctorIndex = stdout.indexOf("doctor");
  const demoIndex = stdout.indexOf("demo");
  const inspectIndex = stdout.indexOf("inspect");
  const replyIndex = stdout.indexOf("reply");
  const selfUpdateIndex = stdout.indexOf("self-update");
  const bridgeIndex = stdout.indexOf("bridge-stdio");
  assert.ok(doctorIndex >= 0);
  assert.ok(demoIndex >= 0);
  assert.ok(inspectIndex >= 0);
  assert.ok(replyIndex >= 0);
  assert.ok(selfUpdateIndex >= 0);
  assert.ok(bridgeIndex >= 0);
  assert.ok(doctorIndex < bridgeIndex);
  assert.ok(demoIndex < bridgeIndex);
  assert.ok(inspectIndex < bridgeIndex);
  assert.ok(replyIndex < bridgeIndex);
  assert.ok(selfUpdateIndex < bridgeIndex);
});

test("self-update --yes runs the configured updater for published installs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-self-update-"));
  const stateFile = join(dir, "update-state.json");
  const marker = join(dir, "updated.txt");
  const updater = join(dir, "fake-update.mjs");
  await writeFile(updater, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ok');`, "utf8");

  const child = spawn(process.execPath, [cliEntry, "self-update", "--yes"], {
    cwd: dir,
    env: {
      ...process.env,
      CODEX_CHANNELS_UPDATE_STATE_FILE: stateFile,
      CODEX_CHANNELS_LATEST_VERSION: "0.1.99",
      CODEX_CHANNELS_INSTALL_CONTEXT: "published-package",
      CODEX_CHANNELS_UPDATE_COMMAND: process.execPath,
      CODEX_CHANNELS_UPDATE_ARGS: updater,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /Updated codex-channels to v0.1.99/);
  assert.equal(await readFile(marker, "utf8"), "ok");

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

  const child = spawn(process.execPath, [cliEntry, "doctor", "--port", String(port), "--state-file", stateFile, "--no-update-check"], {
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
  assert.match(payload.next[0], /pending|demo/);

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
    assert.match(stdout, /reply-latest/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
