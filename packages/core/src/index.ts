export type InteractionKind =
  | "approval_request"
  | "permissions_request"
  | "user_input_request"
  | "elicitation_request"
  | "progress_update"
  | "resolved"
  | "cancelled"
  | "errored";

export type InteractionStatus = "pending" | "delivered" | "resolved" | "cancelled" | "errored";

export interface ChannelOption {
  label: string;
  value: string;
  description?: string;
}

export interface InteractionSource {
  type: "mcp_server" | "runtime" | "system" | "codex_app_server";
  name: string;
}

export interface CodexContext {
  threadId?: string;
  turnId?: string | null;
  requestId?: string | number;
  method?: string;
}

export interface InteractionPayload {
  message: string;
  options?: ChannelOption[];
  metadata?: Record<string, unknown>;
}

export interface InteractionPolicy {
  timeoutSec?: number;
  allowFreeText?: boolean;
}

export interface Interaction {
  id: string;
  kind: InteractionKind;
  source: InteractionSource;
  codex?: CodexContext;
  payload: InteractionPayload;
  policy?: InteractionPolicy;
  createdAt: string;
  status: InteractionStatus;
}

export interface InteractionResponse {
  interactionId: string;
  action: "accept" | "decline" | "cancel" | "text";
  values?: string[];
  metadata?: Record<string, unknown>;
  respondedAt: string;
}

export interface InteractionPersistence {
  load(): Promise<Interaction[]>;
  save(interactions: Interaction[]): Promise<void>;
}

export interface ChannelBackend {
  readonly name: string;
  publish(interaction: Interaction): Promise<void>;
  resolve(interactionId: string, response: InteractionResponse): Promise<void>;
  cancel(interactionId: string, reason?: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export class InteractionRegistry {
  #pending = new Map<string, Interaction>();

  constructor(initialInteractions: Interaction[] = []) {
    for (const interaction of initialInteractions) {
      this.#pending.set(interaction.id, interaction);
    }
  }

  register(interaction: Interaction): Interaction {
    this.#pending.set(interaction.id, interaction);
    return interaction;
  }

  get(interactionId: string): Interaction | undefined {
    return this.#pending.get(interactionId);
  }

  list(status?: InteractionStatus): Interaction[] {
    const items = [...this.#pending.values()];
    return status ? items.filter((item) => item.status === status) : items;
  }

  snapshot(): Interaction[] {
    return this.list();
  }

  markDelivered(interactionId: string): Interaction | undefined {
    return this.#setStatus(interactionId, "delivered");
  }

  resolve(response: InteractionResponse): Interaction | undefined {
    return this.#setStatus(response.interactionId, "resolved");
  }

  cancel(interactionId: string): Interaction | undefined {
    return this.#setStatus(interactionId, "cancelled");
  }

  error(interactionId: string): Interaction | undefined {
    return this.#setStatus(interactionId, "errored");
  }

  #setStatus(interactionId: string, status: InteractionStatus): Interaction | undefined {
    const interaction = this.#pending.get(interactionId);
    if (!interaction) {
      return undefined;
    }
    const updated = { ...interaction, status };
    this.#pending.set(interactionId, updated);
    return updated;
  }
}

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class InteractionRuntime {
  #waiters = new Map<string, Deferred<InteractionResponse>>();

  constructor(
    readonly backend: ChannelBackend,
    readonly registry = new InteractionRegistry(),
    readonly persistence?: InteractionPersistence,
  ) {}

  static async create(options: {
    backend: ChannelBackend;
    persistence?: InteractionPersistence;
  }): Promise<InteractionRuntime> {
    const interactions = options.persistence ? await options.persistence.load() : [];
    return new InteractionRuntime(options.backend, new InteractionRegistry(interactions), options.persistence);
  }

  async publish(interaction: Interaction): Promise<Interaction> {
    this.registry.register(interaction);
    await this.backend.publish(interaction);
    const updated = this.registry.markDelivered(interaction.id) ?? interaction;
    await this.#persist();
    return updated;
  }

  async publishAndWait(interaction: Interaction, timeoutMs = 5 * 60 * 1000): Promise<InteractionResponse> {
    await this.publish(interaction);
    return this.waitForResponse(interaction.id, timeoutMs);
  }

  waitForResponse(interactionId: string, timeoutMs = 5 * 60 * 1000): Promise<InteractionResponse> {
    const existing = this.#waiters.get(interactionId);
    if (existing) {
      return existing.promise;
    }
    const deferred = new Deferred<InteractionResponse>();
    const timeout = setTimeout(() => {
      this.#waiters.delete(interactionId);
      deferred.reject(new Error(`timed out waiting for interaction response: ${interactionId}`));
    }, timeoutMs);
    deferred.promise.finally(() => clearTimeout(timeout)).catch(() => undefined);
    this.#waiters.set(interactionId, deferred);
    return deferred.promise;
  }

  async resolve(response: InteractionResponse): Promise<Interaction | undefined> {
    const updated = this.registry.resolve(response);
    if (!updated) return undefined;
    await this.backend.resolve(response.interactionId, response);
    this.#waiters.get(response.interactionId)?.resolve(response);
    this.#waiters.delete(response.interactionId);
    await this.#persist();
    return updated;
  }

  async cancel(interactionId: string, reason?: string): Promise<Interaction | undefined> {
    const updated = this.registry.cancel(interactionId);
    if (!updated) return undefined;
    await this.backend.cancel(interactionId, reason);
    const response: InteractionResponse = {
      interactionId,
      action: "cancel",
      values: reason ? [reason] : [],
      respondedAt: new Date().toISOString(),
    };
    this.#waiters.get(interactionId)?.resolve(response);
    this.#waiters.delete(interactionId);
    await this.#persist();
    return updated;
  }

  async #persist(): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.save(this.registry.snapshot());
  }
}

export function createInteraction(input: {
  id: string;
  kind: InteractionKind;
  source: InteractionSource;
  payload: InteractionPayload;
  codex?: CodexContext;
  policy?: InteractionPolicy;
}): Interaction {
  return {
    ...input,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
}
