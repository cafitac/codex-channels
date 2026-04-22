#!/usr/bin/env node
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { LocalHttpChannelServer, LocalMemoryBackend } from "@cafitac/codex-channels-backend-local";
import { Interaction, InteractionRuntime, InteractionStatus, createInteraction } from "@cafitac/codex-channels-core";
import { JsonFileInteractionPersistence } from "@cafitac/codex-channels-persistence-file";
import { CodexInteractionBridge, CodexJsonRpcLoop, SpawnedCodexAppServerLoop } from "@cafitac/codex-channels-transport-codex-app-server";

function readFlag(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return fallback;
}

function readFlags(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function createPersistence(argv: string[]) {
  const file = readFlag(argv, "--state-file", process.env.CODEX_CHANNELS_STATE_FILE ?? ".codex-channels/state.json");
  return new JsonFileInteractionPersistence(file);
}

async function createRuntime(argv: string[]) {
  const persistence = createPersistence(argv);
  await mkdir(dirname(persistence.filePath), { recursive: true });
  const runtime = await InteractionRuntime.create({ backend: new LocalMemoryBackend(), persistence });
  return { runtime, persistence };
}

async function ensureBootstrap(runtime: InteractionRuntime) {
  if (!runtime.registry.get("bootstrap-preview")) {
    await runtime.publish(createInteraction({
      id: "bootstrap-preview",
      kind: "progress_update",
      source: { type: "system", name: "codex-channels" },
      payload: { message: "codex-channels local runtime is ready" },
    }));
  }
}

async function startLocalRuntime(argv: string[]) {
  const port = Number(readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"));
  const host = readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1");
  const { runtime, persistence } = await createRuntime(argv);
  const server = new LocalHttpChannelServer(runtime);
  await ensureBootstrap(runtime);
  const info = await server.start({ host, port });
  return { runtime, persistence, server, info };
}

async function runServe(argv: string[]) {
  const { runtime, persistence, server, info } = await startLocalRuntime(argv);
  console.log(JSON.stringify({ ok: true, mode: "local-first", backend: runtime.backend.name, stateFile: persistence.filePath, ...info }, null, 2));

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runStatus(argv: string[]) {
  const port = Number(readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"));
  const host = readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1");
  const response = await fetch(`http://${host}:${port}/health`);
  if (!response.ok) {
    throw new Error(`failed to query local channel runtime: ${response.status}`);
  }
  console.log(JSON.stringify(await response.json(), null, 2));
}

async function loadStateInteractions(argv: string[]) {
  const persistence = createPersistence(argv);
  try {
    const raw = await readFile(persistence.filePath, "utf8");
    const parsed = JSON.parse(raw) as { interactions?: Interaction[] };
    return { filePath: persistence.filePath, interactions: parsed.interactions ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { filePath: persistence.filePath, interactions: [] };
    }
    throw error;
  }
}

async function runInspect(argv: string[]) {
  const id = readFlag(argv, "--id", "");
  const statusFilter = readFlag(argv, "--status", "");
  const { filePath, interactions } = await loadStateInteractions(argv);
  const filtered = interactions.filter((item) => {
    if (id && item.id !== id) return false;
    if (statusFilter && item.status !== statusFilter as InteractionStatus) return false;
    return true;
  });

  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify({ stateFile: filePath, count: filtered.length, interactions: filtered }, null, 2));
    return;
  }

  console.log(`state file: ${filePath}`);
  if (filtered.length === 0) {
    console.log("no interactions found");
    return;
  }

  for (const interaction of filtered) {
    const summary = interaction.payload.message.replace(/\s+/g, " ").slice(0, 80);
    console.log(`- ${interaction.id}`);
    console.log(`  kind: ${interaction.kind}`);
    console.log(`  status: ${interaction.status}`);
    console.log(`  source: ${interaction.source.name}`);
    console.log(`  message: ${summary}`);
  }
}

async function runReply(argv: string[]) {
  const interactionId = readFlag(argv, "--id", "");
  if (!interactionId) {
    throw new Error("reply requires --id <interaction-id>");
  }

  const host = readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1");
  const port = Number(readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"));
  const text = readFlag(argv, "--text", "");
  const reason = readFlag(argv, "--reason", "");
  const action = hasFlag(argv, "--accept")
    ? "accept"
    : hasFlag(argv, "--decline")
      ? "decline"
      : hasFlag(argv, "--cancel")
        ? "cancel"
        : "text";

  const url = action === "cancel"
    ? `http://${host}:${port}/interactions/${interactionId}/cancel`
    : `http://${host}:${port}/interactions/${interactionId}/respond`;

  const body = action === "cancel"
    ? { reason: reason || text || "cancelled via codex-channels reply" }
    : { action, values: text ? [text] : [] };

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`failed to reply to interaction: ${response.status}`);
  }
  console.log(JSON.stringify(await response.json(), null, 2));
}

async function runDoctor(argv: string[]) {
  const { filePath, interactions } = await loadStateInteractions(argv);
  const host = readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1");
  const port = Number(readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"));
  let runtimeHealth: Record<string, unknown> | null = null;
  let runtimeReachable = false;
  try {
    const response = await fetch(`http://${host}:${port}/health`);
    if (response.ok) {
      runtimeReachable = true;
      runtimeHealth = await response.json() as Record<string, unknown>;
    }
  } catch {
    runtimeReachable = false;
  }

  const payload = {
    ok: true,
    nodeVersion: process.version,
    stateFile: filePath,
    interactionCount: interactions.length,
    runtime: {
      reachable: runtimeReachable,
      host,
      port,
      health: runtimeHealth,
    },
    next: runtimeReachable
      ? [
          "codex-channels inspect",
          "codex-channels demo",
        ]
      : [
          "codex-channels demo",
          "codex-channels serve --port 4317 --state-file .codex-channels/state.json",
        ],
  };

  console.log(JSON.stringify(payload, null, 2));
}

async function runDemo(argv: string[]) {
  const timeoutMs = Number(readFlag(argv, "--timeout-ms", process.env.CODEX_CHANNELS_TIMEOUT_MS ?? "300000"));
  const { runtime, persistence, server, info } = await startLocalRuntime(argv);
  const interaction = createInteraction({
    id: `demo-${Date.now()}`,
    kind: "user_input_request",
    source: { type: "system", name: "codex-channels-demo" },
    payload: {
      message: "Which environment should we deploy to?",
      options: [
        { label: "staging", value: "staging" },
        { label: "prod", value: "prod" },
      ],
    },
    policy: { allowFreeText: true, timeoutSec: Math.floor(timeoutMs / 1000) },
  });

  console.log(`codex-channels demo is running at ${info.url}`);
  console.log(`interaction: ${interaction.id}`);
  console.log("Try in another terminal:");
  console.log(`  codex-channels inspect --state-file ${persistence.filePath}`);
  console.log(`  codex-channels reply --id ${interaction.id} --text staging --port ${info.port}`);

  try {
    const response = await runtime.publishAndWait(interaction, timeoutMs);
    console.log(JSON.stringify({ ok: true, interactionId: interaction.id, response }, null, 2));
  } finally {
    await server.stop();
  }
}

async function runBridgeStdio(argv: string[]) {
  const timeoutMs = Number(readFlag(argv, "--timeout-ms", process.env.CODEX_CHANNELS_TIMEOUT_MS ?? "300000"));
  const { runtime, persistence, server, info } = await startLocalRuntime(argv);

  if (!hasFlag(argv, "--quiet")) {
    process.stderr.write(`${JSON.stringify({ ok: true, command: "bridge-stdio", stateFile: persistence.filePath, ...info })}\n`);
  }

  const bridge = new CodexInteractionBridge(runtime, { timeoutMs });
  const loop = new CodexJsonRpcLoop(bridge, process.stdin, process.stdout);

  const shutdown = async () => {
    loop.close();
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await loop.run();
  await server.stop();
}

async function runBridgeSpawn(argv: string[]) {
  const timeoutMs = Number(readFlag(argv, "--timeout-ms", process.env.CODEX_CHANNELS_TIMEOUT_MS ?? "300000"));
  const codexCommand = readFlag(argv, "--codex-command", process.env.CODEX_CHANNELS_CODEX_COMMAND ?? "codex");
  const codexArgs = readFlags(argv, "--codex-arg");
  const spawnMode = readFlag(argv, "--spawn-mode", "app-server") as "app-server" | "raw";
  const { runtime, persistence, server, info } = await startLocalRuntime(argv);
  const bridge = new CodexInteractionBridge(runtime, { timeoutMs });
  const spawned = new SpawnedCodexAppServerLoop(bridge, {
    command: codexCommand,
    extraArgs: codexArgs,
    mode: spawnMode,
  });

  if (!hasFlag(argv, "--quiet")) {
    process.stderr.write(`${JSON.stringify({ ok: true, command: "bridge-spawn", stateFile: persistence.filePath, codexCommand, codexArgs, spawnMode, ...info })}\n`);
  }

  const shutdown = async () => {
    spawned.stop();
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await spawned.start();
  await server.stop();
}

async function runSubmit(argv: string[]) {
  const timeoutMs = Number(readFlag(argv, "--timeout-ms", process.env.CODEX_CHANNELS_TIMEOUT_MS ?? "300000"));
  const interactionFile = readFlag(argv, "--interaction-file", "");
  if (!interactionFile) {
    throw new Error("submit requires --interaction-file <path>");
  }

  const raw = await readFile(interactionFile, "utf8");
  const interaction = JSON.parse(raw);
  const { runtime, server } = await startLocalRuntime(argv);
  try {
    const response = await runtime.publishAndWait(interaction, timeoutMs);
    console.log(JSON.stringify({ ok: true, response }));
  } finally {
    await server.stop();
  }
}

type MarketplacePlugin = {
  name: string;
  source: { source: "local"; path: string };
  policy: { installation: "AVAILABLE"; authentication: "ON_INSTALL" };
  category: "Coding";
};

type MarketplaceFile = {
  name: string;
  interface: { displayName: string };
  plugins: MarketplacePlugin[];
};

async function writeGeneratedPluginRoot(targetDir: string, cliEntry: string, runtime: { host: string; port: string; stateFile: string }) {
  const pluginDir = resolve(targetDir);
  await mkdir(resolve(pluginDir, ".codex-plugin"), { recursive: true });
  await mkdir(resolve(pluginDir, "skills", "codex-channels"), { recursive: true });

  const pluginManifest = {
    name: "codex-channels",
    version: "0.1.0",
    description: "Local-first interaction runtime for Codex-first workflows.",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      displayName: "codex-channels",
      shortDescription: "Local-first interaction runtime for Codex",
      category: "Coding",
      capabilities: ["Interactive", "Write"],
    },
  };

  const mcp = {
    mcpServers: {
      "codex-channels-local": {
        command: "node",
        args: [
          cliEntry,
          "bridge-stdio",
          "--quiet",
          "--host",
          runtime.host,
          "--port",
          runtime.port,
          "--state-file",
          runtime.stateFile,
        ],
        env: {
          CODEX_CHANNELS_HOST: runtime.host,
          CODEX_CHANNELS_PORT: runtime.port,
          CODEX_CHANNELS_STATE_FILE: runtime.stateFile,
        },
      },
    },
  };

  const skill = `---\nname: codex-channels\ndescription: Use the local codex-channels runtime for Codex-first interaction routing.\n---\n\n# codex-channels\n\nUse this plugin when you want to demo, inspect, or reply to local Codex-channel interactions.\n`;

  await writeFile(resolve(pluginDir, ".codex-plugin", "plugin.json"), JSON.stringify(pluginManifest, null, 2) + "\n", "utf8");
  await writeFile(resolve(pluginDir, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n", "utf8");
  await writeFile(resolve(pluginDir, "skills", "codex-channels", "SKILL.md"), skill, "utf8");

  return pluginDir;
}

async function readMarketplace(path: string, fallbackName: string, fallbackDisplayName: string): Promise<MarketplaceFile> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as MarketplaceFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        name: fallbackName,
        interface: { displayName: fallbackDisplayName },
        plugins: [],
      };
    }
    throw error;
  }
}

async function ensurePluginSourcePath(scope: string, requestedPluginPath: string | null, cliEntry: string, runtime: { host: string; port: string; stateFile: string }): Promise<string> {
  if (requestedPluginPath) {
    await writeGeneratedPluginRoot(requestedPluginPath, cliEntry, runtime);
    return requestedPluginPath;
  }
  if (scope === "workspace") {
    const linkPath = resolve("plugins/codex-channels");
    await rm(linkPath, { recursive: true, force: true });
    await writeGeneratedPluginRoot(linkPath, cliEntry, runtime);
    return './plugins/codex-channels';
  }
  const userPluginsDir = resolve(homedir(), 'plugins');
  const linkPath = resolve(userPluginsDir, 'codex-channels');
  await rm(linkPath, { recursive: true, force: true });
  await writeGeneratedPluginRoot(linkPath, cliEntry, runtime);
  return './plugins/codex-channels';
}

async function runPluginBootstrap(argv: string[]) {
  const scope = readFlag(argv, "--scope", "user");
  const requestedPluginPath = argv.includes('--plugin-path') ? readFlag(argv, '--plugin-path', '') : null;
  const cliEntry = resolve(process.argv[1] ?? "./dist/index.js");
  const pluginPath = await ensurePluginSourcePath(scope, requestedPluginPath, cliEntry, {
    host: readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1"),
    port: readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"),
    stateFile: readFlag(argv, "--state-file", process.env.CODEX_CHANNELS_STATE_FILE ?? ".codex-channels/state.json"),
  });
  const marketplaceFile = readFlag(
    argv,
    "--marketplace-file",
    scope === "workspace"
      ? ".agents/plugins/marketplace.json"
      : resolve(homedir(), ".agents/plugins/marketplace.json"),
  );

  const marketplace = await readMarketplace(
    marketplaceFile,
    scope === "workspace" ? "local-workspace" : "local",
    scope === "workspace" ? "Workspace Plugins" : "Local Plugins",
  );

  const entry: MarketplacePlugin = {
    name: "codex-channels",
    source: { source: "local", path: pluginPath },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Coding",
  };

  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin.name === entry.name);
  if (existingIndex >= 0) marketplace.plugins[existingIndex] = entry;
  else marketplace.plugins.push(entry);

  await mkdir(dirname(marketplaceFile), { recursive: true });
  await writeFile(marketplaceFile, JSON.stringify(marketplace, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({
    ok: true,
    command: "plugin-bootstrap",
    scope,
    marketplaceFile,
    pluginPath,
    pluginCount: marketplace.plugins.length,
  }, null, 2));
}

async function main(argv: string[]) {
  const command = argv[2] ?? "help";

  if (command === "serve") {
    await runServe(argv);
    return;
  }

  if (command === "status") {
    await runStatus(argv);
    return;
  }

  if (command === "doctor") {
    await runDoctor(argv);
    return;
  }

  if (command === "inspect") {
    await runInspect(argv);
    return;
  }

  if (command === "reply") {
    await runReply(argv);
    return;
  }

  if (command === "demo") {
    await runDemo(argv);
    return;
  }

  if (command === "bridge-stdio") {
    await runBridgeStdio(argv);
    return;
  }

  if (command === "bridge-spawn") {
    await runBridgeSpawn(argv);
    return;
  }

  if (command === "plugin-bootstrap") {
    await runPluginBootstrap(argv);
    return;
  }

  if (command === "submit") {
    await runSubmit(argv);
    return;
  }

  console.log(`codex-channels\n\nCommands:\n  doctor            Check the local runtime and show the next useful commands\n  demo              Start a demo interaction and wait for a reply\n  inspect           Read the local interaction state file and list current interactions\n  reply             Reply to one interaction on the running local runtime\n  serve             Start the local-first HTTP runtime\n  status            Query a running local runtime\n  submit            Start the local runtime, publish one interaction, and wait for a response\n  bridge-stdio      Run the Codex interaction bridge over stdin/stdout while hosting a local channel runtime\n  bridge-spawn      Start the local runtime and spawn a Codex app-server-compatible child process to bridge interactive requests\n  plugin-bootstrap  Generate a Codex plugin wrapper and register it in the marketplace\n\nFlags:\n  --host <host>              Bind/query host (default 127.0.0.1)\n  --port <port>              Bind/query port (default 4317)\n  --state-file <path>        File-backed interaction state (default .codex-channels/state.json)\n  --interaction-file <path>  JSON file containing one interaction payload for submit\n  --id <interaction-id>      Target interaction for inspect/reply\n  --status <status>          Filter inspect output by interaction status\n  --text <value>             Reply value for reply/submit flows\n  --accept                   Send an accept reply\n  --decline                  Send a decline reply\n  --cancel                   Cancel the interaction\n  --timeout-ms <ms>          Bridge or demo interaction timeout (default 300000)\n  --codex-command <cmd>      Command used by bridge-spawn (default codex)\n  --codex-arg <arg>          Additional argument for bridge-spawn; may be repeated\n  --spawn-mode <mode>        app-server | raw (default app-server)\n  --scope <scope>            plugin-bootstrap scope: user | workspace (default user)\n  --plugin-path <path>       explicit plugin root to generate and register\n  --marketplace-file <path>  plugin-bootstrap target marketplace.json\n  --json                     Emit JSON output for inspect\n  --quiet                    Suppress bridge startup metadata on stderr`);
}

main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
