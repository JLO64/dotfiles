import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";

// ─── Token formatting ─────────────────────────────────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

// ─── Git status ───────────────────────────────────────────────────────────────

interface GitInfo {
	branch: string;
	dirty: number;
	ahead: number;
	behind: number;
}

function getGitInfo(cwd: string): GitInfo | null {
	try {
		const branch = execSync("git branch --show-current", {
			cwd,
			encoding: "utf-8",
			timeout: 1000,
			stdio: ["pipe", "pipe", "ignore"],
		}).trim();
		if (!branch) return null;

		const porcelain = execSync("git status --porcelain", {
			cwd,
			encoding: "utf-8",
			timeout: 1000,
			stdio: ["pipe", "pipe", "ignore"],
		});
		const dirty = porcelain
			.split("\n")
			.filter((line) => line.trim().length > 0).length;

		let ahead = 0;
		let behind = 0;
		try {
			ahead =
				parseInt(
					execSync("git rev-list --count @{upstream}..HEAD", {
						cwd,
						encoding: "utf-8",
						timeout: 1000,
						stdio: ["pipe", "pipe", "ignore"],
					}).trim(),
					10,
				) || 0;
			behind =
				parseInt(
					execSync("git rev-list --count HEAD..@{upstream}", {
						cwd,
						encoding: "utf-8",
						timeout: 1000,
						stdio: ["pipe", "pipe", "ignore"],
					}).trim(),
					10,
				) || 0;
		} catch {
			// No upstream configured
		}

		return { branch, dirty, ahead, behind };
	} catch {
		return null;
	}
}

// ─── Path display formatting ──────────────────────────────────────────────────

