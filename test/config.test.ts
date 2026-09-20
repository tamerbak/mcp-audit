import { describe, it, expect } from "vitest";
import { normalizeConfig, loadConfig, DEFAULT_CONFIG } from "../src/config.js";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("normalizeConfig", () => {
  it("returns defaults for an empty object", () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("merges rule toggles and thresholds", () => {
    const config = normalizeConfig({
      disabledRules: ["MCP012"],
      enabledRules: ["MCP001"],
      failOn: "critical",
      ignore: ["fetch_url"],
      severityOverrides: { MCP021: "high" },
    });
    expect(config.disabledRules).toEqual(["MCP012"]);
    expect(config.enabledRules).toEqual(["MCP001"]);
    expect(config.failOn).toBe("critical");
    expect(config.ignore).toEqual(["fetch_url"]);
    expect(config.severityOverrides.MCP021).toBe("high");
  });

  it("rejects unknown top-level config keys", () => {
    expect(() =>
      normalizeConfig({ disabledRule: ["MCP001"] }),
    ).toThrow(/disabledRule/);
  });

  it("rejects an invalid failOn severity", () => {
    expect(() => normalizeConfig({ failOn: "catastrophic" })).toThrow(
      /Invalid severity/,
    );
  });

  it("rejects a non-array disabledRules value", () => {
    expect(() => normalizeConfig({ disabledRules: "MCP001" })).toThrow(
      /disabledRules.*array/i,
    );
  });

  it("rejects an invalid severity override", () => {
    expect(() =>
      normalizeConfig({ severityOverrides: { MCP001: "nope" } }),
    ).toThrow(/Invalid severity/);
  });

  it("overlays onto a provided base config", () => {
    const base = normalizeConfig({ disabledRules: ["A"], failOn: "medium" });
    const overlaid = normalizeConfig({ disabledRules: ["B"] }, base);
    expect(overlaid.disabledRules).toEqual(["B"]);
    expect(overlaid.failOn).toBe("medium");
  });
});

describe("loadConfig", () => {
  it("wraps JSON syntax errors with the resolved file path", async () => {
    const dir = join(tmpdir(), `mcp-audit-test-${Math.random()}`);
    await mkdir(dir);
    const relativePath = "broken.json";
    const absolutePath = resolve(dir, relativePath);
    await writeFile(absolutePath, "{ invalid json ", "utf8");
    const previousCwd = process.cwd();
    try {
      process.chdir(dir);
      await loadConfig({ explicitPath: relativePath });
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain(absolutePath);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
