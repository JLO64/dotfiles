import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
	// pi version — try bun path first (fast), then npm root -g
	let version = "unknown";
	try {
		const bunPkg = join(
			homedir(),
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"package.json",
		);
		if (existsSync(bunPkg)) {
			version = (JSON.parse(readFileSync(bunPkg, "utf-8")) as { version: string }).version;
		}
	} catch {
		// not a bun global install
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
				"@earendil-works",
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

	// context files — global + walk up from cwd
	const contextFiles: string[] = [];
	const seen = new Set<string>();
	for (const name of ["AGENTS.md", "CLAUDE.md"]) {
		const p = join(agentDir, name);
		if (existsSync(p)) {
			contextFiles.push(`~/.pi/agent/${name}`);
			seen.add(p);
		}
	}
	{
		let dir = process.cwd();
		const root = "/";
		while (dir !== root) {
			for (const name of ["AGENTS.md", "CLAUDE.md"]) {
				const p = join(dir, name);
				if (existsSync(p) && !seen.has(p)) {
					const home = homedir();
					contextFiles.push(p.startsWith(home) ? `~${p.slice(home.length)}` : p);
					seen.add(p);
				}
			}
			const parent = join(dir, "..");
			if (parent === dir) break;
			dir = parent;
		}
	}

	// skills — directories with SKILL.md (global + project), plus settings + .agents/
	const skills: string[] = [];

	const discoverSkillsInDir = (
		base: string,
		prefix: string,
		rootMd: boolean,
	) => {
		if (!existsSync(base)) return;
		for (const entry of readdirSync(base)) {
			const full = join(base, entry);
			try {
				if (statSync(full).isDirectory()) {
					if (existsSync(join(full, "SKILL.md"))) {
						skills.push(`${prefix}${entry}`);
					}
				} else if (
					rootMd &&
					entry.endsWith(".md") &&
					statSync(full).isFile()
				) {
					skills.push(`${prefix}${entry.replace(/\.md$/, "")}`);
				}
			} catch {
				// skip unreadable entries
			}
		}
	};

	// helper: read a settings file and discover skills from its "skills" array
	const discoverSkillsFromSettings = (settingsPath: string) => {
		if (!existsSync(settingsPath)) return;
		let s: Record<string, unknown> = {};
		try {
			s = JSON.parse(readFileSync(settingsPath, "utf-8"));
		} catch {
			return;
		}
		const list = (s.skills as string[]) ?? [];
		if (list.length === 0) return;
		// paths relative to settings file directory; ~ and absolute supported
		const base = join(settingsPath, "..");
		for (const raw of list) {
			const resolved = raw.startsWith("~")
				? join(homedir(), raw.slice(1))
				: raw.startsWith("/")
					? raw
					: join(base, raw);
			discoverSkillsInDir(resolved, "", false);
		}
	};

	// global — ~/.pi/agent/skills/ (dirs + root .md)
	discoverSkillsInDir(join(agentDir, "skills"), "", true);
	// global — ~/.pi/agent/settings.json skills array
	discoverSkillsFromSettings(join(agentDir, "settings.json"));

	// project — .pi/skills/ in cwd + ancestors (dirs + root .md)
	{
		let dir = process.cwd();
		const root = "/";
		while (dir !== root) {
			const prefix =
				dir === process.cwd() ? "" : `${dir}/.pi/skills/`;
			discoverSkillsInDir(join(dir, ".pi", "skills"), prefix, true);
			const parent = join(dir, "..");
			if (parent === dir) break;
			dir = parent;
		}
	}
	// project — .agents/skills/ in cwd + ancestors (dirs only, no root .md)
	{
		let dir = process.cwd();
		const root = "/";
		while (dir !== root) {
			discoverSkillsInDir(join(dir, ".agents", "skills"), "", false);
			const parent = join(dir, "..");
			if (parent === dir) break;
			dir = parent;
		}
	}
	// project — .pi/settings.json skills array
	discoverSkillsFromSettings(join(process.cwd(), ".pi", "settings.json"));

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

		// ── OpenRouter credits ────────────────────────────────────────
		let creditsLine: string | null = null;
		try {
			const apiKey = process.env.OPENROUTER_API_KEY;
			if (apiKey) {
				const resp = await fetch("https://openrouter.ai/api/v1/credits", {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				if (resp.ok) {
					const body = (await resp.json()) as {
						data: { total_credits: number; total_usage: number };
					};
					const remaining = body.data.total_credits - body.data.total_usage;
					creditsLine = `$${(Math.floor(remaining * 100) / 100).toFixed(2)}`;
				}
			}
		} catch {
			// offline or key missing — skip the line
		}

		ctx.ui.setWidget("custom-header", (_tui, theme) => {
			const lines: string[] = [];

			// pi version
			lines.push(formatLine("pi", [r.version], theme));

			// openrouter credits
			if (creditsLine) {
				lines.push(formatLine("OpenRouter Credits", [creditsLine], theme));
			}

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
				render: (width: number) => lines.map((l) => truncateToWidth(l, width)),
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
