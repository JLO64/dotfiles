export interface SummaryMetadata {
	model?: string;
	cwd?: string;
	gitBranch?: string;
	durationMs?: number;
	contextTokens?: number;
	turns?: number;
}

export function taskSummary(task: string): string {
	const firstLine = task.split(/\r?\n/, 1)[0].trim();
	return firstLine.replace(/^Task:\s*/i, "");
}

export function normalizeProfileModel(model?: string): { model?: string; thinking?: string } {
	if (!model) return {};
	const match = model.match(/^(.*):(off|minimal|low|medium|high|xhigh)$/i);
	if (!match) return { model };
	return {
		model: match[1],
		thinking: match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase(),
	};
}

export function formatContextTokens(count?: number): string | undefined {
	return typeof count === "number" && count >= 0 ? `${(count / 1000).toFixed(1)}k` : undefined;
}

export function formatTurns(turns?: number): string | undefined {
	return typeof turns === "number" && turns >= 0 ? `${turns} turn${turns === 1 ? "" : "s"}` : undefined;
}

export function formatSummaryStats(thinking?: string, contextTokens?: number, turns?: number): string {
	return [thinking, formatContextTokens(contextTokens), formatTurns(turns)].filter(Boolean).join(", ");
}

export function humanizeDuration(durationMs?: number): string | undefined {
	if (typeof durationMs !== "number" || durationMs < 0) return undefined;
	const seconds = Math.max(1, Math.round(durationMs / 1000));
	if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
	const hours = Math.round(minutes / 60);
	return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function shortenHome(cwd?: string, home?: string): string | undefined {
	if (!cwd) return undefined;
	return home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
}