function truncateDisplayPath(
	cwd: string,
	home: string,
	maxSegments: number = 3,
): string {
	let segments: string[];
	let prefix: string;

	if (home && cwd.startsWith(home)) {
		prefix = "~/";
		segments = cwd.slice(home.length).split("/").filter(Boolean);
	} else if (cwd.startsWith("/")) {
		prefix = "/";
		segments = cwd.split("/").filter(Boolean);
	} else {
		segments = cwd.split("/").filter(Boolean);
		prefix = "";
	}

	if (segments.length <= maxSegments) {
		return prefix + segments.join("/");
	}
	return prefix + ".../" + segments.slice(-maxSegments).join("/");
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Shared state for the active session's footer timer
	const timerState = {
		lastCompletionTime: Date.now(),
		isStreaming: false,
		hasResponded: false,
		requestRender: () => {},
	};

	pi.on("agent_start", async () => {
		timerState.isStreaming = true;
		timerState.requestRender();
	});

	pi.on("agent_end", async () => {
		timerState.isStreaming = false;
		timerState.hasResponded = true;
		timerState.lastCompletionTime = Date.now();
		timerState.requestRender();
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			// Reset timer state for this session
			timerState.lastCompletionTime = Date.now();
			timerState.isStreaming = false;
			timerState.hasResponded = false;
			timerState.requestRender = () => tui.requestRender();

			const cwd = ctx.sessionManager.getCwd();

			// Cache git info so render() stays fast (TUI calls render frequently)
			let cachedGit: GitInfo | null = getGitInfo(cwd);

			const refreshGit = () => {
				cachedGit = getGitInfo(cwd);
			};

			// Refresh git status every 3 seconds
			const gitTimer = setInterval(refreshGit, 3000);

			// Also refresh when pi detects a branch change
			const branchUnsub = footerData.onBranchChange(() => {
				refreshGit();
				tui.requestRender();
			});

			// Refresh clock every 10 seconds (for the stopwatch timer)
			const clockTimer = setInterval(() => tui.requestRender(), 10000);

			let disposed = false;

			return {
				dispose() {
					disposed = true;
					clearInterval(gitTimer);
					clearInterval(clockTimer);
					branchUnsub();
					timerState.requestRender = () => {};
				},
				invalidate() {},
				render(width: number): string[] {
					if (disposed) return [];
					try {
						// Access sessionManager once to detect stale context early
						ctx.sessionManager;
					} catch {
						disposed = true;
						return [];
					}

					const home = process.env.HOME || process.env.USERPROFILE || "";
					const displayCwd = truncateDisplayPath(cwd, home);

					// Token stats and cost (cumulative across the active branch only)
					let totalInput = 0;
					let totalOutput = 0;
					let totalCost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const m = entry.message as AssistantMessage;
							totalInput += m.usage.input;
							totalOutput += m.usage.output;
							totalCost += m.usage.cost?.total ?? 0;
						}
					}

					// Context usage
					const contextUsage = ctx.getContextUsage();
					const contextPercent = contextUsage?.percent ?? 0;

					// Model
					const modelName = ctx.model?.id || "no-model";

					// Time
					const now = new Date();
					const timeStr = now
						.toLocaleTimeString("en-US", {
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						})
						.toLowerCase().replace(" ", "");

					// Elapsed time since last completion
					let elapsedStr = "";
					if (timerState.isStreaming) {
						elapsedStr = "(...)";
					} else if (timerState.hasResponded) {
						const elapsedMs = Date.now() - timerState.lastCompletionTime;
						const elapsedSec = Math.floor(elapsedMs / 1000);
						if (elapsedSec < 60) {
							elapsedStr = `(${elapsedSec}s)`;
						} else {
							const minutes = Math.floor(elapsedSec / 60);
							const seconds = elapsedSec % 60;
							elapsedStr = `(${minutes}m${seconds}s)`;
						}
					}

					// ─── Build the line ─────────────────────────────────────────

					// Nerd font icon placeholders — replace | with actual icons later
					const icon = theme.fg("accent", "|");

					// Model name
					const modelPart = theme.fg("accent", " ") + theme.fg("accent", modelName);

					// Stats in parentheses: (4.5%)
					const inputStr = totalInput > 0 ? `↑${formatTokens(totalInput)}` : "";
					const outputStr = totalOutput > 0 ? `↓${formatTokens(totalOutput)}` : "";

					let contextStr: string;
					if (contextPercent > 90) {
						contextStr = theme.fg("error", `${contextPercent.toFixed(1)}%`);
					} else if (contextPercent > 70) {
						contextStr = theme.fg("warning", `${contextPercent.toFixed(1)}%`);
					} else {
						contextStr = `${contextPercent.toFixed(1)}%`;
					}

					const costStr = totalCost > 0 ? `$${(Math.ceil(totalCost * 100) / 100).toFixed(2)}` : "$0.00";

					// Thinking level
					const thinkingLevel = pi.getThinkingLevel();
					const thinkingLabel =
						thinkingLevel === "off"
							? "Off"
							: thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1);

					const statsParts = [thinkingLabel, contextStr, costStr].filter(Boolean);
					const stats =
						statsParts.length > 0 ? `(${statsParts.join(", ")})` : "";

					// Hostname (short, like `hostname -s`)
					let hostname = "unknown";
					try {
						hostname = execSync("hostname -s", {
							encoding: "utf-8",
							timeout: 1000,
						}).trim();
					} catch {
						hostname = "unknown";
					}
					if (/macbook/i.test(hostname)) hostname = "MBP";

					// Directory
					const dirPart =
						theme.fg("accent", " ") +
						theme.fg("accent", theme.fg("accent", displayCwd)) +
						`(${hostname})`;

					// Git info
					let gitPart = "";
					if (cachedGit) {
						const dirtyStr = cachedGit.dirty > 0 ? `(${cachedGit.dirty})` : "";
						const trackParts: string[] = [];
						if (cachedGit.ahead > 0) trackParts.push(`↑${cachedGit.ahead}`);
						if (cachedGit.behind > 0) trackParts.push(`↓${cachedGit.behind}`);
						const trackStr =
							trackParts.length > 0 ? `${trackParts.join("")}` : "";
						gitPart = ` ${theme.fg("dim", "on")} ${theme.fg("accent", "")} ${theme.fg("accent", cachedGit.branch)}${dirtyStr}${trackStr}`;
					}

					// Time
					const timePart = theme.fg("accent", "󰥔 ") + theme.fg("accent", timeStr) + elapsedStr;

					const line =
						modelPart +
						stats +
						theme.fg("dim", " in ") +
						dirPart +
						gitPart +
						theme.fg("dim", " at ") +
						timePart;
					return [truncateToWidth(line, width)];
				},
			};
		});
	});
}
