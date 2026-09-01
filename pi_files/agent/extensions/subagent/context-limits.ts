export const DEFAULT_CONTEXT_TOKEN_LIMIT = 120_000;

export interface ContextPressureTheme {
	fg(color: "warning" | "error", text: string): string;
}

export function parseContextTokenLimit(value: unknown, source: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`Invalid ${source}: expected a positive safe integer.`);
	}
	return value;
}

export function parseEnvironmentContextTokenLimit(value: string | undefined, source: string): number | undefined {
	if (value === undefined) return undefined;
	if (!/^[1-9]\d*$/.test(value)) {
		throw new Error(`Invalid ${source}: expected a decimal positive safe integer.`);
	}

	const limit = Number(value);
	if (!Number.isSafeInteger(limit)) {
		throw new Error(`Invalid ${source}: expected a decimal positive safe integer.`);
	}
	return limit;
}

export function resolveContextTokenLimit(invocationLimit: unknown, profileLimit: unknown): number {
	return (
		parseContextTokenLimit(invocationLimit, "contextTokenLimit invocation value") ??
		parseContextTokenLimit(profileLimit, "context-token-limit profile value") ??
		DEFAULT_CONTEXT_TOKEN_LIMIT
	);
}

export function formatContextTokenLimit(used: number, limit: number): string {
	return `${formatContextTokens(used)}/${formatLimitTokens(limit)}`;
}

export function formatContextTokens(count: number): string {
	return count === 0 ? "0" : `${(count / 1000).toFixed(1)}k`;
}

function formatLimitTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function contextPressureColor(used: number, limit: number): "warning" | "error" | undefined {
	const percent = (used / limit) * 100;
	if (percent > 80) return "error";
	if (percent > 50) return "warning";
	return undefined;
}

export function renderContextTokenLimit(
	used: number,
	limit: number,
	theme: ContextPressureTheme,
): string {
	const text = formatContextTokenLimit(used, limit);
	const color = contextPressureColor(used, limit);
	return color ? theme.fg(color, text) : text;
}

export type ContextWarning = { threshold: 50 | 75 | 90 | 100; message: string };

export function nextContextWarning(
	used: number,
	limit: number,
	lastThreshold: number,
): ContextWarning | undefined {
	const percent = (used / limit) * 100;
	const thresholds = [100, 90, 75, 50] as const;
	const threshold = thresholds.find((candidate) => percent >= candidate && candidate > lastThreshold);
	if (threshold === undefined) return undefined;

	const consumed = Math.floor(percent);
	const usage = formatContextTokenLimit(used, limit);
	if (threshold === 100) {
		return {
			threshold,
			message: `Context limit reached: ${consumed}% consumed (${usage}). Wrapping up immediately; no new work.`,
		};
	}
	const instruction = threshold === 50
		? "Remain concise and focused."
		: threshold === 75
			? "Prioritize essential remaining work."
			: "Finish essential remaining work; avoid new work.";
	return {
		threshold,
		message: `Context limit warning: ${consumed}% consumed (${usage}). ${instruction}`,
	};
}
