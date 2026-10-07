import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	clearFooterLayout,
	fitFooterDetails,
	getFooterCellContent,
	getFooterCellState,
	getStreamingIcon,
	STREAMING_FRAME_INTERVAL_MS,
	measureFooterCells,
	publishFooterLayout,
	renderFooterCellRow,
	renderFooterTopBorder,
	setFooterRenderNotifier,
	setFooterWidthMeasurer,
} from "./footer-layout.js";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildFooterDetailsStages, formatCompactDuration, formatContextUsage } from "./footer-details.js";
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

function shortenModelName(
	provider: string | undefined,
	modelId: string,
	omitProvider = false,
): string {
	// Strip redundant maker prefix from model ID (e.g. deepseek/deepseek-v4-flash → deepseek-v4-flash)
	let model = modelId;
	const makerIdx = model.lastIndexOf("/");
	if (makerIdx >= 0) model = model.slice(makerIdx + 1);

	if (omitProvider || !provider) return model;

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
			reset_after_seconds?: number;
		};
		secondary_window?: {
			used_percent?: number;
			reset_at?: number;
			reset_after_seconds?: number;
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

interface ChatGPTPlusUsage {
	usedPercent: number;
	resetAt: number | null;
}

function getResetAt(
	window: { reset_at?: number; reset_after_seconds?: number } | undefined,
): number | null {
	if (typeof window?.reset_after_seconds === "number") {
		return Date.now() + window.reset_after_seconds * 1000;
	}
	if (typeof window?.reset_at === "number") {
		return window.reset_at > 1e12 ? window.reset_at : window.reset_at * 1000;
	}
	return null;
}

function formatResetDuration(resetAt: number): string {
	const totalMinutes = Math.max(0, Math.ceil((resetAt - Date.now()) / 60000));
	return formatCompactDuration(totalMinutes);
}

async function fetchChatGPTPlusUsage(): Promise<ChatGPTPlusUsage | null> {
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

	return {
		usedPercent: Math.max(0, Math.min(100, Math.round(usedPercent))),
		resetAt: getResetAt(primary),
	};
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function registerFooter(pi: ExtensionAPI) {
	// Shared state for the active session's footer timer
	const timerState = {
		lastCompletionTime: Date.now(),
		hasResponded: false,
		requestRender: () => {},
		refreshStreamingTimer: () => {},
	};
	let refreshChatGPTPlusPercent: () => void = () => {};
	let sessionTotals = { input: 0, output: 0, cost: 0 };
	let refreshSessionTotals: (message?: AssistantMessage) => void = () => {};

	// Hostname is static for this extension runtime; resolve it outside render().
	let hostname = "unknown";
	try {
		hostname = execSync("hostname -s", { encoding: "utf-8", timeout: 1000 }).trim();
	} catch {
		hostname = "unknown";
	}
	if (/macbook/i.test(hostname)) hostname = "MBP";

	pi.on("agent_start", async () => {
		streamingState.isStreaming = true;
		timerState.refreshStreamingTimer();
		timerState.requestRender();
	});

	pi.on("agent_end", async () => {
		streamingState.isStreaming = false;
		timerState.refreshStreamingTimer();
		streamingState.streamedChars = 0;
		timerState.hasResponded = true;
		timerState.lastCompletionTime = Date.now();
		timerState.requestRender();
		void refreshChatGPTPlusPercent();
	});

	pi.on("message_start", async () => {
		streamingState.streamedChars = 0;
	});

	pi.on("message_end", async (event) => {
		if (event.message.role === "assistant") {
			// message_end runs before the finalized message is persisted to the branch.
			refreshSessionTotals(event.message as AssistantMessage);
		}
	});

	pi.on("session_tree", async () => {
		refreshSessionTotals();
	});

	pi.on("session_compact", async () => {
		refreshSessionTotals();
	});

	pi.on("message_update", async (event) => {
		if (event.assistantMessageEvent?.type === "text_delta" || event.assistantMessageEvent?.type === "thinking_delta") {
			streamingState.streamedChars += event.assistantMessageEvent.delta.length;
			timerState.requestRender();
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		refreshSessionTotals = (pendingMessage) => {
			let totalInput = 0;
			let totalOutput = 0;
			let totalCost = 0;
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type === "message" && entry.message.role === "assistant") {
					const message = entry.message as AssistantMessage;
					totalInput += message.usage.input;
					totalOutput += message.usage.output;
					totalCost += message.usage.cost?.total ?? 0;
				}
			}
			if (pendingMessage) {
				totalInput += pendingMessage.usage.input;
				totalOutput += pendingMessage.usage.output;
				totalCost += pendingMessage.usage.cost?.total ?? 0;
			}
			sessionTotals = { input: totalInput, output: totalOutput, cost: totalCost };
			timerState.requestRender();
		};
		refreshSessionTotals();

		ctx.ui.setWidget("custom-footer", (tui, theme) => {
			// Reset timer state for this session
			timerState.lastCompletionTime = Date.now();
			timerState.hasResponded = false;
			timerState.requestRender = () => tui.requestRender();

			let disposed = false;
			let streamingTimer: ReturnType<typeof setInterval> | undefined;
			const refreshStreamingTimer = () => {
				if (streamingState.isStreaming && streamingTimer === undefined) {
					streamingTimer = setInterval(() => tui.requestRender(), STREAMING_FRAME_INTERVAL_MS);
				} else if (!streamingState.isStreaming && streamingTimer !== undefined) {
					clearInterval(streamingTimer);
					streamingTimer = undefined;
				}
			};
			timerState.refreshStreamingTimer = refreshStreamingTimer;
			refreshStreamingTimer();
			let chatGPTPlusUsage: ChatGPTPlusUsage | null = null;
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
					const usage = await fetchChatGPTPlusUsage();
					if (disposed) return;
					chatGPTPlusUsage = usage;
					tui.requestRender();
				} catch {
					// Keep the last known value when the usage endpoint is unavailable.
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

			// Refresh and rerender git status every 3 seconds
			const gitTimer = setInterval(() => {
				refreshGit();
				tui.requestRender();
			}, 3000);

			// Periodic refresh covers branch changes; below-editor widgets do not
			// receive the footerData branch-change subscription.
			setFooterRenderNotifier(() => tui.requestRender());

			// Refresh clock every 10 seconds (for the stopwatch timer)
			const clockTimer = setInterval(() => tui.requestRender(), 10000);

			// Refresh ChatGPT Plus usage every 30 seconds
			const chatGPTPlusTimer = setInterval(refreshChatGPTPlusPercent, 30000);

			const widget = {
				dispose() {
					disposed = true;
					clearFooterLayout();
					clearInterval(gitTimer);
					if (streamingTimer !== undefined) clearInterval(streamingTimer);
					streamingTimer = undefined;
					timerState.refreshStreamingTimer = () => {};
					clearInterval(clockTimer);
					clearInterval(chatGPTPlusTimer);
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

					// Token stats and cost are refreshed on branch/message lifecycle events.
					const { input: totalInput, output: totalOutput, cost: totalCost } = sessionTotals;

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
					const contextTokens = contextUsage?.tokens;

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
						elapsedStr = "(…)";
					} else if (timerState.hasResponded) {
						const elapsedMs = Date.now() - timerState.lastCompletionTime;
						const elapsedSec = Math.ceil(Math.floor(elapsedMs / 1000) / 5) * 5;
						if (elapsedSec < 60) {
							elapsedStr = "(0m)";
						} else if (elapsedSec < 3600) {
							const minutes = Math.floor(elapsedSec / 60);
							elapsedStr = `(${minutes}m)`;
						} else if (elapsedSec < 86400) {
							const hours = Math.floor(elapsedSec / 3600);
							elapsedStr = `(${hours}h)`;
						} else {
							const days = Math.floor(elapsedSec / 86400);
							elapsedStr = `(${days}d)`;
						}
					}

					// ─── Build the line ─────────────────────────────────────────

					const state = getFooterCellState();
					const borderColorize = state.borderColorize;

					// Stats in parentheses: (4.5%)
					const inputStr = totalInput > 0 ? `↑${formatTokens(totalInput)}` : "";
					const outputStr = totalOutput > 0 ? `↓${formatTokens(totalOutput)}` : "";

					const formattedContextUsage = formatContextUsage(contextTokens, ctx.model?.contextWindow);
					const contextUsed = formatContextUsage(contextTokens);
					const colorContext = (value: string | undefined) => value === undefined
						? undefined
						: contextPercent > 80
							? theme.fg("error", value)
							: contextPercent > 50
								? theme.fg("warning", value)
								: value;
					const contextStr = colorContext(formattedContextUsage);
					const contextUsedStr = colorContext(contextUsed);

					// Cost display: show ChatGPT Plus percentage for openai-codex
					let costStr: string;
					if (ctx.model?.provider === "openai-codex") {
						if (chatGPTPlusUsage === null) {
							costStr = "—";
						} else {
							const { usedPercent, resetAt } = chatGPTPlusUsage;
							const percentStr =
								usedPercent > 80
									? theme.fg("error", `${usedPercent}%`)
									: usedPercent > 50
										? theme.fg("warning", `${usedPercent}%`)
										: `${usedPercent}%`;
							costStr = resetAt === null
								? percentStr
								: `${percentStr}${theme.fg("dim", " in ")}${formatResetDuration(resetAt)}`;
						}
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

					const displayedCost = ctx.model?.provider === "lm-studio" ? undefined : costStr;
					// Time
					const modelName = shortenModelName(ctx.model?.provider, ctx.model?.id || "no-model");
					const detailsInput = {
						model: borderColorize(modelName),
						modelWithoutProvider: borderColorize(shortenModelName(ctx.model?.provider, ctx.model?.id || "no-model", true)),
						stats: [],
						reasoningEffort: thinkingLabel,
						contextUsage: contextStr !== undefined && contextUsedStr !== undefined
							? { used: contextUsedStr, withMaximum: contextStr }
							: undefined,
						cost: displayedCost,
						path: displayCwd,
						cwd,
						hostname,
						time: borderColorize(timeStr),
						duration: elapsedStr,
						git: cachedGit ? { branch: borderColorize(cachedGit.branch), suffix: `${cachedGit.dirty > 0 ? `(${cachedGit.dirty})` : ""}${cachedGit.ahead > 0 ? `↑${cachedGit.ahead}` : ""}${cachedGit.behind > 0 ? `↓${cachedGit.behind}` : ""}` } : undefined,
						icons: {
							model: borderColorize(" "),
							directory: borderColorize(" "),
							git: borderColorize(""),
							time: borderColorize("󰥔 "),
						},
						colorizeDirectory: borderColorize,
						connectors: {
							in: theme.fg("dim", " in "),
							on: theme.fg("dim", "on"),
							at: theme.fg("dim", "at"),
						},
						commaSeparator: theme.fg("dim", ", "),
					};
					const detailStages = buildFooterDetailsStages(detailsInput);
					const baseline = detailStages[0]!;
					if (width < 5) {
						publishFooterLayout(width, { widths: [0, 0, 0], totalWidth: width });
						return [truncateToWidth(baseline, width, "")];
					}

					const [modeContent, transcriptContent] = getFooterCellContent(width);
					const mode = streamingState.isStreaming
						? modeContent.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u, getStreamingIcon(Math.floor(Date.now() / STREAMING_FRAME_INTERVAL_MS)))
						: modeContent;
					const layout = measureFooterCells(baseline, width);
					const detailsWidth = layout.widths[1];
					const line = fitFooterDetails(baseline, detailsWidth, detailStages.slice(1));
					publishFooterLayout(width, layout);
					const rows = renderFooterCellRow(
						[
							mode,
							line,
							borderColorize(`\x1b[1m${transcriptContent}\x1b[22m`),
						],
						layout,
						borderColorize,
					);
					return streamingState.isStreaming
						? [renderFooterTopBorder(width, layout, borderColorize), ...rows]
						: rows;
				},
			};
			setFooterWidthMeasurer((width) => {
				widget.render(width);
			});
			return widget;
		}, { placement: "belowEditor" });
		// Keep Pi's built-in footer from appearing alongside the below-editor footer.
		// The empty component has zero rows, so it introduces no vertical spacer.
		ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget("custom-footer", undefined);
		ctx.ui.setFooter(undefined);
		clearFooterLayout();
		timerState.requestRender = () => {};
		timerState.refreshStreamingTimer = () => {};
		refreshSessionTotals = () => {};
		refreshChatGPTPlusPercent = () => {};
	});
}
