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

type EditCallComponent = {
	children?: unknown[];
	clear?: () => void;
	addChild?: (child: unknown) => void;
};

/** Keep edit's built-in call state but remove its diff preview below the header. */
function collapseEditCallPreview(component: unknown): void {
	const editCall = component as EditCallComponent;
	const header = editCall.children?.[0];
	if (!header || !editCall.clear || !editCall.addChild) return;
	editCall.clear();
	editCall.addChild(header);
}

/**
 * Re-register built-in tools with their own execution and renderers. Collapsed
 * rows hide results; edit additionally hides its renderCall diff preview while
 * retaining the header and its renderer-owned preview state for expansion.
 */
export function withCollapsedResult<TParams extends TSchema, TDetails, TState>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	return {
		...tool,
		renderCall(args, theme, context) {
			const component = tool.renderCall?.(args, theme, context) ?? new Container();
			if (tool.name === "edit" && !context.expanded) collapseEditCallPreview(component);
			return component;
		},
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
