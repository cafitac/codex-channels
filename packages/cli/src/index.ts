#!/usr/bin/env node
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { LocalHttpChannelServer, LocalMemoryBackend } from "@cafitac/codex-channels-backend-local";
import { Interaction, InteractionRuntime, InteractionStatus, createInteraction } from "@cafitac/codex-channels-core";
import { JsonFileInteractionPersistence } from "@cafitac/codex-channels-persistence-file";
import { CodexInteractionBridge, CodexJsonRpcLoop, SpawnedCodexAppServerLoop } from "@cafitac/codex-channels-transport-codex-app-server";
import { MenuOption, selectFromMenu, supportsInteractiveMenu } from "./interactive.js";
import { buildSelfUpdatePlan, buildUpdateHintLines, checkForUpdates, dismissVersion, formatUpdateCommand, getLatestVersionSnapshot, runSelfUpdatePlan } from "./updates.js";

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

async function probeLocalRuntime(argv: string[]) {
  const port = Number(readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"));
  const host = readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1");
  try {
    const response = await fetch(`http://${host}:${port}/health`);
    if (!response.ok) return { reachable: false, host, port };
    return { reachable: true, host, port };
  } catch {
    return { reachable: false, host, port };
  }
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


function filterActionableInteractions(interactions: Interaction[]) {
  return interactions.filter((item) => item.kind !== "progress_update" && (item.status === "pending" || item.status === "delivered"));
}

function sortInteractionsNewestFirst(interactions: Interaction[]) {
  return [...interactions].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function summarizeInteraction(interaction: Interaction) {
  return interaction.payload.message.replace(/\s+/g, " ").slice(0, 80);
}

function findLatestActionableInteraction(interactions: Interaction[]) {
  return sortInteractionsNewestFirst(filterActionableInteractions(interactions))[0];
}


function filterInteractionsForScope(interactions: Interaction[], argv: string[]) {
  const idFilter = readFlag(argv, "--focus-id", "");
  const sourceFilter = readFlag(argv, "--source", "").trim().toLowerCase();
  const kindFilter = readFlag(argv, "--kind", "").trim().toLowerCase();
  return interactions.filter((interaction) => {
    if (idFilter && interaction.id !== idFilter) return false;
    if (sourceFilter && interaction.source.name.toLowerCase() !== sourceFilter) return false;
    if (kindFilter && interaction.kind.toLowerCase() !== kindFilter) return false;
    return true;
  });
}


type OperatorSummary = {
  ok: true;
  stateFile: string;
  runtimeReachable: boolean;
  runtimeProbeStatus: "reachable" | "unreachable" | "probe-failed";
  runtimeProbeError: string | null;
  actionableCount: number;
  latestInteraction: {
    id: string;
    kind: string;
    status: string;
    source: string;
    message: string;
  } | null;
  next: string[];
};

async function buildOperatorSummary(argv: string[]): Promise<OperatorSummary> {
  const { filePath, interactions } = await loadStateInteractions(argv);
  const scopedInteractions = filterInteractionsForScope(interactions, argv);
  const pending = sortInteractionsNewestFirst(filterActionableInteractions(scopedInteractions));
  const latest = pending[0];
  const host = readFlag(argv, "--host", process.env.CODEX_CHANNELS_HOST ?? "127.0.0.1");
  const port = Number(readFlag(argv, "--port", process.env.CODEX_CHANNELS_PORT ?? "4317"));
  let runtimeReachable = false;
  let runtimeProbeStatus: OperatorSummary["runtimeProbeStatus"] = "unreachable";
  let runtimeProbeError: string | null = null;
  const simulatedProbeError = process.env.CODEX_CHANNELS_HEALTHCHECK_ERROR?.trim();
  if (simulatedProbeError) {
    runtimeProbeStatus = "probe-failed";
    runtimeProbeError = simulatedProbeError;
  } else {
    try {
      const response = await fetch(`http://${host}:${port}/health`);
      runtimeReachable = response.ok;
      runtimeProbeStatus = response.ok ? "reachable" : "unreachable";
    } catch (error) {
      runtimeReachable = false;
      runtimeProbeStatus = "probe-failed";
      runtimeProbeError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: true,
    stateFile: filePath,
    runtimeReachable,
    runtimeProbeStatus,
    runtimeProbeError,
    actionableCount: pending.length,
    latestInteraction: latest ? {
      id: latest.id,
      kind: latest.kind,
      status: latest.status,
      source: latest.source.name,
      message: summarizeInteraction(latest),
    } : null,
    next: runtimeProbeStatus === "reachable"
      ? (latest
          ? [
              `codex-channels reply-latest --text staging`,
              `codex-channels pending`,
            ]
          : [
              `codex-channels demo`,
              `codex-channels pending`,
            ])
      : runtimeProbeStatus === "probe-failed"
        ? [
            `retry from a shell: codex-channels operator-status --state-file ${filePath} --port ${port}`,
            latest
              ? `or reply from a shell: codex-channels reply-latest --text <value> --state-file ${filePath} --port ${port}`
              : `or start/restart the runtime: codex-channels serve --port ${port} --state-file ${filePath}`,
          ]
        : [
            latest
              ? `codex-channels serve --port ${port} --state-file ${filePath}`
              : `codex-channels demo`,
            `codex-channels serve --port ${port} --state-file ${filePath}`,
          ],
  };
}

function formatOperatorSummary(payload: OperatorSummary) {
  const runtimeLine = payload.runtimeProbeStatus === "reachable"
    ? "runtime: reachable"
    : payload.runtimeProbeStatus === "probe-failed"
      ? "runtime: probe failed from this execution context"
      : "runtime: not reachable";
  const lines = [
    `state file: ${payload.stateFile}`,
    runtimeLine,
    `actionable interactions: ${payload.actionableCount}`,
  ];
  if (payload.runtimeProbeStatus === "probe-failed" && payload.runtimeProbeError) {
    lines.push(`probe error: ${payload.runtimeProbeError}`);
    lines.push("note: the runtime may still be alive in another shell or blocked by sandbox/network policy in this execution context");
  }
  if (payload.latestInteraction) {
    lines.push(`latest: ${payload.latestInteraction.id}`);
    lines.push(`  kind: ${payload.latestInteraction.kind}`);
    lines.push(`  status: ${payload.latestInteraction.status}`);
    lines.push(`  source: ${payload.latestInteraction.source}`);
    lines.push(`  message: ${payload.latestInteraction.message}`);
  } else {
    lines.push("latest: none");
  }
  lines.push("next:");
  for (const step of payload.next) {
    lines.push(`- ${step}`);
  }
  return lines.join("\n");
}

function createOperatorSummarySignature(payload: OperatorSummary) {
  return JSON.stringify({
    runtimeReachable: payload.runtimeReachable,
    runtimeProbeStatus: payload.runtimeProbeStatus,
    runtimeProbeError: payload.runtimeProbeError,
    actionableCount: payload.actionableCount,
    latestInteraction: payload.latestInteraction,
    next: payload.next,
  });
}

function summarizeOperatorChange(previous: OperatorSummary | null, current: OperatorSummary) {
  if (!previous) return "initial summary";
  if (previous.runtimeProbeStatus !== current.runtimeProbeStatus) {
    if (current.runtimeProbeStatus === "reachable") return "runtime became reachable";
    if (current.runtimeProbeStatus === "probe-failed") return "runtime probe failed in this execution context";
    return "runtime became unreachable";
  }
  if (previous.actionableCount !== current.actionableCount) {
    return current.actionableCount > previous.actionableCount ? "new actionable interaction detected" : "actionable interaction resolved";
  }
  if (previous.latestInteraction?.id !== current.latestInteraction?.id) {
    return current.latestInteraction ? `latest interaction changed to ${current.latestInteraction.id}` : "latest actionable interaction cleared";
  }
  if (JSON.stringify(previous.next) !== JSON.stringify(current.next)) {
    return "recommended next step changed";
  }
  return "operator state changed";
}

async function runWatch(argv: string[]) {
  const intervalMs = Number(readFlag(argv, "--interval-ms", process.env.CODEX_CHANNELS_WATCH_INTERVAL_MS ?? "1000"));
  const timeoutMs = Number(readFlag(argv, "--timeout-ms", process.env.CODEX_CHANNELS_WATCH_TIMEOUT_MS ?? "0"));
  const startedAt = Date.now();
  let lastSignature = "";
  let previousPayload: OperatorSummary | null = null;

  while (true) {
    const payload = await buildOperatorSummary(argv);
    const signature = createOperatorSummarySignature(payload);
    if (!previousPayload || signature !== lastSignature) {
      const changeSummary = summarizeOperatorChange(previousPayload, payload);
      const primaryHint = payload.next[0] ?? null;
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({ change: changeSummary, hint: primaryHint, ...payload }, null, 2));
      } else {
        console.log(`[CODEX-CHANNELS] ${changeSummary}`);
        if (primaryHint) console.log(`[CODEX-CHANNELS] hint: ${primaryHint}`);
        console.log(formatOperatorSummary(payload));
      }
      lastSignature = signature;
      previousPayload = payload;
    }

    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      if (!hasFlag(argv, "--json")) console.log("watch ended");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}


async function runFollow(argv: string[]) {
  const intervalMs = Number(readFlag(argv, "--interval-ms", process.env.CODEX_CHANNELS_WATCH_INTERVAL_MS ?? "1000"));
  const timeoutMs = Number(readFlag(argv, "--timeout-ms", process.env.CODEX_CHANNELS_WATCH_TIMEOUT_MS ?? "0"));
  const textValue = readFlag(argv, "--text", "");
  const startedAt = Date.now();
  let lastSignature = "";
  let previousPayload: OperatorSummary | null = null;
  let resolvedInteractionId = "";

  while (true) {
    const payload = await buildOperatorSummary(argv);
    const signature = createOperatorSummarySignature(payload);
    if (!previousPayload || signature !== lastSignature) {
      const changeSummary = summarizeOperatorChange(previousPayload, payload);
      const primaryHint = payload.next[0] ?? null;
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({ change: changeSummary, hint: primaryHint, ...payload }, null, 2));
      } else {
        console.log(`[CODEX-CHANNELS] ${changeSummary}`);
        if (primaryHint) console.log(`[CODEX-CHANNELS] hint: ${primaryHint}`);
        console.log(formatOperatorSummary(payload));
      }
      lastSignature = signature;
      previousPayload = payload;
    }

    if (textValue && payload.runtimeProbeStatus === "reachable" && payload.latestInteraction && payload.latestInteraction.id !== resolvedInteractionId) {
      if (!hasFlag(argv, "--json")) {
        console.log(`[CODEX-CHANNELS] auto-resolving ${payload.latestInteraction.id} with provided text`);
      }
      await runReplyLatest(argv);
      resolvedInteractionId = payload.latestInteraction.id;
      return;
    }

    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      if (!hasFlag(argv, "--json")) console.log("follow ended");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
    const summary = summarizeInteraction(interaction);
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

async function runPending(argv: string[]) {
  const { filePath, interactions } = await loadStateInteractions(argv);
  const scopedInteractions = filterInteractionsForScope(interactions, argv);
  const pending = sortInteractionsNewestFirst(filterActionableInteractions(scopedInteractions));

  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify({ stateFile: filePath, count: pending.length, interactions: pending }, null, 2));
    return;
  }

  console.log(`state file: ${filePath}`);
  if (pending.length === 0) {
    console.log("no pending interactions found");
    return;
  }

  for (const interaction of pending) {
    console.log(`- ${interaction.id}`);
    console.log(`  kind: ${interaction.kind}`);
    console.log(`  status: ${interaction.status}`);
    console.log(`  source: ${interaction.source.name}`);
    console.log(`  message: ${summarizeInteraction(interaction)}`);
  }
}

async function runReplyLatest(argv: string[]) {
  const { interactions } = await loadStateInteractions(argv);
  const latest = findLatestActionableInteraction(filterInteractionsForScope(interactions, argv));
  if (!latest) {
    throw new Error("reply-latest could not find a pending interaction in the state file");
  }

  const nextArgv = argv.includes("--id") ? argv : [...argv, "--id", latest.id];
  await runReply(nextArgv);
}


async function runOperatorStatus(argv: string[]) {
  const payload = await buildOperatorSummary(argv);

  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatOperatorSummary(payload));
}

