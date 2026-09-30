import type { ContextEvent, ContextEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_CONTEXT_TOKEN_LIMIT,
	nextContextWarning,
	parseEnvironmentContextTokenLimit,
	type ContextWarning,
} from "./context-limits.ts";

const LIMIT_ENV = "PI_SUBAGENT_CONTEXT_TOKEN_LIMIT";
export const CONTEXT_WARNING_PROTOCOL_PREFIX = "@@PI_SUBAGENT_CONTEXT_WARNING_V1@@";
export const CONTEXT_MEASUREMENT_PROTOCOL_PREFIX = "@@PI_SUBAGENT_CONTEXT_MEASUREMENT_V1@@";

export interface ContextWarningProtocolPayload extends ContextWarning {
	v: 1;
	type: "context_warning";
	used: number;
	limit: number;
}

export interface ContextMeasurementProtocolPayload {
	v: 1;
	type: "context_measurement";
	tokens: number;
	measuredAt: number;
}

export function formatContextWarningProtocol(payload: ContextWarningProtocolPayload): string {
	return `${CONTEXT_WARNING_PROTOCOL_PREFIX}${JSON.stringify(payload)}`;
}

export function formatContextMeasurementProtocol(payload: ContextMeasurementProtocolPayload): string {
	return `${CONTEXT_MEASUREMENT_PROTOCOL_PREFIX}${JSON.stringify(payload)}`;
}

function emitContextWarning(payload: ContextWarningProtocolPayload): void {
	process.stderr.write(`${formatContextWarningProtocol(payload)}\n`);
}

/**
 * Loaded explicitly by the parent for every child, including isolated profiles.
 * Context-event messages are request-local: they reach the next provider call but
 * are not appended to the child session or emitted on its JSON stdout protocol.
 * Fired diagnostics use a versioned stderr side channel so stdout remains pi JSONL.
 */
export function createContextLimitHandler(
	limit: number,
	emitWarning: (payload: ContextWarningProtocolPayload) => void = emitContextWarning,
	emitMeasurement: (payload: ContextMeasurementProtocolPayload) => void = (payload) => {
		process.stderr.write(`${formatContextMeasurementProtocol(payload)}\n`);
	},
): (event: ContextEvent, ctx: ExtensionContext) => ContextEventResult | undefined {
	let lastWarningThreshold = 0;
	let sentResumeNotice = false;
	const previousLimit = parseEnvironmentContextTokenLimit(process.env.PI_SUBAGENT_PREVIOUS_CONTEXT_TOKEN_LIMIT, "previous context token limit");
	const resumeNotice = process.env.PI_SUBAGENT_RESUME_NOTICE === "1";

	return (event, ctx) => {
		const used = ctx.getContextUsage()?.tokens;
		if (used === null || used === undefined || !Number.isSafeInteger(used) || used < 0) return;
		const measuredAt = Date.now();
		emitMeasurement({ v: 1, type: "context_measurement", tokens: used, measuredAt });

		const messages = [...event.messages];
		if (resumeNotice && !sentResumeNotice) {
			sentResumeNotice = true;
			const previous = previousLimit ?? limit;
			const change = `The previous context limit was ${previous} tokens; the effective limit for this continuation is ${limit} tokens.`;
			const notice = `Continuation context: ${change} Current context occupancy before this request is ${used} tokens (${Math.floor((used / limit) * 100)}% of the effective limit).`;
			messages.push({ role: "custom", customType: "subagent-context-resume", content: notice, display: false, timestamp: measuredAt });
		}

		const warning = nextContextWarning(used, limit, lastWarningThreshold);
		if (warning) {
			lastWarningThreshold = warning.threshold;
			emitWarning({ v: 1, type: "context_warning", ...warning, used, limit });
			messages.push({
				role: "custom",
				customType: "subagent-context-limit",
				content: warning.message,
				display: false,
				timestamp: measuredAt,
			});
		}
		return messages.length > event.messages.length ? { messages } : undefined;
	};
}

export default function (pi: ExtensionAPI) {
	const limit = parseEnvironmentContextTokenLimit(process.env[LIMIT_ENV], `${LIMIT_ENV} environment value`) ?? DEFAULT_CONTEXT_TOKEN_LIMIT;
	pi.on("context", createContextLimitHandler(limit));
}
