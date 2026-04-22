import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

export type MenuOption<T> = {
  label: string;
  description?: string;
  value: T;
};

export type MenuController<T> = {
  readonly options: MenuOption<T>[];
  readonly selectedIndex: number;
  move(delta: number): MenuController<T>;
  selected(): MenuOption<T>;
};

export function createMenuController<T>(options: MenuOption<T>[], selectedIndex = 0): MenuController<T> {
  if (options.length === 0) {
    throw new Error("interactive menu requires at least one option");
  }
  const boundedIndex = ((selectedIndex % options.length) + options.length) % options.length;
  return {
    options,
    selectedIndex: boundedIndex,
    move(delta: number) {
      return createMenuController(options, boundedIndex + delta);
    },
    selected() {
      return options[boundedIndex]!;
    },
  };
}

export function supportsInteractiveMenu(input: Pick<NodeJS.ReadStream, "isTTY" | "setRawMode">, output: Pick<NodeJS.WriteStream, "isTTY">): boolean {
  return Boolean(input.isTTY && output.isTTY && typeof input.setRawMode === "function");
}

export function renderMenu<T>(message: string, controller: MenuController<T>): string {
  const lines = [message, ""];
  for (const [index, option] of controller.options.entries()) {
    const prefix = index === controller.selectedIndex ? "›" : " ";
    const suffix = option.description ? ` — ${option.description}` : "";
    lines.push(` ${prefix} ${option.label}${suffix}`);
  }
  lines.push("", "Use ↑/↓ to move and Enter to select.");
  return lines.join("\n");
}

export async function selectFromMenu<T>(input: NodeJS.ReadStream, output: NodeJS.WriteStream, message: string, options: MenuOption<T>[], selectedIndex = 0): Promise<T> {
  if (!supportsInteractiveMenu(input, output)) {
    return await selectFromMenuFallback(input, output, message, options, selectedIndex);
  }

  let controller = createMenuController(options, selectedIndex);
  let renderedLineCount = 0;
  const render = () => {
    if (renderedLineCount > 0) {
      output.write(`\u001b[${renderedLineCount}F`);
    }
    const frame = renderMenu(message, controller);
    const lines = frame.split("\n");
    for (const line of lines) {
      output.write("\u001b[2K");
      output.write(line);
      output.write("\n");
    }
    renderedLineCount = lines.length;
  };

  return await new Promise<T>((resolve, reject) => {
    const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Aborted with Ctrl+C"));
        return;
      }
      if (key.name === "up") {
        controller = controller.move(-1);
        render();
        return;
      }
      if (key.name === "down") {
        controller = controller.move(1);
        render();
        return;
      }
      if (key.name === "return") {
        const choice = controller.selected().value;
        cleanup();
        output.write("\n");
        resolve(choice);
      }
    };

    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode?.(false);
      if (typeof input.pause === "function") input.pause();
    };

    emitKeypressEvents(input);
    input.setRawMode?.(true);
    if (typeof input.resume === "function") input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}

async function selectFromMenuFallback<T>(input: NodeJS.ReadStream, output: NodeJS.WriteStream, message: string, options: MenuOption<T>[], selectedIndex = 0): Promise<T> {
  const rl = createInterface({ input, output });
  try {
    output.write(`${message}\n`);
    for (const [index, option] of options.entries()) {
      const marker = index === selectedIndex ? "*" : " ";
      const suffix = option.description ? ` — ${option.description}` : "";
      output.write(` ${marker} ${index + 1}. ${option.label}${suffix}\n`);
    }
    const answer = (await rl.question(`Select 1-${options.length} (default ${selectedIndex + 1}): `)).trim();
    const parsed = Number(answer || String(selectedIndex + 1));
    const choice = options[Math.max(0, Math.min(options.length - 1, parsed - 1))];
    if (!choice) {
      throw new Error("invalid menu selection");
    }
    return choice.value;
  } finally {
    rl.close();
  }
}
