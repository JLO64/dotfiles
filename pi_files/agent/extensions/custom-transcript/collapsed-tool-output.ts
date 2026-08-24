import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

/** Tool names whose built-in renderers are safely overridden. */
export const COLLAPSED_TOOL_NAMES = new Set([
	"bash",
	"edit",
	"find",
	"grep",
	"ls",
	"read",
	"write",
]);

export function emptyCollapsedResult(): Container {
	return new Container();
}

/**
 * Re-register built-in tools with their own execution and call renderers, but
 * no collapsed result component. The original result renderer is delegated to
 * unchanged when Ctrl+O expands the row.
 */
export function withCollapsedResult<TParams extends TSchema, TDetails, TState>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	return {
		...tool,
		renderResult(result, options, theme, context) {
			if (!options.expanded) return emptyCollapsedResult();
			return tool.renderResult?.(result, options, theme, context) ?? emptyCollapsedResult();
		},
	};
}

function registerCollapsedTool<TParams extends TSchema, TDetails, TState>(
	pi: ExtensionAPI,
	tool: ToolDefinition<TParams, TDetails, TState>,
): void {
	pi.registerTool(withCollapsedResult(tool));
}

export function registerCollapsedBuiltinTools(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	registerCollapsedTool(pi, createBashToolDefinition(cwd));
	registerCollapsedTool(pi, createEditToolDefinition(cwd));
	registerCollapsedTool(pi, createFindToolDefinition(cwd));
	registerCollapsedTool(pi, createGrepToolDefinition(cwd));
	registerCollapsedTool(pi, createLsToolDefinition(cwd));
	registerCollapsedTool(pi, createWriteToolDefinition(cwd));
}
