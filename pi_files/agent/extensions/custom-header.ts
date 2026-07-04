import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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
	subagents: string[];
}

interface ChatGPTUsageResponse {
	used_percent?: number;
	remaining_percent?: number;
	reset_at?: number;
	rate_limit?: {
		primary_window?: {
			used_percent?: number;
			reset_at?: number;
			reset_after_seconds?: number;
			limit_window_seconds?: number;
		};
		secondary_window?: {
			used_percent?: number;
			reset_at?: number;
			reset_after_seconds?: number;
			limit_window_seconds?: number;
		};
	};
	data?: {
		used_percent?: number;
		remaining_percent?: number;
		reset_at?: number;
	};
}

interface PiAuthFile {
	"openai-codex"?: {
		access?: unknown;
		access_token?: unknown;
		accountId?: unknown;
	};
	tokens?: {
		access_token?: unknown;
	};
	access?: unknown;
	access_token?: unknown;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function parseFrontmatterName(content: string): string | null {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) return null;

	const lines = trimmed.split(/\r?\n/);
	let endIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === "---" || line === "...") {
			endIndex = i;
			break;
		}
	}
	if (endIndex < 0) return null;

	for (let i = 1; i < endIndex; i++) {
		const match = lines[i].match(/^name\s*:\s*(.+)\s*$/i);
		if (!match) continue;

		let name = match[1].trim();
		if (
			(name.startsWith('"') && name.endsWith('"')) ||
			(name.startsWith("'") && name.endsWith("'"))
		) {
			name = name.slice(1, -1).trim();
		}
		return name.length > 0 ? name : null;
	}

	return null;
}

function discoverNamesInDir(dir: string): string[] {
	const names: string[] = [];
	if (!existsSync(dir)) return names;

	for (const entry of readdirSync(dir)) {
		if (!entry.endsWith(".md")) continue;

		const full = join(dir, entry);
		try {
			if (!statSync(full).isFile()) continue;
			const content = readFileSync(full, "utf-8");
			const name = parseFrontmatterName(content) ?? basename(entry, ".md");
			if (name.length > 0) names.push(name);
		} catch {
			// skip unreadable entries
		}
	}

	return names;
}

