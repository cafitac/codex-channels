import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const CLI_PACKAGE_NAME = "@cafitac/codex-channels";
const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;

export type UpdateState = {
  lastCheckedAt?: string;
  dismissedVersion?: string;
};

export type UpdateAvailability = {
  currentVersion: string;
  latestVersion: string;
  stateFile: string;
  installContext: "source-checkout" | "published-package";
};

export type SelfUpdatePlan = {
  canAutoRun: boolean;
  command?: string;
  args?: string[];
  manualSteps: string[];
  reason?: string;
};

const packageJsonUrl = new URL("../package.json", import.meta.url);

export async function readCurrentVersion(): Promise<string> {
  const raw = await readFile(packageJsonUrl, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export function resolveUpdateStateFile(customPath = process.env.CODEX_CHANNELS_UPDATE_STATE_FILE): string {
  return customPath ?? resolve(homedir(), ".codex-channels", "update-state.json");
}

export async function readUpdateState(stateFile = resolveUpdateStateFile()): Promise<UpdateState> {
  try {
    const raw = await readFile(stateFile, "utf8");
    return JSON.parse(raw) as UpdateState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeUpdateState(state: UpdateState, stateFile = resolveUpdateStateFile()): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function compareVersions(left: string, right: string): number {
  const normalize = (value: string) => value.split("-")[0]?.split(".").map((part) => Number.parseInt(part, 10) || 0) ?? [0];
  const leftParts = normalize(left);
  const rightParts = normalize(right);
  const width = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < width; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

export function shouldCheckForUpdates(state: UpdateState, now = Date.now()): boolean {
  if (!state.lastCheckedAt) return true;
  const lastCheckedAt = Date.parse(state.lastCheckedAt);
  if (Number.isNaN(lastCheckedAt)) return true;
  return now - lastCheckedAt >= UPDATE_TTL_MS;
}

export async function fetchLatestVersion(): Promise<string> {
  const override = process.env.CODEX_CHANNELS_LATEST_VERSION;
  if (override) return override;

  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(CLI_PACKAGE_NAME)}/latest`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`failed to check npm registry: ${response.status}`);
  }
  const payload = await response.json() as { version?: string };
  if (!payload.version) {
    throw new Error("npm registry payload did not include version");
  }
  return payload.version;
}

export async function detectInstallContext(): Promise<"source-checkout" | "published-package"> {
  const override = process.env.CODEX_CHANNELS_INSTALL_CONTEXT;
  if (override === "source-checkout" || override === "published-package") {
    return override;
  }
  const packageRoot = dirname(fileURLToPath(packageJsonUrl));
  const repoGitDir = resolve(packageRoot, "..", "..", ".git");
  try {
    await access(repoGitDir, constants.F_OK);
    return "source-checkout";
  } catch {
    return "published-package";
  }
}

export async function checkForUpdates(options: { force?: boolean; ignoreDismissed?: boolean } = {}): Promise<UpdateAvailability | null> {
  const stateFile = resolveUpdateStateFile();
  const currentVersion = await readCurrentVersion();
  const state = await readUpdateState(stateFile);

  if (!options.force && !shouldCheckForUpdates(state)) {
    return null;
  }

  const latestVersion = await fetchLatestVersion();
  await writeUpdateState({ ...state, lastCheckedAt: new Date().toISOString() }, stateFile);

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return null;
  }
  if (!options.ignoreDismissed && state.dismissedVersion === latestVersion) {
    return null;
  }

  return {
    currentVersion,
    latestVersion,
    stateFile,
    installContext: await detectInstallContext(),
  };
}

export async function dismissVersion(latestVersion: string, stateFile = resolveUpdateStateFile()): Promise<void> {
  const state = await readUpdateState(stateFile);
  await writeUpdateState({ ...state, dismissedVersion: latestVersion }, stateFile);
}


export function buildSelfUpdatePlan(availability: UpdateAvailability): SelfUpdatePlan {
  if (availability.installContext === "source-checkout") {
    return {
      canAutoRun: false,
      reason: "source checkout detected",
      manualSteps: [
        "git pull",
        "npm install",
        "npm run build",
        `or reinstall the published CLI: npm install -g ${CLI_PACKAGE_NAME}@latest`,
      ],
    };
  }

  return {
    canAutoRun: true,
    command: process.env.CODEX_CHANNELS_UPDATE_COMMAND ?? "npm",
    args: process.env.CODEX_CHANNELS_UPDATE_ARGS
      ? process.env.CODEX_CHANNELS_UPDATE_ARGS.split(" ").filter(Boolean)
      : ["install", "-g", `${CLI_PACKAGE_NAME}@latest`],
    manualSteps: [`npm install -g ${CLI_PACKAGE_NAME}@latest`],
  };
}

export async function runSelfUpdatePlan(plan: SelfUpdatePlan): Promise<{ ok: boolean; exitCode: number | null }> {
  if (!plan.canAutoRun || !plan.command) {
    return { ok: false, exitCode: null };
  }

  const child = spawn(plan.command, plan.args ?? [], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { ok: exitCode === 0, exitCode };
}
