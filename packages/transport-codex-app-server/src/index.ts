import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  ChannelOption,
  Interaction,
  InteractionResponse,
  InteractionRuntime,
  createInteraction,
} from "@cafitac/codex-channels-core";

export interface CodexServerRequestMessage {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface CodexServerNotificationMessage {
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponseMessage {
  id: string | number;
  result: Record<string, unknown>;
}

export interface JsonRpcErrorMessage {
  id: string | number;
  error: { code: number; message: string };
}

function option(label: string, value = label): ChannelOption {
  return { label, value };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function maybeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function isInteractiveCodexRequest(method: string): boolean {
  return [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
  ].includes(method);
}

export function mapCodexRequestToInteraction(message: CodexServerRequestMessage): Interaction {
  const { id, method, params } = message;
  const codex = {
    threadId: typeof params.threadId === "string" ? params.threadId : undefined,
    turnId: typeof params.turnId === "string" || params.turnId === null ? (params.turnId as string | null | undefined) : undefined,
    requestId: id,
    method,
  };

  if (method === "item/commandExecution/requestApproval") {
    const command = asString(params.command, "Command execution requested");
    const reason = asString(params.reason);
    return createInteraction({
      id: `codex-${String(id)}`,
      kind: "approval_request",
      source: { type: "codex_app_server", name: "codex-app-server" },
      codex,
      payload: {
        message: reason ? `${command}\n\nReason: ${reason}` : command,
        options: [option("Yes (once)", "accept"), option("Always allow (session)", "acceptForSession"), option("No", "decline")],
        metadata: { params },
      },
      policy: { allowFreeText: false },
    });
  }

  if (method === "item/fileChange/requestApproval") {
    return createInteraction({
      id: `codex-${String(id)}`,
      kind: "approval_request",
      source: { type: "codex_app_server", name: "codex-app-server" },
      codex,
      payload: {
        message: asString(params.reason, "File change approval requested"),
        options: [option("Yes (once)", "accept"), option("Always allow (session)", "acceptForSession"), option("No", "decline")],
        metadata: { params },
      },
      policy: { allowFreeText: false },
    });
  }

  if (method === "item/permissions/requestApproval") {
    return createInteraction({
      id: `codex-${String(id)}`,
      kind: "permissions_request",
      source: { type: "codex_app_server", name: "codex-app-server" },
      codex,
      payload: {
        message: asString(params.reason, "Permissions requested"),
        options: [option("Yes (once)", "accept"), option("Always allow (session)", "acceptForSession"), option("No", "decline")],
        metadata: { params },
      },
      policy: { allowFreeText: false },
    });
  }

  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params.questions) ? params.questions as Array<Record<string, unknown>> : [];
    const rendered = questions.flatMap((question) => {
      const lines = [asString(question.question, "Codex requires input.")];
      const options = Array.isArray(question.options) ? question.options as Array<Record<string, unknown>> : [];
      if (options.length) {
        lines.push(`Options: ${options.map((item) => asString(item.label)).filter(Boolean).join(", ")}`);
      }
      return lines;
    }).join("\n");
    return createInteraction({
      id: `codex-${String(id)}`,
      kind: "user_input_request",
      source: { type: "codex_app_server", name: "codex-app-server" },
      codex,
      payload: {
        message: rendered || "Codex requires input.",
        metadata: { params },
      },
      policy: { allowFreeText: true },
    });
  }

  if (method === "mcpServer/elicitation/request") {
    const mode = asString(params.mode, "form");
    const messageText = asString(params.message, "Codex requested MCP input.");
    return createInteraction({
      id: `codex-${String(id)}`,
      kind: "elicitation_request",
      source: { type: "codex_app_server", name: asString(params.serverName, "codex-app-server") },
      codex,
      payload: {
        message: mode === "url" ? `${messageText}\nURL: ${asString(params.url)}` : messageText,
        options: [option("Submit", "accept"), option("Cancel", "cancel")],
        metadata: { params },
      },
      policy: { allowFreeText: true },
    });
  }

  throw new Error(`Unsupported Codex request method: ${method}`);
}

export function mapInteractionResponseToCodexResult(interaction: Interaction, response: InteractionResponse): Record<string, unknown> {
  const method = interaction.codex?.method;
  const firstValue = response.values?.[0] ?? "";

  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    if (response.action === "cancel") return { decision: "cancel" };
    if (response.action === "decline") return { decision: "decline" };
    if (firstValue === "acceptForSession") return { decision: "acceptForSession" };
    return { decision: "accept" };
  }

