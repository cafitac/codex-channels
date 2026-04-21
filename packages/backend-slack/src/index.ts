import type { ChannelBackend, Interaction, InteractionResponse } from "@cafitac/codex-channels-core";

export interface SlackBackendOptions {
  botToken: string;
  channelId: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function renderInteraction(interaction: Interaction): string {
  const lines = [
    "*codex-channels*",
    `*kind:* ${interaction.kind}`,
    `*source:* ${interaction.source.name}`,
    "",
    interaction.payload.message,
  ];
  const options = interaction.payload.options ?? [];
  if (options.length) {
    lines.push("", "*options:*", ...options.map((option) => `• ${option.label} => ${option.value}`));
  }
  lines.push("", `interaction_id: ${interaction.id}`);
  return lines.join("\n");
}

export class SlackBotBackend implements ChannelBackend {
  readonly name = "slack-bot";
  readonly #fetch: typeof fetch;
  readonly #apiBaseUrl: string;

  constructor(readonly options: SlackBackendOptions) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#apiBaseUrl = options.apiBaseUrl ?? "https://slack.com/api";
  }

  async publish(interaction: Interaction): Promise<void> {
    await this.#postMessage(renderInteraction(interaction));
  }

  async resolve(interactionId: string, response: InteractionResponse): Promise<void> {
    await this.#postMessage(`resolved ${interactionId}: ${response.action}${response.values?.length ? ` (${response.values.join(", ")})` : ""}`);
  }

  async cancel(interactionId: string, reason?: string): Promise<void> {
    await this.#postMessage(`cancelled ${interactionId}${reason ? `: ${reason}` : ""}`);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const response = await this.#fetch(`${this.#apiBaseUrl}/auth.test`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      return { ok: false, detail: `slack health check failed: ${response.status}` };
    }
    const payload = await response.json() as { ok?: boolean; error?: string };
    return payload.ok ? { ok: true, detail: "slack bot reachable" } : { ok: false, detail: payload.error ?? "slack auth failed" };
  }

  async #postMessage(text: string): Promise<void> {
    const response = await this.#fetch(`${this.#apiBaseUrl}/chat.postMessage`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: this.options.channelId,
        text,
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`slack chat.postMessage failed: ${response.status} ${body}`);
    }
    const payload = await response.json() as { ok?: boolean; error?: string };
    if (!payload.ok) {
      throw new Error(`slack chat.postMessage rejected: ${payload.error ?? "unknown_error"}`);
    }
  }
}
