import type { ChannelBackend, Interaction, InteractionResponse } from "@cafitac/codex-channels-core";

export interface DiscordBackendOptions {
  botToken: string;
  channelId: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function renderInteraction(interaction: Interaction): string {
  const lines = [
    "**codex-channels**",
    `**kind:** ${interaction.kind}`,
    `**source:** ${interaction.source.name}`,
    "",
    interaction.payload.message,
  ];
  const options = interaction.payload.options ?? [];
  if (options.length) {
    lines.push("", "**options:**", ...options.map((option) => `• ${option.label} => ${option.value}`));
  }
  lines.push("", `interaction_id: ${interaction.id}`);
  return lines.join("\n");
}

export class DiscordBotBackend implements ChannelBackend {
  readonly name = "discord-bot";
  readonly #fetch: typeof fetch;
  readonly #apiBaseUrl: string;

  constructor(readonly options: DiscordBackendOptions) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#apiBaseUrl = options.apiBaseUrl ?? "https://discord.com/api/v10";
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
    const response = await this.#fetch(`${this.#apiBaseUrl}/users/@me`, {
      headers: { authorization: `Bot ${this.options.botToken}` },
    });
    if (!response.ok) {
      return { ok: false, detail: `discord health check failed: ${response.status}` };
    }
    return { ok: true, detail: "discord bot reachable" };
  }

  async #postMessage(content: string): Promise<void> {
    const response = await this.#fetch(`${this.#apiBaseUrl}/channels/${this.options.channelId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${this.options.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`discord create message failed: ${response.status} ${body}`);
    }
  }
}
