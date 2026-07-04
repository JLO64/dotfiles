import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Streaming state ─────────────────────────────────────────────────────────

const streamingState = {
	streamedChars: 0,
	isStreaming: false,
};

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

// ─── Model name shortening ──────────────────────────────────────────────────

function shortenModelName(provider: string | undefined, modelId: string): string {
	// Strip redundant maker prefix from model ID (e.g. deepseek/deepseek-v4-flash → deepseek-v4-flash)
	let model = modelId;
	const makerIdx = model.lastIndexOf("/");
	if (makerIdx >= 0) model = model.slice(makerIdx + 1);

	if (!provider) return model;

	return `${provider}/${model}`;
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

// ─── ChatGPT Plus usage ──────────────────────────────────────────────────────

interface ChatGPTUsageResponse {
	used_percent?: number;
	remaining_percent?: number;
	reset_at?: number;
	rate_limit?: {
		primary_window?: {
			used_percent?: number;
			reset_at?: number;
		};
		secondary_window?: {
			used_percent?: number;
			reset_at?: number;
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

async function fetchChatGPTPlusPercent(): Promise<number | null> {
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
	const source = body.data ?? body;
	const usedPercent =
		typeof primary?.used_percent === "number"
			? primary.used_percent
			: typeof source.remaining_percent === "number"
				? 100 - source.remaining_percent
				: typeof source.used_percent === "number"
					? source.used_percent
					: null;
	if (typeof usedPercent !== "number") {
		return null;
	}

	return Math.max(0, Math.min(100, Math.round(usedPercent)));
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Shared state for the active session's footer timer
	const timerState = {
		lastCompletionTime: Date.now(),
		hasResponded: false,
		requestRender: () => {},
	};
	let refreshChatGPTPlusPercent: () => void = () => {};

	pi.on("agent_start", async () => {
		streamingState.isStreaming = true;
		timerState.requestRender();
	});

	pi.on("agent_end", async () => {
		streamingState.isStreaming = false;
		streamingState.streamedChars = 0;
		timerState.hasResponded = true;
		timerState.lastCompletionTime = Date.now();
		timerState.requestRender();
		void refreshChatGPTPlusPercent();
	});

	pi.on("message_start", async () => {
		streamingState.streamedChars = 0;
	});

	pi.on("message_update", async (event) => {
		if (event.assistantMessageEvent?.type === "text_delta" || event.assistantMessageEvent?.type === "thinking_delta") {
			streamingState.streamedChars += event.assistantMessageEvent.delta.length;
			timerState.requestRender();
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			// Reset timer state for this session
			timerState.lastCompletionTime = Date.now();
			timerState.hasResponded = false;
			timerState.requestRender = () => tui.requestRender();

			let disposed = false;
			let chatGPTPlusPercent: number | null = null;
			let refreshInFlight = false;
			let refreshQueued = false;

			const refreshChatGPTPlusPercentInner = async () => {
				if (disposed) return;
				if (refreshInFlight) {
					refreshQueued = true;
					return;
				}

				refreshInFlight = true;
				try {
					const percent = await fetchChatGPTPlusPercent();
					if (disposed) return;
					chatGPTPlusPercent = percent;
					tui.requestRender();
				} finally {
					refreshInFlight = false;
					if (!disposed && refreshQueued) {
						refreshQueued = false;
						void refreshChatGPTPlusPercentInner();
					}
				}
			};

			refreshChatGPTPlusPercent = () => {
				void refreshChatGPTPlusPercentInner();
			};

			refreshChatGPTPlusPercent();

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


			return {
				dispose() {
					disposed = true;
					clearInterval(gitTimer);
					clearInterval(clockTimer);
					branchUnsub();
					timerState.requestRender = () => {};
					refreshChatGPTPlusPercent = () => {};
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

					// Streaming cost estimation
					let streamingCost = 0;
					if (streamingState.isStreaming && streamingState.streamedChars > 0 && ctx.model) {
						// Rough estimate: ~4 chars per token
						const estimatedOutputTokens = Math.ceil(streamingState.streamedChars / 4);
						// Cost is per million tokens, so divide by 1,000,000
						const costPerMillion = ctx.model.cost?.output ?? 0;
						const costPerToken = costPerMillion / 1_000_000;
						streamingCost = estimatedOutputTokens * costPerToken;
						// Debug: log values if streaming cost seems wrong
						if (streamingCost > 1) {
							console.error(`[DEBUG] streamedChars=${streamingState.streamedChars}, estimatedTokens=${estimatedOutputTokens}, costPerMillion=${costPerMillion}, streamingCost=${streamingCost}`);
						}
					}

					// Context usage
					const contextUsage = ctx.getContextUsage();
					const contextPercent = contextUsage?.percent ?? 0;

					// Model
					const modelName = shortenModelName(ctx.model?.provider, ctx.model?.id || "no-model");

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
					if (streamingState.isStreaming) {
						elapsedStr = "(...)";
					} else if (timerState.hasResponded) {
						const elapsedMs = Date.now() - timerState.lastCompletionTime;
						const elapsedSec = Math.ceil(Math.floor(elapsedMs / 1000) / 5) * 5;
						if (elapsedSec < 60) {
							elapsedStr = `(${elapsedSec}s)`;
						} else if (elapsedSec < 3600) {
							const minutes = Math.floor(elapsedSec / 60);
							const seconds = elapsedSec % 60;
							elapsedStr = `(${minutes}m${seconds}s)`;
						} else if (elapsedSec < 86400) {
							const hours = Math.floor(elapsedSec / 3600);
							const minutes = Math.floor((elapsedSec % 3600) / 60);
							elapsedStr = `(${hours}h${minutes}m)`;
						} else {
							const days = Math.floor(elapsedSec / 86400);
							elapsedStr = `(+${days}d)`;
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

					// Cost display: show ChatGPT Plus percentage for openai-codex
					let costStr: string;
					if (ctx.model?.provider === "openai-codex") {
						costStr = chatGPTPlusPercent !== null ? `${chatGPTPlusPercent}%` : "—";
					} else if (streamingState.isStreaming && streamingCost > 0) {
						const baseCost = totalCost > 0 ? totalCost : 0;
						const estimate = Math.ceil(streamingCost * 100) / 100;
						const baseFormatted = baseCost > 0 ? `$${(Math.ceil(baseCost * 100) / 100).toFixed(2)}` : "$0.00";
						costStr = `${baseFormatted} + ~$${estimate.toFixed(2)}`;
					} else {
						costStr = totalCost > 0 ? `$${(Math.ceil(totalCost * 100) / 100).toFixed(2)}` : "$0.00";
					}

					// Thinking level
					const thinkingLevel = pi.getThinkingLevel();
					const thinkingLabel =
						thinkingLevel === "off"
							? "Off"
							: thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1);

					const statsParts = [thinkingLabel, contextStr, costStr].filter((part, i) => {
						if (ctx.model?.provider === "lm-studio" && i === 2) return false;
						return !!part;
					});
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
