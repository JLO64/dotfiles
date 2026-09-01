import type { ContextEvent, ContextEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_CONTEXT_TOKEN_LIMIT,
	nextContextWarning,
	parseEnvironmentContextTokenLimit,
	type ContextWarning,
} from "./context-limits.ts";

const LIMIT_ENV = "PI_SUBAGENT_CONTEXT_TOKEN_LIMIT";
export const CONTEXT_WARNING_PROTOCOL_PREFIX = "@@PI_SUBAGENT_CONTEXT_WARNING_V1@@";

export interface ContextWarningProtocolPayload extends ContextWarning {
	v: 1;
	type: "context_warning";
	used: number;
	limit: number;
}

export function formatContextWarningProtocol(payload: ContextWarningProtocolPayload): string {
	return `${CONTEXT_WARNING_PROTOCOL_PREFIX}${JSON.stringify(payload)}`;
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
): (event: ContextEvent, ctx: ExtensionContext) => ContextEventResult | undefined {
	let lastWarningThreshold = 0;

	return (event, ctx) => {
		const used = ctx.getContextUsage()?.tokens;
		if (used === null || used === undefined) return;

		const warning = nextContextWarning(used, limit, lastWarningThreshold);
		if (!warning) return;
		lastWarningThreshold = warning.threshold;
		emitWarning({ v: 1, type: "context_warning", ...warning, used, limit });

		return {
			messages: [
				...event.messages,
				{
					role: "custom",
					customType: "subagent-context-limit",
					content: warning.message,
					display: false,
					timestamp: Date.now(),
				},
			],
		};
	};
}

export default function (pi: ExtensionAPI) {
	const limit = parseEnvironmentContextTokenLimit(process.env[LIMIT_ENV], `${LIMIT_ENV} environment value`) ?? DEFAULT_CONTEXT_TOKEN_LIMIT;
	pi.on("context", createContextLimitHandler(limit));
}
