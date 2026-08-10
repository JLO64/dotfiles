import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { parseAgentContent, type AgentConfig } from "../agents.ts";
import { buildAgentResourceArgs, resolveAgentResourcePath } from "../resource-config.ts";

const profilePath = "/repo/.pi/agents/example.md";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "example",
		description: "Test agent",
		systemPrompt: "Test prompt",
		source: "project",
		filePath: profilePath,
		...overrides,
	};
}

describe("agent resource frontmatter", () => {
	test("parses lists and isolation booleans", () => {
		const agent = parseAgentContent(
			`---
name: example
description: Test agent
tools: read, bash
extensions: ./one.ts, /opt/pi/two.ts
skills: ../restricted-skills/one/SKILL.md, /opt/pi/two/SKILL.md
isolate-extensions: true
isolate-skills: false
---
Prompt body.
`,
			profilePath,
			"project",
		);

		expect(agent).not.toBeNull();
		expect(agent?.tools).toEqual(["read", "bash"]);
		expect(agent?.extensions).toEqual(["./one.ts", "/opt/pi/two.ts"]);
		expect(agent?.skills).toEqual(["../restricted-skills/one/SKILL.md", "/opt/pi/two/SKILL.md"]);
		expect(agent?.isolateExtensions).toBe(true);
		expect(agent?.isolateSkills).toBe(false);
	});

	test("preserves existing profiles without resource fields", () => {
		const agent = parseAgentContent(
			`---
name: example
description: Test agent
tools: read
---
Prompt body.
`,
			profilePath,
			"project",
		);

		expect(agent?.extensions).toBeUndefined();
		expect(agent?.skills).toBeUndefined();
		expect(agent?.isolateExtensions).toBeUndefined();
		expect(agent?.isolateSkills).toBeUndefined();
	});
});

describe("agent resource paths", () => {
	test("resolves relative paths from the profile directory", () => {
		expect(resolveAgentResourcePath(profilePath, "../restricted-skills/serve-docker/SKILL.md")).toBe(
			path.normalize("/repo/.pi/restricted-skills/serve-docker/SKILL.md"),
		);
	});

	test("keeps absolute paths absolute", () => {
		expect(resolveAgentResourcePath(profilePath, "/opt/pi/restricted/web-search.ts")).toBe(
			path.normalize("/opt/pi/restricted/web-search.ts"),
		);
	});
});

describe("pi resource arguments", () => {
	const exists = () => true;

	test("preserves existing behavior when no resource fields are set", () => {
		expect(buildAgentResourceArgs(makeAgent(), exists)).toEqual([]);
	});

	test("adds resources without disabling discovery when isolation is off", () => {
		const agent = makeAgent({
			extensions: ["./extension.ts"],
			skills: ["./skill/SKILL.md"],
		});

		expect(buildAgentResourceArgs(agent, exists)).toEqual([
			"-e",
			"/repo/.pi/agents/extension.ts",
			"--skill",
			"/repo/.pi/agents/skill/SKILL.md",
		]);
	});

	test("disables discovery before adding isolated resources", () => {
		const agent = makeAgent({
			extensions: ["./one.ts", "/opt/pi/two.ts"],
			skills: ["../restricted-skills/one/SKILL.md"],
			isolateExtensions: true,
			isolateSkills: true,
		});

		expect(buildAgentResourceArgs(agent, exists)).toEqual([
			"--no-extensions",
			"-e",
			"/repo/.pi/agents/one.ts",
			"-e",
			"/opt/pi/two.ts",
			"--no-skills",
			"--skill",
			"/repo/.pi/restricted-skills/one/SKILL.md",
		]);
	});

	test("supports isolated sessions with no explicitly loaded resources", () => {
		const agent = makeAgent({ isolateExtensions: true, isolateSkills: true });
		expect(buildAgentResourceArgs(agent, exists)).toEqual(["--no-extensions", "--no-skills"]);
	});

	test("reports a missing extension with the agent name and resolved path", () => {
		const agent = makeAgent({ extensions: ["./missing.ts"] });
		expect(() => buildAgentResourceArgs(agent, () => false)).toThrow(
			'Agent "example" extension does not exist: /repo/.pi/agents/missing.ts',
		);
	});

	test("reports a missing skill with the agent name and resolved path", () => {
		const agent = makeAgent({ skills: ["../restricted-skills/missing/SKILL.md"] });
		expect(() => buildAgentResourceArgs(agent, () => false)).toThrow(
			'Agent "example" skill does not exist: /repo/.pi/restricted-skills/missing/SKILL.md',
		);
	});
});