async function runNextStep(argv: string[]) {
  const payload = await buildOperatorSummary(argv);
  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify({ ok: true, next: payload.next[0] ?? null }, null, 2));
    return;
  }

  if (payload.runtimeProbeStatus === "probe-failed") {
    console.log("runtime probe failed from this execution context.");
    console.log(payload.next[0] ?? `retry from a shell: codex-channels operator-status --state-file ${payload.stateFile}`);
    return;
  }

  if (!payload.runtimeReachable) {
    console.log("running next step: codex-channels demo");
    await runDemo(argv);
    return;
  }

  if (payload.latestInteraction) {
    const text = readFlag(argv, "--text", "");
    if (!text) {
      console.log("next step requires a reply text. Re-run with something like:");
      console.log(`codex-channels next-step --text staging --state-file ${payload.stateFile}`);
      console.log("or run:");
      console.log(payload.next[0] ?? "codex-channels reply-latest --text staging");
      return;
    }
    console.log(`running next step: codex-channels reply-latest --text ${text}`);
    await runReplyLatest(argv);
    return;
  }

  console.log("running next step: codex-channels demo");
  await runDemo(argv);
}

async function runDoctor(argv: string[]) {
  const { filePath, interactions } = await loadStateInteractions(argv);
  const updateSnapshot = await getLatestVersionSnapshot().catch(() => null);
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
    installedVersion: updateSnapshot?.currentVersion ?? null,
    latestVersion: updateSnapshot?.latestVersion ?? null,
    updateAvailable: updateSnapshot ? updateSnapshot.currentVersion !== updateSnapshot.latestVersion : null,
    updateInstallContext: updateSnapshot?.installContext ?? null,
    updateNext: updateSnapshot
      ? (updateSnapshot.currentVersion !== updateSnapshot.latestVersion
          ? [
              updateSnapshot.installContext === "source-checkout"
                ? "git pull && npm install && npm run build"
                : formatUpdateCommand(),
              "codex-channels plugin-bootstrap",
            ]
          : [])
      : [],
    next: runtimeReachable
      ? [
          "codex-channels pending",
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
  console.log(`  codex-channels pending --state-file ${persistence.filePath}`);
  console.log(`  codex-channels reply-latest --state-file ${persistence.filePath} --text staging --port ${info.port}`);
  console.log(`  # or targeted reply: codex-channels reply --id ${interaction.id} --text staging --port ${info.port}`);

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
  const runtimeProbe = await probeLocalRuntime(argv);
  if (runtimeProbe.reachable) {
    const response = await fetch(`http://${runtimeProbe.host}:${runtimeProbe.port}/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interaction, timeoutMs }),
    });
    if (!response.ok) {
      throw new Error(`failed to submit interaction to running local runtime: ${response.status}`);
    }
    const payload = await response.json() as { ok: boolean; response: unknown };
    console.log(JSON.stringify({ ok: true, response: payload.response }));
    return;
  }

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

type SkillDefinition = {
  name: string;
  content: string;
};

function buildCodexChannelsSkillDefinitions(): SkillDefinition[] {
  return [
    { name: "channels-demo", content: `---
name: channels-demo
description: "[CODEX-CHANNELS] Start a local demo interaction and guide the pending/reply loop."
---

# channels-demo

Use this skill when you want to create a real interaction. Run the command first, handle approval/escalation if port binding is required, then guide the user toward pending and reply-latest.

Preferred command:
\`\`\`bash
codex-channels demo
\`\`\`
` },
    { name: "channels-doctor", content: `---
name: channels-doctor
description: "[CODEX-CHANNELS] Check runtime health and summarize the next useful commands."
---

# channels-doctor

Use this skill when you want a structured health check for the local runtime. Run the command first, then summarize reachability, interaction count, and the next suggested commands.

Preferred command:
\`\`\`bash
codex-channels doctor
\`\`\`
` },
    { name: "channels-follow", content: `---
name: channels-follow
description: "[CODEX-CHANNELS] Watch quietly and optionally resolve the next actionable request with provided text."
---

# channels-follow

Use this skill when you want low-noise monitoring that can also close the next actionable request once it appears. Run the command first; if reply text is supplied, the command can resolve the next actionable interaction and exit.

Preferred command:
\`\`\`bash
codex-channels follow --text staging
\`\`\`

Scoped examples:
\`\`\`bash
codex-channels follow --source codex-channels-demo --text staging
codex-channels follow --focus-id demo-1234 --text staging
\`\`\`
` },
    { name: "channels-pending", content: `---
name: channels-pending
description: "[CODEX-CHANNELS] Show actionable interactions newest-first."
---

# channels-pending

Use this skill when you want the actionable queue only. Run the command first, then summarize the latest pending work.

Preferred command:
\`\`\`bash
codex-channels pending
\`\`\`
` },
    { name: "channels-reply-latest", content: `---
name: channels-reply-latest
description: "[CODEX-CHANNELS] Reply to the newest actionable interaction with less shell ceremony."
---

# channels-reply-latest

Use this skill when the user wants to answer the newest request. If reply text is provided, run the command first. If not, ask for the text or explain the exact command to run.

Preferred command:
\`\`\`bash
codex-channels reply-latest --text staging
\`\`\`
` },
    { name: "channels-watch", content: `---
name: channels-watch
description: "[CODEX-CHANNELS] Follow runtime state quietly and only surface meaningful changes."
---

# channels-watch

Use this skill when you want low-noise monitoring instead of repeatedly polling by hand. Run the command first and only summarize changes that actually happened. This should report the initial state once, then only emit another summary when runtime reachability, actionable count, latest interaction, or next-step guidance actually changes. Each emitted summary should also include a compact hint with the current best next command.

Preferred command:
\`\`\`bash
codex-channels watch
\`\`\`

If you want the watch loop to resolve the next actionable request once it appears, use \`channels-follow\` / \`codex-channels follow --text ...\` instead.

Scoped examples:
\`\`\`bash
codex-channels watch --source codex-channels-demo
codex-channels watch --kind user_input_request
codex-channels watch --focus-id demo-1234
\`\`\`
` },
    { name: "codex-channels", content: `---
name: codex-channels
description: "[CODEX-CHANNELS] Set up or operate the local codex-channels runtime for Codex-first interaction routing."
---

# codex-channels

Use this skill when you want to:
- bootstrap the local Codex integration for this machine or workspace
- run the local runtime health/demo flow
- inspect pending interactions without remembering every CLI flag
- reply to the newest interaction with less shell ceremony
- explain how the local runtime fits into Codex workflows

## Execution-first rule

When the user invokes this skill with an obvious subcommand intent, **run the matching \`codex-channels\` command first** instead of only explaining it.

Examples:
- \`$codex-channels doctor\` -> run \`codex-channels doctor\`, then summarize the result.
- \`$codex-channels demo\` -> run \`codex-channels demo\`; if port binding needs approval, request it and continue.
- \`$codex-channels pending\` -> run \`codex-channels pending\` first.
- \`$codex-channels operator-status\` -> run the summary first and use it to choose the next step.
- \`$codex-channels next-step\` -> run the obvious next operator action when it is safe to do so.
- \`$codex-channels reply-latest --text ...\` -> run the command first, then summarize what was resolved.
- \`$codex-channels reply --id ... --text ...\` -> run the targeted reply first.

Only stay explanatory when:
- the user explicitly asks for docs or a summary
- a command would be destructive or materially ambiguous
- missing arguments prevent a safe execution-first interpretation

## Fastest shortcuts

If you want dedicated shortcut skills instead of subcommands, use:
- \`$operator-status\`
- \`$next-step\`
- \`$channels-doctor\`
- \`$channels-demo\`
- \`$channels-pending\`
- \`$channels-reply-latest\`
- \`$channels-watch\`
- \`$channels-follow\`

## Codex operator mode

When invoked from inside Codex, prefer **doing the next operator step** over only restating documentation.

Default workflow:
- If the user asks "what should I do next?", run \`codex-channels operator-status\` first and summarize the next action.
- If the user asks to keep an eye on the queue, run \`codex-channels watch\` so changes are surfaced only when the state actually changes.
- If the user asks whether the runtime is ready, run \`codex-channels doctor\` and summarize the result.
- If the user asks what is waiting, run \`codex-channels pending\` first and fall back to \`inspect\` only when deeper detail is needed.
- If the user asks to test the loop, use \`codex-channels demo\` and then point them toward \`pending\` and \`reply-latest\`.
- If the user asks to answer the newest request, prefer \`codex-channels reply-latest --text ...\` over making them copy an interaction id manually.
- If a step needs a local port bind, explain that approval/escalation is expected for the real runtime path.

## Fastest operator check

For a single run-ready summary, prefer:
\`\`\`bash
codex-channels operator-status
\`\`\`

For the next obvious action, prefer:
\`\`\`bash
codex-channels next-step
\`\`\`

For low-noise monitoring that can also resolve the next request when text is provided, use:
\`\`\`bash
codex-channels follow --text staging
\`\`\`

For low-noise monitoring, prefer:
\`\`\`bash
codex-channels watch
\`\`\`

## Guided operator flow

### 1. Install / expose the skill
\`\`\`bash
codex-channels plugin-bootstrap
\`\`\`

### 2. Check the current state
\`\`\`bash
codex-channels operator-status
codex-channels watch
codex-channels next-step
codex-channels doctor
codex-channels pending
\`\`\`

### 3. Generate a real interaction
\`\`\`bash
codex-channels demo
\`\`\`

### 4. Inspect what is waiting
\`\`\`bash
codex-channels pending
codex-channels inspect
\`\`\`

### 5. Reply
\`\`\`bash
codex-channels reply-latest --text staging
# or
codex-channels reply --id <interaction-id> --text staging
\`\`\`

## Common commands
\`\`\`bash
codex-channels plugin-bootstrap
codex-channels operator-status
codex-channels watch
codex-channels next-step
codex-channels doctor
codex-channels demo
codex-channels pending
codex-channels inspect
codex-channels reply-latest --text staging
codex-channels reply --id <interaction-id> --text staging
\`\`\`

Additional watch guidance:
- Use \`watch\` only when you actually want background-style monitoring; default flows should stay quiet.
- Watch mode should surface changes, not spam repeated no-change summaries.
- Treat watch output as change events: runtime up/down, actionable interaction count changes, latest interaction changes, or next-step changes.
- Each change event should carry a compact next-step hint so the user can act without another full status query.

Additional follow guidance:
- Use \`follow --text ...\` when you want low-noise monitoring plus the ability to resolve the next actionable request automatically once it appears.
- If you omit \`--text\`, prefer plain \`watch\` so the command stays observation-only.

Scoped monitoring guidance:
- Use \`--source <name>\` when you only care about one producer such as \`codex-channels-demo\`.
- Use \`--kind <kind>\` when you only care about one interaction shape such as \`user_input_request\`.
- Use \`--focus-id <id>\` when you want watch/follow behavior pinned to one specific interaction.
` },
    { name: "next-step", content: `---
name: next-step
description: "[CODEX-CHANNELS] Execute the next obvious local operator action when it is safe and unambiguous."
---

# next-step

Use this skill when you want Codex to keep the local loop moving. Run the command first. If it needs reply text, ask for the missing text or tell the user the exact next-step command to rerun.

Preferred command:
\`\`\`bash
codex-channels next-step
\`\`\`
` },
    { name: "operator-status", content: `---
name: operator-status
description: "[CODEX-CHANNELS] Summarize runtime reachability, pending work, and the next best operator step."
---

# operator-status

Use this skill when you want the fastest high-signal status check before acting. Run the command first, then summarize:
- whether the runtime is reachable
- how many actionable requests are waiting
- the latest actionable interaction
- the next best operator step

Preferred command:
\`\`\`bash
codex-channels operator-status
\`\`\`
` },
  ];
}

function buildCodexChannelsSkillContent() {
  return buildCodexChannelsSkillDefinitions().find((skill) => skill.name === "codex-channels")!.content;
}

function resolveCanonicalSkillsRoot(scope: string) {
  if (scope === "workspace") {
    return resolve(".codex", "skills");
  }
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return resolve(codexHome, "skills");
}

async function installCanonicalSkills(scope: string) {
  const skillsRoot = resolveCanonicalSkillsRoot(scope);
  const installed: string[] = [];
  for (const skill of buildCodexChannelsSkillDefinitions()) {
    const skillDir = resolve(skillsRoot, skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(resolve(skillDir, "SKILL.md"), skill.content, "utf8");
    installed.push(skillDir);
  }
  return installed;
}

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

  const skill = buildCodexChannelsSkillContent();

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
    return "./plugins/codex-channels";
  }
  const userPluginsDir = resolve(homedir(), "plugins");
  const linkPath = resolve(userPluginsDir, "codex-channels");
  await rm(linkPath, { recursive: true, force: true });
  await writeGeneratedPluginRoot(linkPath, cliEntry, runtime);
  return "./plugins/codex-channels";
}

