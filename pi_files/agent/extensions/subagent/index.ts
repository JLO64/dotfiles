/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";
import { buildAgentResourceArgs } from "./resource-config.ts";
import {
	compactMarkdownForDisplay,
	formatContextTokens,
	formatTurns,
	humanizeDuration,
	normalizeProfileModel,
	shortenHome,
	taskSummary,
	type SummaryMetadata,
} from "./summary.ts";
import {
	formatContextTokenLimit,
	renderContextTokenLimit,
	resolveContextTokenLimit,
} from "./context-limits.ts";
import {
	CONTEXT_WARNING_PROTOCOL_PREFIX,
	type ContextWarningProtocolPayload,
} from "./context-limiter.ts";

const CONTEXT_LIMITER_EXTENSION_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "context-limiter.ts");

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

class CompactMarkdown extends Markdown {
	override render(width: number): string[] {
		return super.render(width).filter((line) => line.trim().length > 0);
	}
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
	contextTokenLimit?: number,
): string {
	const parts: string[] = [];
	const turns = formatTurns(usage.turns);
	if (turns) parts.push(turns);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${contextTokenLimit ? formatContextTokenLimit(usage.contextTokens, contextTokenLimit) : formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface ContextWarningDiagnostic {
	threshold: 50 | 75 | 90 | 100;
	used: number;
	limit: number;
	message: string;
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, any> }
	| { type: "contextWarning"; warning: ContextWarningDiagnostic };

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	cwd?: string;
	gitBranch?: string;
	durationMs?: number;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	contextTokenLimit: number;
	contextWarnings: ContextWarningDiagnostic[];
	activity: DisplayItem[];
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	totalTasks?: number;
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function isRunningResult(result: SingleResult): boolean {
	return result.exitCode === -1;
}

function isFailedResult(result: SingleResult): boolean {
	return !isRunningResult(result) && (result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted");
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function markdownCodeBlock(value: string): string {
	const longestFence = Math.max(0, ...(value.match(/~+/g) ?? []).map((run) => run.length));
	const fence = "~".repeat(Math.max(3, longestFence + 1));
	return `${fence}\n${value}\n${fence}`;
}

export function formatFailureReport(result: SingleResult, diagnostic: string): string {
	const metadata = JSON.stringify(
		Object.fromEntries(
			[
				["agent", result.agent],
				["agentSource", result.agentSource],
				["step", result.step],
				["model", result.model],
				["cwd", result.cwd],
				["gitBranch", result.gitBranch],
				["stopReason", result.stopReason],
				["exitCode", result.exitCode],
				["durationMs", result.durationMs],
			].filter(([, value]) => value !== undefined),
		),
		null,
		2,
	);
	const usage = JSON.stringify(result.usage, null, 2);
	const warnings = JSON.stringify(result.contextWarnings, null, 2);
	const messages = JSON.stringify(result.messages, null, 2);

	return [
		"# Subagent failure report",
		"",
		"## Metadata",
		markdownCodeBlock(metadata),
		"",
		"## Task",
		markdownCodeBlock(result.task),
		"",
		"## Final diagnostic",
		markdownCodeBlock(diagnostic),
		"",
		"## Completed assistant messages and tool results",
		markdownCodeBlock(messages),
		"",
		"## Context warning diagnostics",
		markdownCodeBlock(warnings),
		"",
		"## Standard error",
		markdownCodeBlock(result.stderr),
		"",
		"## Usage",
		markdownCodeBlock(usage),
		"",
	].join("\n");
}

export async function writeFailureReport(result: SingleResult, diagnostic: string): Promise<string | undefined> {
	try {
		const reportDir = path.join(os.tmpdir(), "pi-subagent-failures");
		await fs.promises.mkdir(reportDir, { recursive: true, mode: 0o700 });
		const safeAgentName = result.agent.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "agent";
		const reportPath = path.join(reportDir, `${safeAgentName}-${Date.now()}-${randomUUID()}.md`);
		await fs.promises.writeFile(reportPath, formatFailureReport(result, diagnostic), {
			encoding: "utf-8",
			mode: 0o600,
			flag: "wx",
		});
		return reportPath;
	} catch {
		return undefined;
	}
}

async function failureReportNote(result: SingleResult, diagnostic: string): Promise<string> {
	const reportPath = await writeFailureReport(result, diagnostic);
	return reportPath
		? `Failure report saved to ${reportPath}.`
		: "Failure report could not be written.";
}

export function renderSummary(metadata: SummaryMetadata, theme: { fg: (color: any, text: string) => string }): string | undefined {
	const { model, thinking } = normalizeProfileModel(metadata.model);
	const cwd = shortenHome(metadata.cwd, os.homedir());
	if (!model || !cwd) return undefined;

	const stats = [
		thinking,
		typeof metadata.contextTokens === "number" && typeof metadata.contextTokenLimit === "number"
			? renderContextTokenLimit(metadata.contextTokens, metadata.contextTokenLimit, theme)
			: formatContextTokens(metadata.contextTokens),
		formatTurns(metadata.turns),
	].filter(Boolean).join(", ");
	let text = theme.fg("accent", model);
	if (stats) text += `(${stats})`;
	text += theme.fg("dim", " in ") + theme.fg("accent", ` ${cwd}`);
	if (metadata.gitBranch) {
		text += theme.fg("dim", " on ") + theme.fg("accent", ` ${metadata.gitBranch}`);
	}
	const duration = humanizeDuration(metadata.durationMs);
	if (duration) text += theme.fg("dim", " for ") + theme.fg("accent", `󰥔 ${duration}`);
	return text;
}

function statusIcon(
	status: "success" | "failure" | "running",
	theme: { fg: (color: any, text: string) => string },
): string {
	switch (status) {
		case "success":
			// Rose Pine Moon's `success` is #3e8fb0; `mdLink` resolves to the requested #9ccfd8.
			return theme.fg("mdLink", "");
		case "failure":
			return theme.fg("error", "");
		case "running":
			return theme.fg("warning", "");
	}
}

function renderFooter(
	icon: string,
	metadata: SummaryMetadata,
	usage: UsageStats,
	theme: { fg: (color: any, text: string) => string },
): string {
	const summary = renderSummary(metadata, theme);
	if (summary) return `${icon} ${summary}`;
	const usageText = formatUsageStats(usage, metadata.model, metadata.contextTokenLimit);
	return `${icon} ${theme.fg("dim", usageText || "running...")}`;
}

export function aggregateSummary(
	results: SingleResult[],
	mode: "chain" | "parallel",
	theme: { fg: (color: any, text: string) => string },
): string {
	const contextTokens = results.reduce((total, result) => total + result.usage.contextTokens, 0);
	const durations = results.flatMap((result) =>
		typeof result.durationMs === "number" ? [result.durationMs] : [],
	);
	const durationMs =
		mode === "chain"
			? durations.length === results.length
				? durations.reduce((total, duration) => total + duration, 0)
				: undefined
			: durations.length > 0
				? Math.max(...durations)
				: undefined;
	const turns = results.reduce((total, result) => total + result.usage.turns, 0);
	// Streaming placeholders and in-progress results may not have all metadata yet.
	// Compare only known metadata so a completed task does not make the aggregate
	// footer fall back while its peers are still reporting.
	const metadataResults = results.filter((result) => result.model && result.cwd);
	const first = metadataResults[0];
	const gitBranches = new Set(
		metadataResults.flatMap((result) => (result.gitBranch ? [result.gitBranch] : [])),
	);
	const compatible =
		!!first &&
		metadataResults.every(
			(result) => result.model === first.model && result.cwd === first.cwd,
		) &&
		gitBranches.size <= 1;
	if (compatible) {
		return renderSummary(
			{
				...first,
				gitBranch: gitBranches.values().next().value,
				contextTokens,
				contextTokenLimit: undefined,
				turns,
				durationMs,
			},
			theme,
		)!;
	}

	const count = `${results.length} task${results.length === 1 ? "" : "s"}`;
	const context = formatContextTokens(contextTokens);
	const duration = humanizeDuration(durationMs);
	const stats = [context, formatTurns(turns), duration].filter(Boolean).join(", ");
	return theme.fg("dim", stats ? `${count} (${stats})` : count);
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

export function parseContextWarningProtocolLine(line: string): ContextWarningDiagnostic | undefined {
	if (!line.startsWith(CONTEXT_WARNING_PROTOCOL_PREFIX)) return undefined;
	try {
		const payload: unknown = JSON.parse(line.slice(CONTEXT_WARNING_PROTOCOL_PREFIX.length));
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
		const value = payload as Partial<ContextWarningProtocolPayload>;
		if (
			value.v !== 1 ||
			value.type !== "context_warning" ||
			(value.threshold !== 50 && value.threshold !== 75 && value.threshold !== 90 && value.threshold !== 100) ||
			typeof value.used !== "number" || !Number.isSafeInteger(value.used) || value.used < 0 ||
			typeof value.limit !== "number" || !Number.isSafeInteger(value.limit) || value.limit <= 0 ||
			typeof value.message !== "string" || value.message.length === 0 ||
			(value.used / value.limit) * 100 < value.threshold
		) return undefined;
		return { threshold: value.threshold, used: value.used, limit: value.limit, message: value.message };
	} catch {
		return undefined;
	}
}

export function resultDisplayItems(result: SingleResult): DisplayItem[] {
	if (result.activity?.length) return result.activity;
	return [
		...getDisplayItems(result.messages),
		...(result.contextWarnings ?? []).map((warning) => ({ type: "contextWarning" as const, warning })),
	];
}

function addDisplayItems(
	container: Container,
	items: DisplayItem[],
	theme: { fg: (color: any, text: string) => string },
	mdTheme: ReturnType<typeof getMarkdownTheme>,
): void {
	for (const item of items) {
		if (item.type === "toolCall") {
			container.addChild(new Text(
				theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
				0,
				0,
			));
		} else if (item.type === "contextWarning") {
			const color = item.warning.threshold >= 90 ? "error" : "warning";
			container.addChild(new Text(theme.fg(color, `⚠ ${item.warning.message}`), 0, 0));
		} else if (item.text.trim()) {
			container.addChild(new CompactMarkdown(item.text.trim(), 0, 0, mdTheme));
		}
	}
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function captureGitBranch(cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const proc = spawn("git", ["branch", "--show-current"], {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "ignore"],
		});
		let output = "";
		const timeout = setTimeout(() => proc.kill(), 1000);
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});
		proc.on("close", () => {
			clearTimeout(timeout);
			resolve(output.trim() || undefined);
		});
		proc.on("error", () => {
			clearTimeout(timeout);
			resolve(undefined);
		});
	});
}

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	contextTokenLimit: number,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
			contextTokenLimit,
			contextWarnings: [],
			activity: [],
		};
	}
	if (agent.configurationError) {
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			exitCode: 1,
			messages: [],
			stderr: `Profile configuration error for agent "${agentName}": ${agent.configurationError}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
			contextTokenLimit,
			contextWarnings: [],
			activity: [],
		};
	}

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const childCwd = cwd ?? defaultCwd;
	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: -1,
		cwd: childCwd,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
		step,
		contextTokenLimit,
		contextWarnings: [],
		activity: [],
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	emitUpdate();

	try {
		args.push(...buildAgentResourceArgs(agent, fs.existsSync, CONTEXT_LIMITER_EXTENSION_PATH));
	} catch (error) {
		currentResult.exitCode = 1;
		currentResult.stderr = error instanceof Error ? error.message : String(error);
		return currentResult;
	}

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(task);
		let wasAborted = false;

		const gitBranch = captureGitBranch(childCwd);
		const startedAt = Date.now();
		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: childCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, PI_SUBAGENT_CONTEXT_TOKEN_LIMIT: String(contextTokenLimit) },
			});
			let buffer = "";
			let stderrBuffer = "";
			let elapsedTimer: ReturnType<typeof setInterval> | undefined;
			const stopElapsedTimer = () => {
				if (elapsedTimer) clearInterval(elapsedTimer);
				elapsedTimer = undefined;
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);
					if (msg.role === "assistant") currentResult.activity.push(...getDisplayItems([msg]));

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			const processStderrLine = (line: string) => {
				const warning = parseContextWarningProtocolLine(line);
				if (warning) {
					if (!currentResult.contextWarnings.some((existing) => existing.threshold === warning.threshold)) {
						currentResult.contextWarnings.push(warning);
						currentResult.activity.push({ type: "contextWarning", warning });
						emitUpdate();
					}
					return;
				}
				currentResult.stderr += `${line}\n`;
			};

			proc.stderr.on("data", (data) => {
				stderrBuffer += data.toString();
				const lines = stderrBuffer.split("\n");
				stderrBuffer = lines.pop() || "";
				for (const line of lines) processStderrLine(line);
			});

			if (onUpdate) {
				elapsedTimer = setInterval(() => {
					currentResult.durationMs = Date.now() - startedAt;
					emitUpdate();
				}, 1000);
			}

			proc.on("close", (code) => {
				stopElapsedTimer();
				if (buffer.trim()) processLine(buffer);
				if (stderrBuffer) processStderrLine(stderrBuffer);
				resolve(code ?? 0);
			});

			proc.on("error", (error) => {
				stopElapsedTimer();
				currentResult.stderr += `${error.message}\n`;
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					stopElapsedTimer();
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		currentResult.durationMs = Date.now() - startedAt;
		currentResult.gitBranch = await gitBranch;
		if (wasAborted) {
			currentResult.stopReason = "aborted";
			currentResult.errorMessage = "Subagent was aborted";
		}
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

const ContextTokenLimit = Type.Optional(Type.Integer({
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
	description: "Soft current-context token limit for this child; must be a positive safe integer and defaults to the profile value or 120000",
}));

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	contextTokenLimit: ContextTokenLimit,
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	contextTokenLimit: ContextTokenLimit,
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	contextTokenLimit: ContextTokenLimit,
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
			`To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
					totalTasks: mode === "chain" ? params.chain?.length : mode === "parallel" ? params.tasks?.length : undefined,
				});

			if (modeCount !== 1) {
				const available = agents.map((a) => a.name).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						resolveContextTokenLimit(step.contextTokenLimit, agents.find((agent) => agent.name === step.agent)?.contextTokenLimit),
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = getResultOutput(result);
						const reportNote = await failureReportNote(result, errorMsg);
						return {
							content: [
								{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}\n\n${reportNote}` },
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
						contextTokenLimit: resolveContextTokenLimit(
							params.tasks[i].contextTokenLimit,
							agents.find((agent) => agent.name === params.tasks![i].agent)?.contextTokenLimit,
						),
						contextWarnings: [],
						activity: [],
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						resolveContextTokenLimit(t.contextTokenLimit, agents.find((agent) => agent.name === t.agent)?.contextTokenLimit),
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = await Promise.all(
					results.map(async (r) => {
						const output = truncateParallelOutput(getResultOutput(r));
						const failed = isFailedResult(r);
						const status = failed
							? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
							: "completed";
						const reportNote = failed ? `\n\n${await failureReportNote(r, getResultOutput(r))}` : "";
						return `### [${r.agent}] ${status}\n\n${output}${reportNote}`;
					}),
				);
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					resolveContextTokenLimit(params.contextTokenLimit, agents.find((agent) => agent.name === params.agent)?.contextTokenLimit),
					signal,
					onUpdate,
					makeDetails("single"),
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					const reportNote = await failureReportNote(result, errorMsg);
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}\n\n${reportNote}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => a.name).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			if (args.chain && args.chain.length > 0) {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("accent", `chain (${args.chain.length} steps)`),
					0,
					0,
				);
			}
			if (args.tasks && args.tasks.length > 0) {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("accent", `parallel (${args.tasks.length} tasks)`),
					0,
					0,
				);
			}
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", args.agent || "..."),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isRunning = isRunningResult(r);
				const isError = isFailedResult(r);
				const icon = statusIcon(isRunning ? "running" : isError ? "failure" : "success", theme);
				const displayItems = resultDisplayItems(r);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Input ───"), 0, 0));
					container.addChild(new CompactMarkdown(compactMarkdownForDisplay(r.task), 0, 0, mdTheme));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						addDisplayItems(container, displayItems, theme, mdTheme);
					}
					const summary = renderSummary({ ...r, contextTokens: r.usage.contextTokens, turns: r.usage.turns }, theme);
					if (summary) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(summary, 0, 0));
					} else {
						const usageStr = formatUsageStats(r.usage, r.model, r.contextTokenLimit);
						if (usageStr) container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = theme.fg("text", taskSummary(r.task));
				if (isError && (r.errorMessage || r.stopReason)) {
					const detail = r.errorMessage
						? `Error${r.stopReason ? ` [${r.stopReason}]` : ""}: ${r.errorMessage}`
						: `Error: ${r.stopReason}`;
					text += `\n${theme.fg("error", detail)}`;
				}
				text += `\n${renderFooter(icon, { ...r, contextTokens: r.usage.contextTokens, turns: r.usage.turns }, r.usage, theme)}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "chain") {
				if (expanded) {
					const container = new Container();

					for (const [index, r] of details.results.entries()) {
						const rIcon = statusIcon(
							isRunningResult(r) ? "running" : r.exitCode === 0 ? "success" : "failure",
							theme,
						);
						const displayItems = resultDisplayItems(r);

						if (index > 0) container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new CompactMarkdown(compactMarkdownForDisplay(r.task), 0, 0, mdTheme));
						addDisplayItems(container, displayItems, theme, mdTheme);

						const summary = renderSummary({ ...r, contextTokens: r.usage.contextTokens, turns: r.usage.turns }, theme);
						if (summary) container.addChild(new Text(summary, 0, 0));
						else {
							const stepUsage = formatUsageStats(r.usage, r.model, r.contextTokenLimit);
							if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
						}
					}

					container.addChild(new Spacer(1));
					container.addChild(new Text(aggregateSummary(details.results, "chain", theme), 0, 0));
					return container;
				}

				const isRunning = details.results.some(isRunningResult);
				const hasFailure = details.results.some(isFailedResult);
				const icon = statusIcon(isRunning ? "running" : hasFailure ? "failure" : "success", theme);
				const taskLines = details.results
					.map((r) => {
						const rIcon = statusIcon(
							isRunningResult(r) ? "running" : isFailedResult(r) ? "failure" : "success",
							theme,
						);
						return `${theme.fg("accent", r.agent)}${theme.fg("muted", ": ")}${rIcon} ${theme.fg("text", taskSummary(r.task))}`;
					})
					.join("\n");
				return new Text(`${taskLines}\n${icon} ${aggregateSummary(details.results, "chain", theme)}`, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = statusIcon(isRunning ? "running" : failCount > 0 ? "failure" : "success", theme);

				if (expanded) {
					const container = new Container();

					for (const [index, r] of details.results.entries()) {
						const rIcon = statusIcon(
							isRunningResult(r) ? "running" : isFailedResult(r) ? "failure" : "success",
							theme,
						);
						const displayItems = resultDisplayItems(r);

						if (index > 0) container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new CompactMarkdown(compactMarkdownForDisplay(r.task), 0, 0, mdTheme));
						addDisplayItems(container, displayItems, theme, mdTheme);

						const summary = renderSummary({ ...r, contextTokens: r.usage.contextTokens, turns: r.usage.turns }, theme);
						if (summary) container.addChild(new Text(summary, 0, 0));
						else {
							const taskUsage = formatUsageStats(r.usage, r.model, r.contextTokenLimit);
							if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
						}
					}

					container.addChild(new Spacer(1));
					container.addChild(new Text(aggregateSummary(details.results, "parallel", theme), 0, 0));
					return container;
				}

				const taskLines = details.results
					.map((r) => {
						const rIcon = statusIcon(
							isRunningResult(r) ? "running" : isFailedResult(r) ? "failure" : "success",
							theme,
						);
						return `${theme.fg("accent", r.agent)}${theme.fg("muted", ": ")}${rIcon} ${theme.fg("text", taskSummary(r.task))}`;
					})
					.join("\n");
				return new Text(`${taskLines}\n${icon} ${aggregateSummary(details.results, "parallel", theme)}`, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
