import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { createAgentAndSkillAutocompleteProvider, loadAgentItemsFromDirs } from "../autocomplete.ts";

const fallback: AutocompleteProvider = {
  triggerCharacters: [],
  async getSuggestions() {
    return null;
  },
  applyCompletion(lines, cursorLine, cursorCol) {
    return { lines, cursorLine, cursorCol };
  },
};

const options = { signal: new AbortController().signal };
const getResolvedSkillCommands = () => [
  { name: "skill:html-visualization", description: "Generate HTML visualizations", source: "skill" },
  { name: "skill:create-documentation", description: "Create documentation", source: "skill" },
  { name: "skill:design-language", description: "Apply the design language", source: "skill" },
  { name: "skill:page-preview", description: "Preview pages", source: "skill" },
  { name: "skill:serve-docker", description: "Serve with Docker", source: "skill" },
] as const;

describe("agent and skill autocomplete", () => {
  test("offers installed agents for # references", async () => {
    const provider = createAgentAndSkillAutocompleteProvider(fallback, process.cwd(), getResolvedSkillCommands);
    const result = await provider.getSuggestions(["Dispatch #local"], 0, 15, options);

    expect(result?.prefix).toBe("#local");
    expect(result?.items.some((item) => item.value === "#local-researcher")).toBe(true);
    expect(result?.items.every((item) => item.description === undefined)).toBe(true);
  });

  test("includes restricted profiles with public and project precedence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-vim-agents-"));
    const userAgents = path.join(root, "user-agents");
    const projectAgents = path.join(root, "project-agents");
    const userRestricted = path.join(root, "user-restricted");
    const projectRestricted = path.join(root, "project-restricted");
    for (const directory of [userAgents, projectAgents, userRestricted, projectRestricted]) fs.mkdirSync(directory);
    const profile = (directory: string, name: string, description: string) =>
      fs.writeFileSync(path.join(directory, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n`);

    try {
      profile(userRestricted, "restricted", "user restricted");
      profile(projectRestricted, "restricted", "project restricted");
      profile(userAgents, "restricted", "user public");
      profile(projectAgents, "restricted", "project public");
      profile(projectRestricted, "project-only", "project restricted");
      profile(userRestricted, "unsafe name", "unsafe");

      const items = loadAgentItemsFromDirs(userAgents, projectAgents, userRestricted, projectRestricted);
      expect(items.map((item) => item.value)).toEqual(["#restricted", "#project-only"]);
      expect(items.find((item) => item.value === "#restricted")?.searchText).toContain("project public");
      expect(items.some((item) => item.value === "#unsafe name")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("offers Pi-resolved skills, including the secure-webapp project skills", async () => {
    const provider = createAgentAndSkillAutocompleteProvider(fallback, process.cwd(), getResolvedSkillCommands);
    const result = await provider.getSuggestions(["using $"], 0, 7, options);

    expect(result?.prefix).toBe("$");
    expect(result?.items.map((item) => item.value)).toEqual([
      "$html-visualization",
      "$create-documentation",
      "$design-language",
      "$page-preview",
      "$serve-docker",
    ]);
    expect(result?.items.every((item) => item.description === undefined)).toBe(true);
  });

  test("closes a collapsed trigger picker without falling back to files", async () => {
    let fallbackCalls = 0;
    const trackingFallback: AutocompleteProvider = {
      ...fallback,
      async getSuggestions() {
        fallbackCalls++;
        return { items: [{ value: "@file", label: "@file" }], prefix: "@" };
      },
    };
    const provider = createAgentAndSkillAutocompleteProvider(
      trackingFallback,
      process.cwd(),
      getResolvedSkillCommands,
    );

    expect(await provider.getSuggestions([" "], 0, 1, options)).toBeNull();
    expect(fallbackCalls).toBe(0);
  });

  test("continues to delegate normal @ file references", async () => {
    let fallbackCalls = 0;
    const trackingFallback: AutocompleteProvider = {
      ...fallback,
      async getSuggestions() {
        fallbackCalls++;
        return { items: [{ value: "@file", label: "@file" }], prefix: "@file" };
      },
    };
    const provider = createAgentAndSkillAutocompleteProvider(
      trackingFallback,
      process.cwd(),
      getResolvedSkillCommands,
    );

    expect(await provider.getSuggestions([" @file"], 0, 6, options)).toEqual({
      items: [{ value: "@file", label: "@file" }],
      prefix: "@file",
    });
    expect(fallbackCalls).toBe(1);
  });

  test("inserts a selected reference followed by one space", () => {
    const provider = createAgentAndSkillAutocompleteProvider(fallback, process.cwd(), getResolvedSkillCommands);
    const result = provider.applyCompletion(["Dispatch #loc"], 0, 13, {
      value: "#local-researcher",
      label: "#local-researcher",
    }, "#loc");

    expect(result).toEqual({
      lines: ["Dispatch #local-researcher "],
      cursorLine: 0,
      cursorCol: 27,
    });
  });
});
