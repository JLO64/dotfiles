import {
	AssistantMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { COLLAPSED_TOOL_NAMES } from "./collapsed-tool-output.ts";
import { withoutThinking } from "./hidden-thinking.ts";
import type { FocusState } from "./types.ts";

type AssistantInternals = {
	hideThinkingBlock?: boolean;
	hiddenThinkingLabel?: string;
	lastMessage?: { content: Array<{ type: string }> };
};

type ToolInternals = {
	toolName?: string;
	expanded?: boolean;
	imageComponents?: unknown[];
	imageSpacers?: unknown[];
	removeChild?: (component: unknown) => void;
};

/**
 * Isolate Pi implementation coupling here. Every patch is feature-checked and
 * restored on session shutdown; unsupported Pi versions retain stock display.
 */
export function installTranscriptCompatibility(state: FocusState): () => void {
	const assistantPrototype = AssistantMessageComponent.prototype as AssistantMessageComponent & {
		updateContent?: (message: any, isStreaming?: boolean) => void;
		render?: (width: number) => string[];
	};
	const containerPrototype = Container.prototype;
	const toolPrototype = ToolExecutionComponent.prototype as unknown as {
		updateDisplay?: () => void;
	};

	if (
		typeof assistantPrototype.updateContent !== "function" ||
		typeof assistantPrototype.render !== "function" ||
		typeof containerPrototype.addChild !== "function" ||
		typeof containerPrototype.render !== "function" ||
		typeof toolPrototype.updateDisplay !== "function"
	) {
		return () => {};
	}

	const originalUpdateContent = assistantPrototype.updateContent;
	const originalAssistantRender = assistantPrototype.render;
	const originalAddChild = containerPrototype.addChild;
	const originalContainerRender = containerPrototype.render;
	const originalToolUpdateDisplay = toolPrototype.updateDisplay;
	const sourceMessages = new WeakMap<object, any>();
	const suppressing = new WeakMap<object, boolean>();
	const transcriptRoots = new WeakSet<object>();
	const hasTranscriptMessage = (container: Container): boolean =>
		container.children.some(
			(child: unknown) =>
				child instanceof AssistantMessageComponent || child instanceof UserMessageComponent,
		);

	assistantPrototype.updateContent = function (message: any, isStreaming?: boolean): void {
		const internals = this as unknown as AssistantInternals;
		const source = message === internals.lastMessage ? sourceMessages.get(this) ?? message : message;
		const suppressThinking = state.active || (
			internals.hideThinkingBlock === true && internals.hiddenThinkingLabel === ""
		);
		sourceMessages.set(this, source);
		suppressing.set(this, suppressThinking);
		originalUpdateContent.call(this, suppressThinking ? withoutThinking(source) : source, isStreaming);
	};

	assistantPrototype.render = function (width: number): string[] {
		const internals = this as unknown as AssistantInternals;
		const expected = state.active || (
			internals.hideThinkingBlock === true && internals.hiddenThinkingLabel === ""
		);
		if (suppressing.get(this) !== expected && internals.lastMessage) {
			this.updateContent?.(internals.lastMessage);
		}
		return originalAssistantRender.call(this, width);
	};

	containerPrototype.addChild = function (component: any): void {
		if (component instanceof AssistantMessageComponent || component instanceof UserMessageComponent) {
			transcriptRoots.add(this);
		}
		originalAddChild.call(this, component);
	};

	containerPrototype.render = function (width: number): string[] {
		if (!transcriptRoots.has(this) && hasTranscriptMessage(this)) transcriptRoots.add(this);
		if (!state.active || !transcriptRoots.has(this)) return originalContainerRender.call(this, width);
		const children = this.children.filter(
			(child: unknown) => child instanceof AssistantMessageComponent || child instanceof UserMessageComponent,
		);
		const lines: string[] = [];
		for (const child of children) {
			const childLines = (child as { render: (renderWidth: number) => string[] }).render(width);
			if (child instanceof UserMessageComponent && lines.length > 0 && childLines.length > 0) {
				lines.push("");
			}
			lines.push(...childLines);
		}
		return lines;
	};

	toolPrototype.updateDisplay = function (): void {
		originalToolUpdateDisplay.call(this);
		const internals = this as unknown as ToolInternals;
		if (internals.expanded || !COLLAPSED_TOOL_NAMES.has(internals.toolName ?? "")) return;
		for (const component of [...(internals.imageComponents ?? []), ...(internals.imageSpacers ?? [])]) {
			internals.removeChild?.(component);
		}
		internals.imageComponents = [];
		internals.imageSpacers = [];
	};

	return () => {
		assistantPrototype.updateContent = originalUpdateContent;
		assistantPrototype.render = originalAssistantRender;
		containerPrototype.addChild = originalAddChild;
		containerPrototype.render = originalContainerRender;
		toolPrototype.updateDisplay = originalToolUpdateDisplay;
	};
}
