import { createServer, type Server } from "node:http";
import {
  ChannelBackend,
  Interaction,
  InteractionResponse,
  InteractionRuntime,
  InteractionStatus,
} from "@cafitac/codex-channels-core";

export class LocalMemoryBackend implements ChannelBackend {
  readonly name = "local-memory";
  #messages: Interaction[] = [];
  #responses: InteractionResponse[] = [];

  async publish(interaction: Interaction): Promise<void> {
    this.#messages.push(interaction);
  }

  async resolve(interactionId: string, response: InteractionResponse): Promise<void> {
    this.#responses.push({ ...response, interactionId });
  }

  async cancel(interactionId: string, reason?: string): Promise<void> {
    this.#responses.push({
      interactionId,
      action: "cancel",
      values: reason ? [reason] : [],
      respondedAt: new Date().toISOString(),
    });
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `${this.#messages.length} published / ${this.#responses.length} responses` };
  }

  snapshot() {
    return { interactions: [...this.#messages], responses: [...this.#responses] };
  }
}

async function readJson(req: AsyncIterable<Buffer | string>): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body ? JSON.parse(body) : {};
}

function json(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

export class LocalHttpChannelServer {
  #server?: Server;

  constructor(readonly runtime: InteractionRuntime) {}

  async start(options: { port?: number; host?: string } = {}) {
    const { port = 4317, host = "127.0.0.1" } = options;
    if (this.#server) throw new Error("server already started");
    this.#server = createServer(async (req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (method === "GET" && url.pathname === "/health") {
        return json(res, 200, await this.runtime.backend.health());
      }

      if (method === "GET" && url.pathname === "/interactions") {
        const status = url.searchParams.get("status") as InteractionStatus | null;
        return json(res, 200, { interactions: this.runtime.registry.list(status ?? undefined) });
      }

      if (method === "POST" && url.pathname === "/interactions") {
        const body = await readJson(req);
        const interaction = (body as { interaction?: Interaction }).interaction;
        const timeoutMs = typeof (body as { timeoutMs?: unknown }).timeoutMs === "number"
          ? (body as { timeoutMs: number }).timeoutMs
          : undefined;
        if (!interaction) {
          return json(res, 400, { error: "missing interaction" });
        }
        try {
          if (typeof timeoutMs === "number") {
            const response = await this.runtime.publishAndWait(interaction, timeoutMs);
            return json(res, 200, { ok: true, interaction: this.runtime.registry.get(interaction.id), response });
          }
          const published = await this.runtime.publish(interaction);
          return json(res, 200, { ok: true, interaction: published });
        } catch (error) {
          return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }

      if (method === "GET" && url.pathname.startsWith("/interactions/")) {
        const interactionId = url.pathname.split("/")[2] ?? "";
        const interaction = this.runtime.registry.get(interactionId);
        return interaction
          ? json(res, 200, interaction)
          : json(res, 404, { error: `unknown interaction: ${interactionId}` });
      }

      if (method === "POST" && url.pathname.endsWith("/respond")) {
        const interactionId = url.pathname.split("/")[2] ?? "";
        const body = await readJson(req);
        const response: InteractionResponse = {
          interactionId,
          action: typeof (body as { action?: unknown }).action === "string" ? (body as { action: InteractionResponse["action"] }).action : "text",
          values: Array.isArray((body as { values?: unknown }).values) ? (body as { values: string[] }).values : [],
          metadata: typeof (body as { metadata?: unknown }).metadata === "object" ? (body as { metadata?: Record<string, unknown> }).metadata : undefined,
          respondedAt: new Date().toISOString(),
        };
        const updated = await this.runtime.resolve(response);
        return updated
          ? json(res, 200, { interaction: updated, response })
          : json(res, 404, { error: `unknown interaction: ${interactionId}` });
      }

      if (method === "POST" && url.pathname.endsWith("/cancel")) {
        const interactionId = url.pathname.split("/")[2] ?? "";
        const body = await readJson(req);
        const updated = await this.runtime.cancel(interactionId, typeof (body as { reason?: unknown }).reason === "string" ? (body as { reason: string }).reason : undefined);
        return updated
          ? json(res, 200, { interaction: updated })
          : json(res, 404, { error: `unknown interaction: ${interactionId}` });
      }

      return json(res, 404, { error: `route not found: ${method} ${url.pathname}` });
    });

    await new Promise<void>((resolve, reject) => {
      this.#server?.once("error", reject);
      this.#server?.listen(port, host, () => resolve());
    });

    return { host, port, url: `http://${host}:${port}` };
  }

  async stop() {
    if (!this.#server) return;
    await new Promise<void>((resolve, reject) => {
      this.#server?.close((error) => (error ? reject(error) : resolve()));
    });
    this.#server = undefined;
  }
}
