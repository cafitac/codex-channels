#!/usr/bin/env node
import { mkdir, readFile, writeFile, lstat, symlink, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { LocalHttpChannelServer, LocalMemoryBackend } from "@cafitac/codex-channels-backend-local";
import { InteractionRuntime, createInteraction } from "@cafitac/codex-channels-core";
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

async function ensurePluginSourcePath(scope: string, requestedPluginPath: string | null): Promise<string> {
  if (requestedPluginPath) return requestedPluginPath;
  if (scope === "workspace") {
    const linkPath = resolve("plugins/codex-channels");
    await mkdir(dirname(linkPath), { recursive: true });
    try {
      const stat = await lstat(linkPath);
      if (stat.isSymbolicLink()) {
        await unlink(linkPath);
      }
    } catch {}
    await symlink(resolve('.'), linkPath, 'dir');
    return './plugins/codex-channels';
  }
  const userPluginsDir = resolve(homedir(), 'plugins');
  const linkPath = resolve(userPluginsDir, 'codex-channels');
  await mkdir(dirname(linkPath), { recursive: true });
  try {
    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink()) {
      await unlink(linkPath);
    }
  } catch {}
  await symlink(resolve('.'), linkPath, 'dir');
  return './plugins/codex-channels';
}

async function runPluginBootstrap(argv: string[]) {
  const scope = readFlag(argv, "--scope", "workspace");
  const requestedPluginPath = argv.includes('--plugin-path') ? readFlag(argv, '--plugin-path', '') : null;
  const pluginPath = await ensurePluginSourcePath(scope, requestedPluginPath);
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

  console.log(`codex-channels\n\nCommands:\n  serve             Start the local-first HTTP runtime\n  status            Query a running local runtime\n  bridge-stdio      Run the Codex interaction bridge over stdin/stdout while hosting a local channel runtime\n  bridge-spawn      Start the local runtime and spawn a Codex app-server-compatible child process to bridge interactive requests\n  plugin-bootstrap  Write a Codex marketplace entry for the plugin wrapper\n\nFlags:\n  --host <host>              Bind/query host (default 127.0.0.1)\n  --port <port>              Bind/query port (default 4317)\n  --state-file <path>        File-backed interaction state (default .codex-channels/state.json)\n  --timeout-ms <ms>          Bridge interaction timeout (default 300000)\n  --codex-command <cmd>      Command used by bridge-spawn (default codex)\n  --codex-arg <arg>          Additional argument for bridge-spawn; may be repeated\n  --spawn-mode <mode>        app-server | raw (default app-server)\n  --scope <scope>            plugin-bootstrap scope: workspace | user\n  --plugin-path <path>       plugin-bootstrap source path\n  --marketplace-file <path>  plugin-bootstrap target marketplace.json\n  --quiet                    Suppress bridge startup metadata on stderr`);
}

main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
