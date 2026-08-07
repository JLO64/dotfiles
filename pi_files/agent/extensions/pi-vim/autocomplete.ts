import * as fs from "node:fs";
import * as path from "node:path";
import {
  getAgentDir,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

type PickerItem = AutocompleteItem & { searchText: string };

type AgentSource = "user" | "project";
type SkillCommand = { name: string; description?: string; source: string };

function findNearestProjectAgentsDir(cwd: string): string | null {
  let directory = cwd;
  while (true) {
    const candidate = path.join(directory, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Keep walking until reaching the filesystem root.
    }

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function loadAgentsFromDir(directory: string, source: AgentSource): PickerItem[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry): PickerItem[] => {
    if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) {
      return [];
    }

    try {
      const content = fs.readFileSync(path.join(directory, entry.name), "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, string>>(content);
      if (!frontmatter.name || !frontmatter.description) return [];

      return [{
        value: `#${frontmatter.name}`,
        label: `#${frontmatter.name}`,
        searchText: `${frontmatter.name} ${frontmatter.description}`,
      }];
    } catch {
      return [];
    }
  });
}

function loadAgentItems(cwd: string): PickerItem[] {
  const byName = new Map<string, PickerItem>();
  for (const item of loadAgentsFromDir(path.join(getAgentDir(), "agents"), "user")) {
    byName.set(item.value, item);
  }

  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  if (projectAgentsDir) {
    for (const item of loadAgentsFromDir(projectAgentsDir, "project")) {
      // Project-local definitions take precedence, consistent with the subagent extension.
      byName.set(item.value, item);
    }
  }

  return [...byName.values()];
}

function loadSkillItems(getCommands: () => readonly SkillCommand[]): PickerItem[] {
  return getCommands()
    .filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
    .map((command) => {
      const name = command.name.slice("skill:".length);
      return {
        value: `$${name}`,
        label: `$${name}`,
        searchText: `${name} ${command.description ?? ""}`,
      };
    });
}

function extractToken(textBeforeCursor: string, trigger: "#" | "$"): string | undefined {
  const escapedTrigger = trigger === "$" ? "\\$" : trigger;
  const match = textBeforeCursor.match(new RegExp(`(?:^|[\\s])${escapedTrigger}([^\\s${escapedTrigger}]*)$`));
  return match?.[1];
}

function filterItems(items: PickerItem[], query: string): AutocompleteItem[] {
  if (!query) return items;
  return fuzzyFilter(items, query, (item) => item.searchText);
}

export function createAgentAndSkillAutocompleteProvider(
  current: AutocompleteProvider,
  cwd: string,
  getCommands: () => readonly SkillCommand[],
): AutocompleteProvider {
  const agents = loadAgentItems(cwd);

  return {
    triggerCharacters: ["#", "$"],
    async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
      const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const agentQuery = extractToken(textBeforeCursor, "#");
      if (agentQuery !== undefined) {
        const items = filterItems(agents, agentQuery);
        return items.length > 0 ? { items, prefix: `#${agentQuery}` } : null;
      }

      const skillQuery = extractToken(textBeforeCursor, "$");
      if (skillQuery !== undefined) {
        const items = filterItems(loadSkillItems(getCommands), skillQuery);
        return items.length > 0 ? { items, prefix: `$${skillQuery}` } : null;
      }

      // Pi treats trailing whitespace as an empty file query. When a user
      // backspaces a #, $, or @ token, suppress that fallback so its picker
      // closes rather than changing into a root file picker.
      if (textBeforeCursor.endsWith(" ")) return null;

      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (prefix.startsWith("#") || prefix.startsWith("$")) {
        const currentLine = lines[cursorLine] ?? "";
        const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
        const afterCursor = currentLine.slice(cursorCol);
        const suffix = /^\s/.test(afterCursor) ? "" : " ";
        const newLines = [...lines];
        newLines[cursorLine] = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
        return {
          lines: newLines,
          cursorLine,
          cursorCol: beforePrefix.length + item.value.length + suffix.length,
        };
      }

      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}