function findNearestAncestorDir(startDir: string, childDirName: string): string | null {
	let dir = startDir;
	const root = "/";
	while (dir !== root) {
		const candidate = join(dir, ".pi", childDirName);
		try {
			if (statSync(candidate).isDirectory()) return candidate;
		} catch {
			// ignore missing or unreadable candidates
		}
		const parent = join(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

function formatDurationShort(ms: number): string {
	const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	return `${minutes}m`;
}

function formatRemainingWindowDuration(
	window:
		| {
			reset_at?: number;
			reset_after_seconds?: number;
		}
		| undefined,
): string | null {
	const remainingMs =
		typeof window?.reset_after_seconds === "number"
			? window.reset_after_seconds * 1000
			: typeof window?.reset_at === "number"
				? (window.reset_at > 1e12 ? window.reset_at : window.reset_at * 1000) - Date.now()
				: null;
	if (remainingMs === null) return null;

	return formatDurationShort(remainingMs);
}

function readOpenAICodexAccessToken(): string | null {
	for (const path of [
		join(homedir(), ".pi", "agent", "auth.json"),
		join(homedir(), ".codex", "auth.json"),
	]) {
		if (!existsSync(path)) continue;
		try {
			const auth = JSON.parse(readFileSync(path, "utf-8")) as PiAuthFile;
			const entry = auth["openai-codex"];
			const token =
				readString(entry?.access) ??
				readString(entry?.access_token) ??
				readString(auth.tokens?.access_token) ??
				readString(auth.access_token) ??
				readString(auth.access);
			if (token) return token;
		} catch {
			// ignore malformed auth files
		}
	}

	return null;
}

type ChatGPTUsageLinePart = { used: number; duration: string };

async function fetchChatGPTPlusUsage(): Promise<{
	primary: ChatGPTUsageLinePart | null;
	secondary: ChatGPTUsageLinePart | null;
} | null> {
	const authPath = join(homedir(), ".pi", "agent", "auth.json");
	let accountId: string | null = null;
	if (existsSync(authPath)) {
		try {
			const auth = JSON.parse(readFileSync(authPath, "utf-8")) as PiAuthFile;
			accountId = readString(auth["openai-codex"]?.accountId);
		} catch {
			// ignore malformed auth files
		}
	}

	const accessToken = readOpenAICodexAccessToken();
	if (!accessToken) return null;

	const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
	if (accountId) headers["ChatGPT-Account-Id"] = accountId;

	const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
		headers,
	});
	if (!resp.ok) return null;

	const body = (await resp.json()) as ChatGPTUsageResponse;
	const primary = body.rate_limit?.primary_window;
	const secondary = body.rate_limit?.secondary_window;
	const source = body.data ?? body;

	const formatWindow = (
		window:
			| {
				used_percent?: number;
				reset_at?: number;
				reset_after_seconds?: number;
				limit_window_seconds?: number;
			}
			| undefined,
	) => {
		const usedPercent =
			typeof window?.used_percent === "number"
				? window.used_percent
				: typeof source.remaining_percent === "number" && window === primary
					? 100 - source.remaining_percent
					: typeof source.used_percent === "number" && window === primary
						? source.used_percent
						: null;
		if (typeof usedPercent !== "number") {
			return null;
		}

		const duration = formatRemainingWindowDuration(window);
		if (!duration) return null;

		return {
			used: Math.max(0, Math.min(100, Math.round(usedPercent))),
			duration,
		};
	};

	return {
		primary: formatWindow(primary),
		secondary: formatWindow(secondary),
	};
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

	// subagents — user agents + nearest project .pi/agents
	const subagentNames = new Set<string>();
	for (const name of discoverNamesInDir(join(agentDir, "agents"))) {
		subagentNames.add(name);
	}
	const projectAgentsDir = findNearestAncestorDir(process.cwd(), "agents");
	if (projectAgentsDir) {
		for (const name of discoverNamesInDir(projectAgentsDir)) {
			subagentNames.add(name);
		}
	}
	const subagents = Array.from(subagentNames).sort((a, b) => a.localeCompare(b));

	return { version, scopedModels, contextFiles, skills, extensions, subagents };
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

function formatChatGPTUsageLine(
	primary: { used?: number; duration?: string } | null,
	secondary: { used?: number; duration?: string } | null,
	// biome-ignore lint/suspicious/noExplicitAny: theme shape varies
	theme: any,
): string | null {
	if (!primary && !secondary) return null;

	const used = (n: number | undefined) => `${Math.max(0, Math.min(100, Math.round(n ?? 0)))}%`;
	const dur = (s: string | undefined) => s ?? "—";
	const dim = (s: string) => theme.fg("dim", s);

	const primaryPart = primary
		? `${used(primary.used)}${dim(" used with ")}${dur(primary.duration)}${dim(" remaining (5-hour)")}`
		: null;
	const secondaryPart = secondary
		? `${used(secondary.used)}${dim(" used with ")}${dur(secondary.duration)}${dim(" remaining (weekly)")}`
		: null;

	if (primaryPart && secondaryPart) return `${primaryPart}${dim(" / ")}${secondaryPart}`;
	return primaryPart ?? secondaryPart;
}

function removeLeadingWidgetSpacer(tui: unknown, component: unknown): void {
	const rootChildren = (tui as { children?: unknown[] }).children;
	if (!Array.isArray(rootChildren)) return;

	for (const child of rootChildren) {
		const children = (child as { children?: unknown[] }).children;
		if (!Array.isArray(children)) continue;

		const componentIndex = children.indexOf(component);
		if (componentIndex <= 0) continue;

		const firstChild = children[0] as { constructor?: { name?: string } } | undefined;
		if (firstChild?.constructor?.name === "Spacer") {
			children.splice(0, 1);
			(tui as { requestRender?: () => void }).requestRender?.();
		}
	}
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const modeArgIndex = process.argv.indexOf("--mode");
	const mode = modeArgIndex >= 0 ? process.argv[modeArgIndex + 1] : undefined;

	if (process.stdout.isTTY && mode !== "json" && !process.argv.includes("--mode=json")) {
		clear();
	}

	let dismissed = false;

	pi.on("session_start", async (event, ctx) => {
		if (ctx.mode !== "tui") return;

		if (event.reason === "new" || event.reason === "resume") {
			clear();
			dismissed = false;
		}

		if (event.reason !== "startup" && event.reason !== "new") return;

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

		// ── ChatGPT Plus usage ───────────────────────────────────────
		let chatGPTUsage: { primary: ChatGPTUsageLinePart | null; secondary: ChatGPTUsageLinePart | null } | null = null;
		try {
			chatGPTUsage = await fetchChatGPTPlusUsage();
		} catch {
			// offline or auth missing — skip the line
		}

		ctx.ui.setWidget("custom-header", (tui, theme) => {
			const lines: string[] = [];

			// pi version
			lines.push(formatLine("pi", [r.version], theme));

			// openrouter credits
			if (creditsLine) {
				lines.push(formatLine("OpenRouter Credits", [creditsLine], theme));
			}

			// ChatGPT Plus usage
			if (chatGPTUsage) {
				const chatGPTLine = formatChatGPTUsageLine(chatGPTUsage.primary, chatGPTUsage.secondary, theme);
				if (chatGPTLine) lines.push(formatLine("ChatGPT Plus", [chatGPTLine], theme));
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

			// subagents
			if (r.subagents.length > 0) {
				lines.push(formatLine("Subagents", r.subagents, theme));
			}

			// one trailing blank line
			lines.push("");

			const component = {
				render: (width: number) => lines.map((l) => truncateToWidth(l, width)),
				invalidate: () => {},
			};

			setTimeout(() => removeLeadingWidgetSpacer(tui, component), 0);
			return component;
		});
	});

	// ── Auto-dismiss on first prompt ─────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

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
