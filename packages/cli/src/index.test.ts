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
  assert.match(stdout, /Next: codex-channels plugin-bootstrap/);
  assert.equal(await readFile(marker, "utf8"), "ok");

  await rm(dir, { recursive: true, force: true });
});

test("doctor reports installed and latest versions plus update guidance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-doctor-update-"));
  const stateFile = join(dir, "state.json");

  const child = spawn(process.execPath, [cliEntry, "doctor", "--state-file", stateFile, "--no-update-check"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_CHANNELS_LATEST_VERSION: "9.9.9", CODEX_CHANNELS_INSTALL_CONTEXT: "published-package", CODEX_CHANNELS_UPDATE_STATE_FILE: join(dir, "update-state.json") },
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim()) as { installedVersion?: string|null; latestVersion?: string|null; updateAvailable?: boolean|null; updateNext?: string[] };
  assert.equal(typeof payload.installedVersion, "string");
  assert.equal(payload.latestVersion, "9.9.9");
  assert.equal(payload.updateAvailable, true);
  assert.match(payload.updateNext?.[0] ?? "", /npm install -g/);
  assert.match(payload.updateNext?.[1] ?? "", /plugin-bootstrap/);

  await rm(dir, { recursive: true, force: true });
});

test("plugin-bootstrap prints an update hint to stderr when a newer version exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-bootstrap-update-hint-"));
  const marketplaceFile = join(dir, ".agents", "plugins", "marketplace.json");

  const child = spawn(process.execPath, [cliEntry, "plugin-bootstrap", "--scope", "workspace", "--plugin-path", ".", "--marketplace-file", marketplaceFile], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_CHANNELS_LATEST_VERSION: "9.9.9", CODEX_CHANNELS_INSTALL_CONTEXT: "published-package", CODEX_CHANNELS_UPDATE_STATE_FILE: join(dir, "update-state.json") },
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stderr, /\[CODEX-CHANNELS\] Update available:/);
  assert.match(stderr, /plugin-bootstrap/);

  await rm(dir, { recursive: true, force: true });
});

test("buildSelfUpdatePlan auto-runs for published installs and falls back for source checkouts", () => {
  const published = buildSelfUpdatePlan({
    currentVersion: "0.1.10",
    latestVersion: "0.1.11",
    stateFile: "/tmp/state.json",
    installContext: "published-package",
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(published.canAutoRun, true);
  assert.deepEqual(published.args, ["install", "-g", "@cafitac/codex-channels@latest"]);

  const source = buildSelfUpdatePlan({
    currentVersion: "0.1.10",
    latestVersion: "0.1.11",
    stateFile: "/tmp/state.json",
    installContext: "source-checkout",
    checkedAt: "2026-01-01T00:00:00.000Z",
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
    env: { ...process.env, CODEX_CHANNELS_HEALTHCHECK_ERROR: "simulated probe failure" },
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








test("operator-status reports probe failures without pretending the runtime is definitely down", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-operator-probe-fail-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "operator-status", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_CHANNELS_HEALTHCHECK_ERROR: "simulated probe failure" },
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /runtime: probe failed from this execution context/);
  assert.match(stdout, /note: the runtime may still be alive/);

  await rm(dir, { recursive: true, force: true });
});

test("next-step reports probe failure guidance instead of running blindly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-next-step-probe-fail-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "next-step", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_CHANNELS_HEALTHCHECK_ERROR: "simulated probe failure" },
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /runtime probe failed from this execution context/);
  assert.match(stdout, /retry from a shell/);

  await rm(dir, { recursive: true, force: true });
});

test("operator-status respects source and kind filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-operator-filter-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({
    interactions: [
      {
        id: "demo-request",
        kind: "user_input_request",
        source: { type: "system", name: "codex-channels-demo" },
        payload: { message: "Demo request" },
        createdAt: "2026-01-01T00:00:02.000Z",
        status: "pending",
      },
      {
        id: "other-request",
        kind: "approval_request",
        source: { type: "system", name: "other-source" },
        payload: { message: "Other request" },
        createdAt: "2026-01-01T00:00:03.000Z",
        status: "pending",
      }
    ]
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "operator-status", "--state-file", stateFile, "--source", "codex-channels-demo", "--kind", "user_input_request"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /demo-request/);
  assert.equal(stdout.includes("other-request"), false);

  await rm(dir, { recursive: true, force: true });
});