async function resolveBootstrapScope(argv: string[]) {
  const explicit = argv.includes("--scope");
  if (explicit) {
    return readFlag(argv, "--scope", "user");
  }
  if (!supportsInteractiveMenu(process.stdin, process.stderr)) {
    return "user";
  }

  const options: MenuOption<string>[] = [
    {
      label: "User",
      description: "Install for all Codex workspaces on this machine (Recommended)",
      value: "user",
    },
    {
      label: "Workspace",
      description: "Install only for this repository",
      value: "workspace",
    },
  ];

  return await selectFromMenu(process.stdin, process.stderr, "Choose where to install codex-channels:", options);
}

async function runPluginBootstrap(argv: string[]) {
  const scope = await resolveBootstrapScope(argv);
  const installedSkillDirs = await installCanonicalSkills(scope);
  const requestedPluginPath = argv.includes("--plugin-path") ? readFlag(argv, "--plugin-path", "") : null;
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
    skillPath: installedSkillDirs.find((skillDir) => skillDir.endsWith('/codex-channels') || skillDir.endsWith('\\codex-channels')) ?? installedSkillDirs[0],
    installedSkills: installedSkillDirs,
  }, null, 2));
}

function shouldAutoCheckForUpdates(command: string, argv: string[]): boolean {
  if (hasFlag(argv, "--no-update-check")) return false;
  if (command === "doctor" && hasFlag(argv, "--json")) return false;
  return command === "help";
}

