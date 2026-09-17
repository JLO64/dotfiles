import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
	isSafeAgentName,
	loadRestrictedAgentFromDir,
	resolveRestrictedAgentFromDirs,
} from "../agents.ts";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function makeDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-restricted-agents-"));
	directories.push(directory);
	return directory;
}

function writeProfile(directory: string, fileName: string, name: string, description = "Restricted agent"): void {
	fs.writeFileSync(path.join(directory, fileName), `---\nname: ${name}\ndescription: ${description}\ncontext-token-limit: 90000\n---\nPrompt\n`);
}

describe("restricted agent profiles", () => {
	test("accepts only exact safe names and matching profile names", () => {
		const directory = makeDirectory();
		writeProfile(directory, "private.md", "private");
		writeProfile(directory, "mismatch.md", "other");

		assert.equal(loadRestrictedAgentFromDir(directory, "user", "private")?.name, "private");
		assert.equal(loadRestrictedAgentFromDir(directory, "user", "mismatch"), undefined);
		for (const name of ["../private", "private/other", ".", "..", "private name"]) {
			assert.equal(isSafeAgentName(name), false);
			assert.equal(loadRestrictedAgentFromDir(directory, "user", name), undefined);
		}
	});

	test("honors scope and project precedence without enumerating directories", () => {
		const userDirectory = makeDirectory();
		const projectDirectory = makeDirectory();
		writeProfile(userDirectory, "private.md", "private", "User profile");
		writeProfile(projectDirectory, "private.md", "private", "Project profile");

		assert.equal(resolveRestrictedAgentFromDirs("private", "user", userDirectory, projectDirectory)?.description, "User profile");
		assert.equal(resolveRestrictedAgentFromDirs("private", "project", userDirectory, projectDirectory)?.description, "Project profile");
		assert.equal(resolveRestrictedAgentFromDirs("private", "both", userDirectory, projectDirectory)?.description, "Project profile");
		assert.equal(resolveRestrictedAgentFromDirs("missing", "both", userDirectory, projectDirectory), undefined);
	});
});
