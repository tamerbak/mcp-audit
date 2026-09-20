import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { Severity } from "./types.js";
import { ALL_SEVERITIES } from "./types.js";

/** User-facing configuration, loaded from `.mcpauditrc` or a config file. */
export interface McpAuditConfig {
  /** Rule ids to disable. */
  disabledRules: string[];
  /** If non-empty, only these rule ids run. */
  enabledRules: string[];
  /** When true, enabledRules is an allowlist (including empty → no rules). */
  enforceEnabledRules: boolean;
  /** Per-rule severity overrides. */
  severityOverrides: Record<string, Severity>;
  /** Findings at or above this severity cause a non-zero exit. */
  failOn: Severity;
  /** Location or rule-id substrings to ignore in findings. */
  ignore: string[];
}

export const DEFAULT_CONFIG: McpAuditConfig = {
  disabledRules: [],
  enabledRules: [],
  enforceEnabledRules: false,
  severityOverrides: {},
  failOn: "high",
  ignore: [],
};

const KNOWN_CONFIG_KEYS = new Set<string>([
  "disabledRules",
  "enabledRules",
  "enforceEnabledRules",
  "severityOverrides",
  "failOn",
  "ignore",
]);

function assertKnownConfigKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      throw new Error(`Unknown config key "${key}".`);
    }
  }
}

const CONFIG_FILENAMES = [
  ".mcpauditrc",
  ".mcpauditrc.json",
  "mcpaudit.config.json",
];

/** Find the nearest config file walking up from `startDir`. */
export function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  // Walk up to the filesystem root.
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function assertSeverity(value: unknown, field: string): Severity {
  if (typeof value === "string" && ALL_SEVERITIES.includes(value as Severity)) {
    return value as Severity;
  }
  throw new Error(
    `Invalid severity "${String(value)}" for ${field}; expected one of ${ALL_SEVERITIES.join(", ")}.`,
  );
}

/** Merge a partial, untrusted config object onto the defaults with validation. */
export function normalizeConfig(
  raw: unknown,
  base: McpAuditConfig = DEFAULT_CONFIG,
): McpAuditConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  assertKnownConfigKeys(obj);
  const config: McpAuditConfig = {
    disabledRules: [...base.disabledRules],
    enabledRules: [...base.enabledRules],
    enforceEnabledRules: base.enforceEnabledRules,
    severityOverrides: { ...base.severityOverrides },
    failOn: base.failOn,
    ignore: [...base.ignore],
  };

  if (obj.disabledRules !== undefined) {
    if (!Array.isArray(obj.disabledRules)) {
      throw new Error("Invalid disabledRules; expected an array of rule ids.");
    }
    config.disabledRules = obj.disabledRules.map(String);
  }
  if (Array.isArray(obj.enabledRules)) {
    config.enabledRules = obj.enabledRules.map(String);
  }
  if (obj.enforceEnabledRules === true) {
    config.enforceEnabledRules = true;
  }
  if (Array.isArray(obj.ignore)) {
    config.ignore = obj.ignore.map(String);
  }
  if (obj.failOn !== undefined) {
    config.failOn = assertSeverity(obj.failOn, "failOn");
  }
  if (obj.severityOverrides && typeof obj.severityOverrides === "object") {
    const overrides: Record<string, Severity> = {};
    for (const [id, sev] of Object.entries(
      obj.severityOverrides as Record<string, unknown>,
    )) {
      overrides[id] = assertSeverity(sev, `severityOverrides.${id}`);
    }
    config.severityOverrides = { ...config.severityOverrides, ...overrides };
  }
  return config;
}

/** Load config from an explicit path or by discovery; returns defaults if none. */
export async function loadConfig(options: {
  explicitPath?: string;
  cwd?: string;
} = {}): Promise<{ config: McpAuditConfig; path?: string }> {
  const path =
    options.explicitPath ?? findConfigFile(options.cwd ?? process.cwd());
  if (!path) return { config: DEFAULT_CONFIG };
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse config file ${absolute}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return { config: normalizeConfig(parsed), path };
}