test("follow can scope to a specific interaction id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-follow-focus-"));
  const stateFile = join(dir, "state.json");
  const port = await getFreePort();

  await writeFile(stateFile, JSON.stringify({
    interactions: [
      {
        id: "follow-target",
        kind: "user_input_request",
        source: { type: "system", name: "test" },
        payload: { message: "Target request" },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      },
      {
        id: "follow-other",
        kind: "user_input_request",
        source: { type: "system", name: "test" },
        payload: { message: "Other request" },
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

    const child = spawn(process.execPath, [cliEntry, "follow", "--state-file", stateFile, "--port", String(port), "--focus-id", "follow-target", "--text", "staging", "--timeout-ms", "50"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0);
    assert.match(stdout, /auto-resolving follow-target/);
    assert.equal(stdout.includes("follow-other"), false);
  } finally {
    serverChild.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("follow resolves the next actionable interaction when text is provided", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-follow-"));
  const stateFile = join(dir, "state.json");
  const port = await getFreePort();

  await writeFile(stateFile, JSON.stringify({
    interactions: [{
      id: "follow-request",
      kind: "user_input_request",
      source: { type: "system", name: "test" },
      payload: { message: "Need an answer" },
      createdAt: "2026-01-01T00:00:01.000Z",
      status: "pending",
    }]
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

    const child = spawn(process.execPath, [cliEntry, "follow", "--state-file", stateFile, "--port", String(port), "--text", "staging", "--timeout-ms", "50"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0);
    assert.match(stdout, /auto-resolving follow-request/);
  } finally {
    serverChild.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("watch reports the first summary once and ends quietly when nothing changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-watch-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "watch", "--state-file", stateFile, "--interval-ms", "10", "--timeout-ms", "40"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.equal((stdout.match(/state file:/g) ?? []).length, 1);
  assert.match(stdout, /\[CODEX-CHANNELS\] initial summary/);
  assert.match(stdout, /\[CODEX-CHANNELS\] hint:/);
  assert.match(stdout, /watch ended/);

  await rm(dir, { recursive: true, force: true });
});


test("watch only prints again when the operator state actually changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-watch-change-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "watch", "--state-file", stateFile, "--interval-ms", "20", "--timeout-ms", "120"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  setTimeout(async () => {
    await writeFile(stateFile, JSON.stringify({
      interactions: [{
        id: "pending-request",
        kind: "user_input_request",
        source: { type: "system", name: "test" },
        payload: { message: "Need an answer" },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      }]
    }), "utf8");
  }, 30);

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /\[CODEX-CHANNELS\] initial summary/);
  assert.match(stdout, /pending-request/);
  const summaryCount = (stdout.match(/state file:/g) ?? []).length;
  assert.ok(summaryCount >= 1 && summaryCount <= 2);
  if (summaryCount === 2) {
    assert.match(stdout, /\[CODEX-CHANNELS\] new actionable interaction detected/);
    assert.match(stdout, /\[CODEX-CHANNELS\] hint:/);
  }

  await rm(dir, { recursive: true, force: true });
});

test("watch --json emits the summary payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-watch-json-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "watch", "--state-file", stateFile, "--interval-ms", "10", "--timeout-ms", "20", "--json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /"ok": true/);
  assert.match(stdout, /"change": "initial summary"/);
  assert.match(stdout, /"hint":/);

  await rm(dir, { recursive: true, force: true });
});

test("next-step --json returns the next recommended command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-next-step-json-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "next-step", "--state-file", stateFile, "--json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim()) as { ok?: boolean; next?: string | null };
  assert.equal(payload.ok, true);
  assert.match(payload.next ?? "", /demo|serve|retry from a shell/);

  await rm(dir, { recursive: true, force: true });
});

test("next-step explains when reply text is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-next-step-missing-text-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({
    interactions: [{
      id: "pending-request",
      kind: "user_input_request",
      source: { type: "system", name: "test" },
      payload: { message: "Need a value" },
      createdAt: "2026-01-01T00:00:01.000Z",
      status: "pending",
    }]
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "next-step", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_CHANNELS_HEALTHCHECK_ERROR: "simulated probe failure" },
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /requires a reply text|runtime probe failed from this execution context/);
  assert.match(stdout, /next-step --text staging|retry from a shell/);

  await rm(dir, { recursive: true, force: true });
});


