import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";
import os from "node:os";

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
		}).trim();
		if (!branch) return null;

		const porcelain = execSync("git status --porcelain", {
			cwd,
			encoding: "utf-8",
			timeout: 1000,
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
					}).trim(),
					10,
				) || 0;
			behind =
				parseInt(
					execSync("git rev-list --count HEAD..@{upstream}", {
						cwd,
						encoding: "utf-8",
						timeout: 1000,
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

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
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

			// Refresh clock every minute
			const clockTimer = setInterval(() => tui.requestRender(), 60000);

			return {
				dispose() {
					clearInterval(gitTimer);
					clearInterval(clockTimer);
					branchUnsub();
				},
				invalidate() {},
				render(width: number): string[] {
					const home = process.env.HOME || process.env.USERPROFILE || "";
					const displayCwd =
						home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;

					// Token stats (cumulative across all session entries)
					let totalInput = 0;
					let totalOutput = 0;
					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							totalInput += entry.message.usage.input;
							totalOutput += entry.message.usage.output;
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
						.toLowerCase();

					// ─── Build the line ─────────────────────────────────────────

					// Nerd font icon placeholders — replace | with actual icons later
					const icon = "|";

					// Model name
					const modelPart = icon + theme.fg("accent", modelName);

					// Stats in parentheses: (↑11k ↓1.1k 4.5%)
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

					const statsParts = [inputStr, outputStr, contextStr].filter(Boolean);
					const stats =
						statsParts.length > 0 ? ` (${statsParts.join(" ")})` : "";

					// Username
					const username =
						os.userInfo().username ||
						process.env.USER ||
						process.env.USERNAME ||
						"user";
					const userPart = icon + theme.fg("accent", username);

					// Directory
					const dirPart = icon + theme.fg("accent", theme.bold(displayCwd));

					// Git info
					let gitPart = "";
					if (cachedGit) {
						const dirtyStr = cachedGit.dirty > 0 ? `(${cachedGit.dirty})` : "";
						const trackParts: string[] = [];
						if (cachedGit.ahead > 0) trackParts.push(`↑${cachedGit.ahead}`);
						if (cachedGit.behind > 0) trackParts.push(`↓${cachedGit.behind}`);
						const trackStr =
							trackParts.length > 0 ? ` ${trackParts.join("")}` : "";
						gitPart = ` ${theme.fg("dim", "on")} ${theme.fg("accent", `${cachedGit.branch}${dirtyStr}${trackStr}`)}`;
					}

					// Time
					const timePart = icon + theme.fg("dim", timeStr);

					const line =
						modelPart +
						stats +
						" via " +
						userPart +
						" in " +
						dirPart +
						gitPart +
						" at " +
						timePart;
					return [truncateToWidth(line, width)];
				},
			};
		});
	});
}