function shouldShowUpdateHint(command: string, argv: string[]) {
  if (hasFlag(argv, "--no-update-check")) return false;
  if (command === "doctor" && hasFlag(argv, "--json")) return false;
  return command === "help" || command === "doctor" || command === "plugin-bootstrap";
}

async function maybePrintUpdateHint(command: string, argv: string[]) {
  if (!shouldShowUpdateHint(command, argv)) return;
  try {
    const availability = await checkForUpdates();
    if (!availability) return;
    for (const line of buildUpdateHintLines(availability)) {
      process.stderr.write(`${line}\n`);
    }
  } catch {
    // ignore best-effort update hint failures
  }
}

async function promptForUpdate(command: string, argv: string[]) {
  if (!shouldAutoCheckForUpdates(command, argv)) {
    return false;
  }
  if (!supportsInteractiveMenu(process.stdin, process.stderr)) {
    return false;
  }

  let availability;
  try {
    availability = await checkForUpdates();
  } catch {
    return false;
  }
  if (!availability) {
    return false;
  }

  const action = await selectFromMenu(process.stdin, process.stderr, `Update available: v${availability.currentVersion} → v${availability.latestVersion}`,
    [
      { label: "Update now", description: "Install the latest published CLI", value: "update" },
      { label: "Skip", description: "Continue without updating this time", value: "skip" },
      { label: "Skip until next version", description: "Do not ask again for this version", value: "skip-version" },
    ]);

  if (action === "skip") {
    return false;
  }
  if (action === "skip-version") {
    await dismissVersion(availability.latestVersion, availability.stateFile);
    return false;
  }

  const plan = buildSelfUpdatePlan(availability);
  if (!plan.canAutoRun) {
    process.stderr.write(`\nA newer version is available, but this CLI is running from a source checkout (${plan.reason}).\n`);
    process.stderr.write("Use one of these update paths:\n");
    for (const step of plan.manualSteps) {
      process.stderr.write(`  - ${step}\n`);
    }
    return true;
  }

  process.stderr.write(`\nUpdating codex-channels to v${availability.latestVersion}...\n`);
  const result = await runSelfUpdatePlan(plan);
  if (!result.ok) {
    process.stderr.write("Automatic update failed. Try the manual command instead:\n");
    for (const step of plan.manualSteps) {
      process.stderr.write(`  - ${step}\n`);
    }
    return true;
  }

  process.stderr.write("Update complete. Rerun your previous command with the refreshed CLI.\n");
  return true;
}