test("operator-status shows the latest overall interaction even when the newest actionable item is older", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-operator-latest-overall-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({
    interactions: [
      {
        id: "older-actionable",
        kind: "user_input_request",
        source: { type: "system", name: "codex-channels-demo" },
        payload: { message: "Older actionable" },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      },
      {
        id: "newer-resolved",
        kind: "user_input_request",
        source: { type: "system", name: "codex-channels-demo" },
        payload: { message: "Newer resolved" },
        createdAt: "2026-01-01T00:00:02.000Z",
        status: "resolved",
      }
    ]
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "operator-status", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /latest actionable: older-actionable/);
  assert.match(stdout, /latest overall: newer-resolved/);
  assert.match(stdout, /status: resolved/);

  await rm(dir, { recursive: true, force: true });
});
test("operator-status summarizes reachability, actionable work, and next steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-operator-status-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({
    interactions: [
      {
        id: "bootstrap-preview",
        kind: "progress_update",
        source: { type: "system", name: "codex-channels" },
        payload: { message: "ready" },
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "delivered",
      },
      {
        id: "actionable-request",
        kind: "user_input_request",
        source: { type: "system", name: "test" },
        payload: { message: "Need an answer" },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      }
    ]
  }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "operator-status", "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_CHANNELS_HEALTHCHECK_ERROR: "simulated probe failure" },
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /runtime: (reachable|not reachable|probe failed from this execution context)/);
  assert.match(stdout, /actionable interactions: 1/);
  assert.match(stdout, /latest actionable: actionable-request/);
  assert.match(stdout, /latest overall: actionable-request/);
  assert.match(stdout, /codex-channels reply-latest|codex-channels demo|codex-channels serve/);

  await rm(dir, { recursive: true, force: true });
});


