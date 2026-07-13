import { describe, expect, test } from "bun:test";
import {
  extractShellQuery,
  findHistorySuffix,
  parseZshHistory,
  resolveZshHistoryFile,
  ZshHistoryService,
} from "../zsh-history.ts";

describe("parseZshHistory", () => {
  test("parses plain history newest-first", () => {
    expect(parseZshHistory("git status\nnpm test\n")).toEqual([
      "npm test",
      "git status",
    ]);
  });

  test("strips extended-history metadata", () => {
    expect(parseZshHistory(
      ": 1710000000:0;git status --short\n: 1710000001:2;npm run test\n",
    )).toEqual(["npm run test", "git status --short"]);
  });

  test("keeps the newest duplicate", () => {
    expect(parseZshHistory("git status\nnpm test\ngit status\n")).toEqual([
      "git status",
      "npm test",
    ]);
  });

  test("skips complete extended and plain multiline entries", () => {
    expect(parseZshHistory([
      ": 1710000000:0;printf 'one\\",
      "two'",
      "echo first\\",
      "echo second",
      ": 1710000001:0;git status",
    ].join("\n"))).toEqual(["git status"]);
  });

  test("parses plain entries after extended entries", () => {
    expect(parseZshHistory([
      ": 1710000000:0;git status",
      "npm test",
      "\\: literal colon command",
    ].join("\n"))).toEqual([
      ": literal colon command",
      "npm test",
      "git status",
    ]);
  });

  test("caps retained entries after newest-first deduplication", () => {
    expect(parseZshHistory("one\ntwo\nthree\nfour\n", { maxEntries: 2 }))
      .toEqual(["four", "three"]);
  });

  test("omits secret-like and terminal-control entries", () => {
    expect(parseZshHistory([
      "echo safe",
      "curl -H 'Authorization: Bearer abc123' example.com",
      "API_KEY=abc command",
      "echo password=hunter2",
      "echo \\x1b[31munsafe",
      "-----BEGIN PRIVATE KEY-----",
    ].join("\n").replace("\\x1b", "\x1b"))).toEqual(["echo safe"]);
  });
});

describe("history matching", () => {
  test("returns no suggestion for an empty query or exact match", () => {
    expect(findHistorySuffix(["git status"], "")).toBeNull();
    expect(findHistorySuffix(["git status"], "   ")).toBeNull();
    expect(findHistorySuffix(["git status"], "git status")).toBeNull();
  });

  test("selects the newest strict-prefix suffix case-sensitively", () => {
    expect(findHistorySuffix(
      ["git status --short", "git stash", "Git status"],
      "git sta",
    )).toBe("tus --short");
    expect(findHistorySuffix(["Git status"], "git")).toBeNull();
  });

  test("recent Pi commands outrank file history and deduplicate", () => {
    const history = new ZshHistoryService({ historyFile: "/missing" });
    history.replaceFileEntries(["git status --short"]);
    history.addPiCommand("git stash");
    history.addPiCommand("git status --porcelain");
    history.addPiCommand("git stash");

    expect(history.findSuffix("git sta")).toBe("sh");
    history.dispose();
  });
});

describe("shell query and history path", () => {
  test("extracts ! and !! queries while ignoring prefix-adjacent whitespace", () => {
    expect(extractShellQuery("! git sta")).toEqual({
      prefix: "!",
      query: "git sta",
    });
    expect(extractShellQuery("!!npm run te")).toEqual({
      prefix: "!!",
      query: "npm run te",
    });
    expect(extractShellQuery(" !git status")).toBeNull();
    expect(extractShellQuery("!git\nstatus")).toBeNull();
  });

  test("resolves configured history paths in priority order", () => {
    expect(resolveZshHistoryFile({
      ZSH_HISTORY_FILE: "~/preferred",
      HISTFILE: "/ignored",
    }, "/home/test")).toBe("/home/test/preferred");
    expect(resolveZshHistoryFile({ HISTFILE: "/custom/history" }, "/home/test"))
      .toBe("/custom/history");
    expect(resolveZshHistoryFile({}, "/home/test"))
      .toBe("/home/test/.zsh_history");
  });
});
