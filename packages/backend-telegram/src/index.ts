import type { ChannelBackend, Interaction, InteractionResponse } from "@cafitac/codex-channels-core";

export interface TelegramBackendOptions {
  botToken: string;
  chatId: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function escapeTelegram(text: string): string {
  return text.replace(/[\\_*\[\]()~`>#+\-=|{}.!]/g, (match) => `\\${match}`);
}

function renderInteraction(interaction: Interaction): string {
  const lines = [
    `*codex-channels*`,
    `kind: ${escapeTelegram(interaction.kind)}`,
    `source: ${escapeTelegram(interaction.source.name)}`,
    "",
    escapeTelegram(interaction.payload.message),
  ];
  const options = interaction.payload.options ?? [];
  if (options.length) {
    lines.push("", "options:");
    for (const option of options) {
      lines.push(`- ${escapeTelegram(option.label)} => ${escapeTelegram(option.value)}`);
    }
  }
  lines.push("", `interaction_id: ${escapeTelegram(interaction.id)}`);
  return lines.join("\n");
}

export class TelegramBotBackend implements ChannelBackend {
  readonly name = "telegram-bot";
  readonly #fetch: typeof fetch;
  readonly #apiBaseUrl: string;

  constructor(readonly options: TelegramBackendOptions) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#apiBaseUrl = options.apiBaseUrl ?? `https://api.telegram.org/bot${options.botToken}`;
  }

  async publish(interaction: Interaction): Promise<void> {
    await this.#sendMessage(renderInteraction(interaction));
  }

  async resolve(interactionId: string, response: InteractionResponse): Promise<void> {
    await this.#sendMessage(`resolved ${interactionId}: ${response.action}${response.values?.length ? ` (${response.values.join(", ")})` : ""}`);
  }

  async cancel(interactionId: string, reason?: string): Promise<void> {
    await this.#sendMessage(`cancelled ${interactionId}${reason ? `: ${reason}` : ""}`);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const response = await this.#fetch(`${this.#apiBaseUrl}/getMe`);
    return response.ok
      ? { ok: true, detail: "telegram bot reachable" }
      : { ok: false, detail: `telegram health check failed: ${response.status}` };
  }

  async #sendMessage(text: string): Promise<void> {
    const response = await this.#fetch(`${this.#apiBaseUrl}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.options.chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`telegram sendMessage failed: ${response.status} ${body}`);
    }
  }
}
