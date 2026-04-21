import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteraction } from "@cafitac/codex-channels-core";
import { JsonFileInteractionPersistence } from "./index.js";

test("json file persistence saves and loads interactions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-channels-"));
  const file = join(dir, "state.json");
  const persistence = new JsonFileInteractionPersistence(file);
  const interaction = createInteraction({
    id: "ix_persist_1",
    kind: "progress_update",
    source: { type: "system", name: "test" },
    payload: { message: "hello" },
  });

  await persistence.save([interaction]);
  const loaded = await persistence.load();
  assert.equal(loaded[0]?.id, interaction.id);
  const raw = JSON.parse(await readFile(file, "utf8")) as { interactions: Array<{ id: string }> };
  assert.equal(raw.interactions[0]?.id, interaction.id);
});