async function runSelfUpdate(argv: string[]) {
  const availability = await checkForUpdates({ force: true, ignoreDismissed: true });
  if (!availability) {
    process.stdout.write("codex-channels is already up to date.\n");
    return;
  }

  const plan = buildSelfUpdatePlan(availability);
  if (hasFlag(argv, "--yes")) {
    if (!plan.canAutoRun) {
      process.stdout.write(`Automatic update is unavailable (${plan.reason ?? "manual path required"}).\n`);
      for (const step of plan.manualSteps) {
        process.stdout.write(`- ${step}\n`);
      }
      process.stdout.write("- codex-channels plugin-bootstrap\n");
      process.exitCode = 1;
      return;
    }
    const result = await runSelfUpdatePlan(plan);
    if (!result.ok) {
      throw new Error("self-update failed");
    }
    process.stdout.write(`Updated codex-channels to v${availability.latestVersion}.\n`);
    process.stdout.write("Next: codex-channels plugin-bootstrap\n");
    return;
  }

  if (supportsInteractiveMenu(process.stdin, process.stderr)) {
    const action = await selectFromMenu(process.stdin, process.stderr, `Update available: v${availability.currentVersion} → v${availability.latestVersion}`,
      [
        { label: "Update now", description: "Install the latest published CLI", value: "update" },
        { label: "Skip", description: "Leave the current version unchanged", value: "skip" },
        { label: "Skip until next version", description: "Do not ask again for this version", value: "skip-version" },
      ]);

    if (action === "skip") {
      process.stdout.write("Skipped update.\n");
      return;
    }
    if (action === "skip-version") {
      await dismissVersion(availability.latestVersion, availability.stateFile);
      process.stdout.write(`Will skip prompts for v${availability.latestVersion} until a newer version is published.\n`);
      return;
    }
  }

  if (!plan.canAutoRun) {
    process.stdout.write(`Automatic update is unavailable (${plan.reason ?? "manual path required"}).\n`);
    for (const step of plan.manualSteps) {
      process.stdout.write(`- ${step}\n`);
    }
    process.stdout.write("- codex-channels plugin-bootstrap\n");
    return;
  }

  const result = await runSelfUpdatePlan(plan);
  if (!result.ok) {
    throw new Error("self-update failed");
  }
  process.stdout.write(`Updated codex-channels to v${availability.latestVersion}.\n`);
  process.stdout.write("Next: codex-channels plugin-bootstrap\n");
}

