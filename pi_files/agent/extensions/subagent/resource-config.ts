import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "./agents.ts";

export function resolveAgentResourcePath(agentFilePath: string, resourcePath: string): string {
	if (path.isAbsolute(resourcePath)) return path.normalize(resourcePath);
	return path.resolve(path.dirname(agentFilePath), resourcePath);
}

export function buildAgentResourceArgs(
	agent: AgentConfig,
	pathExists: (resourcePath: string) => boolean = fs.existsSync,
): string[] {
	const args: string[] = [];

	if (agent.isolateExtensions) args.push("--no-extensions");
	for (const extension of agent.extensions ?? []) {
		const resolvedPath = resolveAgentResourcePath(agent.filePath, extension);
		if (!pathExists(resolvedPath)) {
			throw new Error(`Agent "${agent.name}" extension does not exist: ${resolvedPath}`);
		}
		args.push("-e", resolvedPath);
	}

	if (agent.isolateSkills) args.push("--no-skills");
	for (const skill of agent.skills ?? []) {
		const resolvedPath = resolveAgentResourcePath(agent.filePath, skill);
		if (!pathExists(resolvedPath)) {
			throw new Error(`Agent "${agent.name}" skill does not exist: ${resolvedPath}`);
		}
		args.push("--skill", resolvedPath);
	}

	return args;
}