  if (method === "item/permissions/requestApproval") {
    const scope = firstValue === "acceptForSession" ? "session" : "turn";
    const permissions = interaction.payload.metadata && typeof interaction.payload.metadata === "object"
      ? (interaction.payload.metadata as { params?: { permissions?: unknown } }).params?.permissions ?? {}
      : {};
    if (response.action === "decline" || response.action === "cancel") {
      return { permissions: {}, scope: "turn" };
    }
    return { permissions, scope };
  }

  if (method === "item/tool/requestUserInput") {
    const params = (interaction.payload.metadata as { params?: { questions?: Array<{ id?: string }> } } | undefined)?.params;
    const questions = params?.questions ?? [];
    const answer = response.values?.[0] ?? "";
    const answers = Object.fromEntries(questions.map((question) => [question.id ?? "unknown", { answers: [answer] }]));
    return { answers };
  }

  if (method === "mcpServer/elicitation/request") {
    if (response.action === "cancel") return { action: "cancel" };
    if (response.action === "decline") return { action: "decline", content: null };
    return { action: "accept", content: { answer: response.values?.[0] ?? "" } };
  }

  throw new Error(`Unsupported Codex interaction response mapping for method: ${method ?? "unknown"}`);
}

export function mapServerRequestResolved(message: { method: string; params: Record<string, unknown> }) {
  if (message.method !== "server/requestResolved") {
    return null;
  }
  return {
    threadId: asString(message.params.threadId),
    requestId: (message.params.requestId as string | number | undefined) ?? "",
  };
}

export function extractInteractionChoices(interaction: Interaction): string[] {
  return interaction.payload.options?.map((item) => item.value) ?? [];
}

export function normalizeResponseValues(input: unknown): string[] {
  if (typeof input === "string") return [input];
  return maybeArray(input);
}

export class CodexInteractionBridge {
  constructor(
    readonly runtime: InteractionRuntime,
    readonly options: { timeoutMs?: number } = {},
  ) {}

  async handleServerRequest(message: CodexServerRequestMessage): Promise<JsonRpcResponseMessage | JsonRpcErrorMessage> {
    try {
      const interaction = mapCodexRequestToInteraction(message);
      const timeoutMs = this.options.timeoutMs ?? ((interaction.policy?.timeoutSec ?? 300) * 1000);
      const response = await this.runtime.publishAndWait(interaction, timeoutMs);
      return {
        id: message.id,
        result: mapInteractionResponseToCodexResult(interaction, response),
      };
    } catch (error) {
      return {
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

export class CodexJsonRpcLoop {
  #closed = false;

  constructor(
    readonly bridge: CodexInteractionBridge,
    readonly input: NodeJS.ReadableStream,
    readonly output: Writable,
    readonly notifications: Array<CodexServerNotificationMessage> = [],
  ) {}

  async run(): Promise<void> {
    const lines = createInterface({ input: this.input as NodeJS.ReadableStream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (this.#closed) break;
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.method !== "string") continue;
      if (message.id !== undefined) {
        const response = await this.bridge.handleServerRequest({
          id: message.id as string | number,
          method: message.method,
          params: (message.params as Record<string, unknown> | undefined) ?? {},
        });
        this.output.write(`${JSON.stringify(response)}\n`);
        continue;
      }
      this.notifications.push({
        method: message.method,
        params: (message.params as Record<string, unknown> | undefined) ?? {},
      });
    }
  }

  close() {
    this.#closed = true;
  }
}

export class SpawnedCodexAppServerLoop {
  #process?: ChildProcessWithoutNullStreams;
  #loop?: CodexJsonRpcLoop;

  constructor(
    readonly bridge: CodexInteractionBridge,
    readonly options: {
      command?: string;
      cwd?: string;
      extraArgs?: string[];
      mode?: "app-server" | "raw";
    } = {},
  ) {}

  start() {
    const command = this.options.command ?? "codex";
    const baseArgs = this.options.mode === "raw"
      ? []
      : ["app-server", "--listen", "stdio://"];
    const args = [...baseArgs, ...(this.options.extraArgs ?? [])];
    this.#process = spawn(command, args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#loop = new CodexJsonRpcLoop(bridgeWithRuntime(this.bridge), this.#process.stdout, this.#process.stdin);
    return this.#loop.run();
  }

  stop() {
    this.#loop?.close();
    this.#process?.kill();
  }
}

function bridgeWithRuntime(bridge: CodexInteractionBridge): CodexInteractionBridge {
  return bridge;
}