async function main(argv: string[]) {
  const command = argv[2] ?? "help";

  if (command !== "self-update" && command !== "upgrade") {
    const consumed = await promptForUpdate(command, argv);
    if (consumed) {
      return;
    }
    await maybePrintUpdateHint(command, argv);
  }

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

  if (command === "pending") {
    await runPending(argv);
    return;
  }

  if (command === "operator-status") {
    await runOperatorStatus(argv);
    return;
  }

  if (command === "watch") {
    await runWatch(argv);
    return;
  }

  if (command === "follow") {
    await runFollow(argv);
    return;
  }

  if (command === "next-step") {
    await runNextStep(argv);
    return;
  }

  if (command === "reply-latest") {
    await runReplyLatest(argv);
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

  if (command === "self-update" || command === "upgrade") {
    await runSelfUpdate(argv);
    return;
  }

  console.log(`codex-channels\n\nCommands:\n  doctor            Check the local runtime and show the next useful commands\n  demo              Start a demo interaction and wait for a reply\n  inspect           Read the local interaction state file and list current interactions\n  operator-status   Summarize runtime reachability, pending work, and the next best operator step\n  watch             Follow runtime state quietly and only print when something changes\n  follow            Watch quietly and resolve the next actionable request when text is provided\n  next-step         Run the next recommended operator action when it is obvious and safe\n  pending           Show the newest pending or delivered interactions first\n  reply             Reply to one interaction on the running local runtime\n  reply-latest      Reply to the newest pending interaction without copying its id\n  self-update       Check for a newer published CLI version and install it\n  serve             Start the local-first HTTP runtime\n  status            Query a running local runtime\n  submit            Start the local runtime, publish one interaction, and wait for a response\n  bridge-stdio      Run the Codex interaction bridge over stdin/stdout while hosting a local channel runtime\n  bridge-spawn      Start the local runtime and spawn a Codex app-server-compatible child process to bridge interactive requests\n  plugin-bootstrap  Generate a Codex plugin wrapper and register it in the marketplace\n\nFlags:\n  --host <host>              Bind/query host (default 127.0.0.1)\n  --port <port>              Bind/query port (default 4317)\n  --state-file <path>        File-backed interaction state (default .codex-channels/state.json)\n  --interaction-file <path>  JSON file containing one interaction payload for submit\n  --id <interaction-id>      Target interaction for inspect/reply\n  --status <status>          Filter inspect output by interaction status\n  --focus-id <id>            Narrow watch/follow/reply-latest/operator-status to one interaction id\n  --source <name>            Narrow watch/follow/operator-status to one interaction source name\n  --kind <kind>              Narrow watch/follow/operator-status to one interaction kind\n  --text <value>             Reply value for reply/submit flows\n  --accept                   Send an accept reply\n  --decline                  Send a decline reply\n  --cancel                   Cancel the interaction\n  --timeout-ms <ms>          Bridge or demo interaction timeout (default 300000)\n  --codex-command <cmd>      Command used by bridge-spawn (default codex)\n  --codex-arg <arg>          Additional argument for bridge-spawn; may be repeated\n  --spawn-mode <mode>        app-server | raw (default app-server)\n  --scope <scope>            plugin-bootstrap scope: user | workspace (prompts with an arrow-key menu when interactive; defaults to user otherwise)\n  --plugin-path <path>       explicit plugin root to generate and register\n  --marketplace-file <path>  plugin-bootstrap target marketplace.json\n  --no-update-check          Skip automatic update prompts for this run\n  --yes                      Apply self-update without prompting\n  --json                     Emit JSON output for inspect\n  --quiet                    Suppress bridge startup metadata on stderr`);
}

main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
