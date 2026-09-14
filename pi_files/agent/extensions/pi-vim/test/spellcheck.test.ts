import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isCustomWord,
  maskSpellcheckLine,
  maskUnfinishedTrailingWord,
  SPELLCHECK_DEBOUNCE_MS,
  SpellcheckService,
} from "../spellcheck.ts";

async function scan(service: SpellcheckService, lines: string[]): Promise<void> {
  await (service as any).scan(lines, (service as any).revision);
}

describe("spellcheck filtering", () => {
  test("preserves UTF-16 offsets while masking Markdown and technical tokens", () => {
    const line = "prose `codde` https://example.dev @README.md --flag hash123 😀 typo";
    const masked = maskSpellcheckLine(line, [{ start: 6, end: 13, style: "code" }]);
    expect(masked.length).toBe(line.length);
    expect(masked.slice(6, 13)).toBe("       ");
    expect(masked).not.toContain("example");
    expect(masked).not.toContain("README");
    expect(masked).toContain("typo");
  });

  test("masks only an unfinished trailing word, including apostrophes and hyphens", () => {
    expect(maskUnfinishedTrailingWord("definately checke")).toBe("definately       ");
    expect(maskUnfinishedTrailingWord("can't-checke")).toBe("            ");
    expect(maskUnfinishedTrailingWord("checke ")).toBe("checke ");
    expect(maskUnfinishedTrailingWord("beter!")).toBe("beter!");
  });

  test("only accepts one prose word for personal dictionaries", () => {
    expect(isCustomWord("Cyberknight")).toBe(true);
    expect(isCustomWord("can't")).toBe(true);
    expect(isCustomWord("two words")).toBe(false);
    expect(isCustomWord("path/file")).toBe(false);
    expect(isCustomWord("word2")).toBe(false);
  });

  test("masks technical text while retaining Unicode UTF-16 offsets for prose", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["😀 definately `codde` https://example.dev"]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 3, end: 13, word: "definately" }]);
    } finally {
      service.dispose();
    }
  });
});

describe("spellcheck dictionaries", () => {
  test("accepts common English after bundled dictionaries initialize", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["This is a simple English sentence with common words."]);
      expect(service.getSpans()).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  test("does not flag the reported English sentence", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["This spell checking test appears there's some sort of issue."]);
      expect(service.getSpans()).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  test("reports a known typo at its exact range", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["This is definately wrong."]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 8, end: 18, word: "definately" }]);
    } finally {
      service.dispose();
    }
  });

  test("excludes an unterminated trailing typo without hiding an earlier typo", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["This is definately checke"]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 8, end: 18, word: "definately" }]);
    } finally {
      service.dispose();
    }
  });

  test("checks a trailing typo once whitespace or punctuation terminates it", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["This is checke "]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 8, end: 14, word: "checke" }]);
      await scan(service, ["much beter!"]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 5, end: 10, word: "beter" }]);
    } finally {
      service.dispose();
    }
  });

  test("preserves Unicode UTF-16 offsets when excluding the trailing word", async () => {
    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      await scan(service, ["😀 definately checke"]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 3, end: 13, word: "definately" }]);
    } finally {
      service.dispose();
    }
  });

  test("applies personal words after bundled dictionaries initialize", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-vim-spellcheck-"));
    const service = new SpellcheckService(directory);
    try {
      await scan(service, ["Cyberknight "]);
      expect(service.getSpans()).toEqual([{ line: 0, start: 0, end: 11, word: "cyberknight" }]);
      expect(await service.addWord("Cyberknight")).toBe(true);
      await scan(service, ["Cyberknight "]);
      expect(service.getSpans()).toEqual([]);
    } finally {
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("spellcheck scheduling", () => {
  test("uses a 50 ms debounce", () => {
    expect(SPELLCHECK_DEBOUNCE_MS).toBe(50);
  });

  test("replaces the pending timer when edits are debounced", () => {
    const originalClearTimeout = globalThis.clearTimeout;
    let clearCalls = 0;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout> | undefined) => {
      clearCalls++;
      return originalClearTimeout(timer);
    }) as typeof clearTimeout;

    const service = new SpellcheckService(join(tmpdir(), "pi-vim-spellcheck-unused"));
    try {
      service.schedule(["definately"]);
      service.schedule(["the"]);
      expect(clearCalls).toBe(1);
    } finally {
      service.dispose();
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

describe("personal dictionary", () => {
  test("persists and deduplicates accepted words", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-vim-spellcheck-"));
    try {
      const service = new SpellcheckService(directory);
      expect(await service.addWord("Cyberknight")).toBe(true);
      expect(await service.addWord("cyberknight")).toBe(true);
      expect(service.getWords()).toEqual(["cyberknight"]);

      const reloaded = new SpellcheckService(directory);
      await reloaded.start();
      expect(reloaded.getWords()).toEqual(["cyberknight"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
