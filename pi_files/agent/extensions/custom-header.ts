import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Clear screen ────────────────────────────────────────────────────────────

function clear() {
	process.stdout.write("\x1b[2J\x1b[H");
}

// ─── Resource discovery ──────────────────────────────────────────────────────

interface Resources {
	version: string;
	scopedModels: string[];
	contextFiles: string[];
	skills: string[];
	extensions: string[];
}

function discoverResources(): Resources {
	// pi version — try nvm path first (fast), then npm root -g
	let version = "unknown";
	try {
		const nvmRoot = join(
			homedir(),
			".nvm",
			"versions",
			"node",
			process.version,
			"lib",
			"node_modules",
		);
		const nvmPkg = join(nvmRoot, "@mariozechner", "pi-coding-agent", "package.json");
		if (existsSync(nvmPkg)) {
			version = (JSON.parse(readFileSync(nvmPkg, "utf-8")) as { version: string }).version;
		}
	} catch {
		// not an nvm install
	}
	if (version === "unknown") {
		try {
			const globalRoot = execSync("npm root -g", {
				encoding: "utf-8",
				timeout: 3000,
				stdio: ["pipe", "pipe", "ignore"],
			}).trim();
			const pkgPath = join(
				globalRoot,
				"@mariozechner",
				"pi-coding-agent",
				"package.json",
			);
			if (existsSync(pkgPath)) {
				version = (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version;
			}
		} catch {
			// offline, no npm, etc.
		}
	}

	// settings
	const agentDir = join(homedir(), ".pi", "agent");
	const settingsPath = join(agentDir, "settings.json");
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch {
		// no settings file
	}

	// scoped models — strip provider (first /) then maker (last /)
	const enabledModels: string[] = (settings.enabledModels as string[]) ?? [];
	const scopedModels = enabledModels.map((m) => {
		let name = m;
		const providerIdx = name.indexOf("/");
		if (providerIdx >= 0) name = name.slice(providerIdx + 1);
		const makerIdx = name.lastIndexOf("/");
		if (makerIdx >= 0) name = name.slice(makerIdx + 1);
		return name;
	});

	// context files
	const contextFiles: string[] = [];
	for (const name of ["AGENTS.md", "CLAUDE.md"]) {
		const p = join(agentDir, name);
		if (existsSync(p)) contextFiles.push(`~/.pi/agent/${name}`);
	}

	// skills — directories containing SKILL.md
	const skillsDir = join(agentDir, "skills");
	const skills: string[] = [];
	if (existsSync(skillsDir)) {
		for (const entry of readdirSync(skillsDir)) {
			const full = join(skillsDir, entry);
			if (statSync(full).isDirectory() && existsSync(join(full, "SKILL.md"))) {
				skills.push(entry);
			}
		}
	}

	// extensions — .ts files and directories with index.ts
	const extensionsDir = join(agentDir, "extensions");
	const extensions: string[] = [];
	if (existsSync(extensionsDir)) {
		for (const entry of readdirSync(extensionsDir)) {
			const full = join(extensionsDir, entry);
			try {
				if (statSync(full).isDirectory()) {
					if (existsSync(join(full, "index.ts"))) {
						extensions.push(formatExtensionName(`${entry}/`));
					}
				} else if (entry.endsWith(".ts")) {
					extensions.push(formatExtensionName(entry));
				}
			} catch {
				// skip unreadable entries
			}
		}
	}
	// packages from settings (strip scheme + scope)
	for (const pkg of (settings.packages as string[]) ?? []) {
		extensions.push(formatExtensionName(String(pkg)));
	}

	return { version, scopedModels, contextFiles, skills, extensions };
}

// ─── Extension name formatting ───────────────────────────────────────────────

function formatExtensionName(raw: string): string {
	let name = raw.replace(/^(npm:|git:)/, "");
	if (name.startsWith("@")) {
		const idx = name.indexOf("/");
		if (idx >= 0) name = name.slice(idx + 1);
	}
	if (name.endsWith(".ts")) name = name.slice(0, -3);
	if (name.endsWith("/")) name = name.slice(0, -1);
	return name;
}

// ─── Widget line builder ─────────────────────────────────────────────────────

function formatLine(
	label: string,
	values: string[],
	// biome-ignore lint/suspicious/noExplicitAny: theme shape varies
	theme: any,
): string {
	const joined = values.join(theme.fg("dim", ", "));
	return `${theme.fg("accent", label)}${theme.fg("dim", ": ")}${joined}`;
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	clear();

	let dismissed = false;

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "new" || event.reason === "resume") {
			clear();
			dismissed = false;
		}

		if (event.reason !== "startup") return;

		dismissed = false;
		const r = discoverResources();

		ctx.ui.setWidget("custom-header", (_tui, theme) => {
			const lines: string[] = [];

			// pi version
			lines.push(formatLine("pi", [r.version], theme));

			// scoped models
			if (r.scopedModels.length > 0) {
				lines.push(formatLine("Scoped Models", r.scopedModels, theme));
			}

			// context
			if (r.contextFiles.length > 0) {
				lines.push(formatLine("Context", r.contextFiles, theme));
			}

			// skills
			if (r.skills.length > 0) {
				lines.push(formatLine("Skills", r.skills, theme));
			}

			// extensions
			if (r.extensions.length > 0) {
				lines.push(formatLine("Extensions", r.extensions, theme));
			}

			// one trailing blank line
			lines.push("");

			return {
				render: () => lines,
				invalidate: () => {},
			};
		});
	});

	// ── Auto-dismiss on first prompt ─────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		if (!dismissed) {
			dismissed = true;
			try {
				ctx.ui.setWidget("custom-header", undefined);
			} catch {
				// ctx may be unavailable during teardown
			}
		}
	});
}