test("operator-status --json preserves the machine-readable summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-operator-status-json-"));
  const stateFile = join(dir, "state.json");
  await writeFile(stateFile, JSON.stringify({ interactions: [] }), "utf8");

  const child = spawn(process.execPath, [cliEntry, "operator-status", "--state-file", stateFile, "--json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim()) as { ok?: boolean; actionableCount?: number; latestInteraction?: unknown; latestOverallInteraction?: unknown; next?: string[] };
  assert.equal(payload.ok, true);
  assert.equal(payload.actionableCount, 0);
  assert.equal(payload.latestInteraction, null);
  assert.equal(payload.latestOverallInteraction, null);
  assert.equal(Array.isArray(payload.next), true);

  await rm(dir, { recursive: true, force: true });
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
  const operatorStatusSkill = join(dir, ".codex", "skills", "operator-status", "SKILL.md");
  const watchSkill = join(dir, ".codex", "skills", "channels-watch", "SKILL.md");
  const followSkill = join(dir, ".codex", "skills", "channels-follow", "SKILL.md");
  assert.equal(Boolean((await readFile(workspaceSkill, "utf8")).length), true);
  assert.equal(Boolean((await readFile(operatorStatusSkill, "utf8")).length), true);
  assert.equal(Boolean((await readFile(watchSkill, "utf8")).length), true);
  assert.equal(Boolean((await readFile(followSkill, "utf8")).length), true);

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
  assert.equal(Array.isArray(payload.installedSkills), true);
  assert.ok(payload.installedSkills.includes(join(codexHome, "skills", "operator-status")));
  assert.ok(payload.installedSkills.includes(join(codexHome, "skills", "channels-watch")));
  assert.ok(payload.installedSkills.includes(join(codexHome, "skills", "channels-follow")));

  const marketplace = JSON.parse(await readFile(userMarketplace, "utf8")) as { plugins: Array<{ name: string; source: { path: string } }> };
  assert.equal(marketplace.plugins[0]?.name, "codex-channels");
  assert.equal(marketplace.plugins[0]?.source.path, "./plugins/codex-channels");

  const pluginRoot = join(userPlugins, "codex-channels");
  assert.equal(Boolean((await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")).length), true);
  assert.equal(Boolean((await readFile(join(pluginRoot, ".mcp.json"), "utf8")).length), true);
  assert.equal(Boolean((await readFile(join(pluginRoot, "skills", "codex-channels", "SKILL.md"), "utf8")).length), true);

  const canonicalSkill = join(codexHome, "skills", "codex-channels", "SKILL.md");
  const operatorStatusCanonical = join(codexHome, "skills", "operator-status", "SKILL.md");
  const canonicalContent = await readFile(canonicalSkill, "utf8");
  const operatorStatusContent = await readFile(operatorStatusCanonical, "utf8");
  assert.match(canonicalContent, /codex-channels plugin-bootstrap/);
  assert.match(canonicalContent, /codex-channels pending/);
  assert.match(canonicalContent, /reply-latest/);
  assert.match(canonicalContent, /next-step/);
  assert.match(canonicalContent, /channels-watch/);
  assert.match(canonicalContent, /channels-follow/);
  assert.match(canonicalContent, /--source/);
  assert.match(canonicalContent, /--focus-id/);
  assert.match(canonicalContent, /Execution-first rule/);
  assert.match(operatorStatusContent, /\[CODEX-CHANNELS\]/);
  assert.match(canonicalContent, /\$codex-channels doctor/);
  assert.match(canonicalContent, /Codex operator mode/);
  assert.match(canonicalContent, /If the user asks whether the runtime is ready/);

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
  assert.match(stdout, /Next: codex-channels plugin-bootstrap/);
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

test("submit reuses an already running runtime instead of rebinding the port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-submit-reuse-"));
  const stateFile = join(dir, "state.json");
  const interactionFile = join(dir, "interaction.json");
  const port = await getFreePort();

  await writeFile(interactionFile, JSON.stringify({
    id: "submit-reuse-1",
    kind: "approval_request",
    source: { type: "runtime", name: "reuse-test" },
    payload: { message: "Reuse running runtime?" },
    createdAt: new Date().toISOString(),
    status: "pending",
  }), "utf8");

  const server = spawn(process.execPath, [cliEntry, "serve", "--port", String(port), "--state-file", stateFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverStdout = "";
  server.stdout.on("data", (chunk) => {
    serverStdout += chunk.toString();
  });

  let submit: ReturnType<typeof spawn> | null = null;
  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    }, 2000, () => `serve runtime never became healthy: ${serverStdout}`);

    submit = spawn(process.execPath, [cliEntry, "submit", "--port", String(port), "--state-file", stateFile, "--interaction-file", interactionFile, "--timeout-ms", "10000"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(submit.stdout);
    assert.ok(submit.stderr);

    let submitStdout = "";
    let submitStderr = "";
    submit.stdout.on("data", (chunk) => {
      submitStdout += chunk.toString();
    });
    submit.stderr.on("data", (chunk) => {
      submitStderr += chunk.toString();
    });

    await waitFor(async () => {
      const interactionsResponse = await fetch(`http://127.0.0.1:${port}/interactions`);
      const interactionsJson = await interactionsResponse.json() as { interactions: Array<{ id: string }> };
      return interactionsJson.interactions.some((item) => item.id === "submit-reuse-1");
    }, 2000, () => `submit interaction never appeared on reused runtime: ${serverStdout}`);

    const respondResponse = await fetch(`http://127.0.0.1:${port}/interactions/submit-reuse-1/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "text", values: ["yes"] }),
    });
    assert.equal(respondResponse.ok, true);

    const submitProc = submit;
    assert.ok(submitProc);
    const submitExit = await new Promise<number | null>((resolve) => submitProc.once("exit", resolve));
    assert.equal(submitExit, 0, `submit stderr: ${submitStderr}`);
    assert.equal(submitStderr.includes("EADDRINUSE"), false, `unexpected port conflict: ${submitStderr}`);

    const payload = JSON.parse(submitStdout.trim());
    assert.deepEqual(payload, {
      ok: true,
      response: {
        interactionId: "submit-reuse-1",
        action: "text",
        values: ["yes"],
        respondedAt: payload.response.respondedAt,
      },
    });
  } finally {
    server.kill();
    submit?.kill();
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
