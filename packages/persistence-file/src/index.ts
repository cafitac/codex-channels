import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Interaction, InteractionPersistence } from "@cafitac/codex-channels-core";

export class JsonFileInteractionPersistence implements InteractionPersistence {
  constructor(readonly filePath: string) {}

  async load(): Promise<Interaction[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { interactions?: Interaction[] };
      return Array.isArray(parsed.interactions) ? parsed.interactions : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async save(interactions: Interaction[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ interactions }, null, 2) + "\n", "utf8");
  }
}
