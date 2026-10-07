import { basename } from "node:path";

export interface FooterDetailsInput {
	model: string;
	modelWithoutProvider: string;
	stats: string[];
	reasoningEffort?: string;
	contextUsage?: { used: string; withMaximum: string };
	cost?: string;
	path: string;
	cwd: string;
	hostname?: string;
	time?: string;
	duration?: string;
	git?: { branch: string; suffix: string };
	icons: { model: string; directory: string; git: string; time: string };
	connectors: { in: string; on: string; at: string };
	commaSeparator?: string;
	colorizeDirectory?: (text: string) => string;
}

/** Format durations without padding between units. */
export function formatCompactDuration(totalMinutes: number): string {
	const minutes = Math.max(0, Math.ceil(totalMinutes));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const remainder = minutes % 60;
	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${String(remainder).padStart(2, "0")}m`;
	return `${remainder}m`;
}

/** Format context usage with an optional actual model context-window maximum. */
export function formatContextUsage(tokens?: number | null, contextWindow?: number): string | undefined {
	if (!Number.isFinite(tokens) || tokens! < 0) return undefined;
	const used = tokens === 0 ? "0" : `${(tokens! / 1000).toFixed(1)}k`;
	const maximum = (count: number) => count < 1000
		? count.toString()
		: count < 1000000
			? `${Math.round(count / 1000)}k`
			: `${(count / 1000000).toFixed(1)}M`;
	if (!Number.isFinite(contextWindow) || contextWindow! <= 0) return used;
	return `${used}/${maximum(contextWindow!)}`;
}

/** Build the baseline and cumulative width-reduction candidates in display order. */
export function buildFooterDetailsStages(input: FooterDetailsInput): string[] {
	const stats = input.cost === undefined ? input.stats : [...input.stats, input.cost];
	const build = (options: {
		omitProvider?: boolean;
		hideDuration?: boolean;
		hideTime?: boolean;
		basenameOnly?: boolean;
		hideHostname?: boolean;
		hideIcons?: boolean;
		hideCost?: boolean;
		hideConnectors?: boolean;
		branchOnly?: boolean;
		hideContextMaximum?: boolean;
		hideReasoningEffort?: boolean;
		hideStatsGroup?: boolean;
	}) => {
		const model = options.omitProvider ? input.modelWithoutProvider : input.model;
		const selectedStats = stats.filter((_, index) => !(options.hideCost && index === stats.length - 1 && input.cost !== undefined));
		const detailStats = [
			...(!options.hideReasoningEffort && input.reasoningEffort ? [input.reasoningEffort] : []),
			...(input.contextUsage ? [options.hideContextMaximum ? input.contextUsage.used : input.contextUsage.withMaximum] : []),
			...selectedStats,
		];
		const modelText = `${options.hideIcons ? "" : input.icons.model}${model}`;
		const statsText = !options.hideStatsGroup && detailStats.length > 0 ? `(${detailStats.join(input.commaSeparator ?? ", ")})` : "";
		const directoryPath = options.basenameOnly ? basename(input.cwd) : input.path;
		const hostname = input.hostname && !options.hideHostname ? `(${input.hostname})` : "";
		const directory = `${options.hideIcons ? "" : input.icons.directory}${input.colorizeDirectory ? input.colorizeDirectory(directoryPath) : directoryPath}${hostname}`;
		const git = input.git
			? ` ${options.hideConnectors ? "" : `${input.connectors.on} `}${options.hideIcons ? "" : `${input.icons.git} `}${input.git.branch}${options.branchOnly ? "" : input.git.suffix}`
			: "";
		const time = options.hideTime || !input.time
			? ""
			: ` ${options.hideConnectors ? "" : `${input.connectors.at} `}${options.hideIcons ? "" : input.icons.time}${input.time}${options.hideDuration ? "" : input.duration ?? ""}`;
		const locationConnector = options.hideConnectors ? " " : input.connectors.in;
		return `${modelText}${statsText}${locationConnector}${directory}${git}${time}`;
	};

	return [
		build({}),
		build({ hideHostname: true }),
		build({ hideHostname: true, omitProvider: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, basenameOnly: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, basenameOnly: true, hideTime: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true, hideContextMaximum: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true, hideContextMaximum: true, hideIcons: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true, hideContextMaximum: true, hideIcons: true, hideConnectors: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true, hideContextMaximum: true, hideIcons: true, hideConnectors: true, branchOnly: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true, hideContextMaximum: true, hideIcons: true, hideConnectors: true, branchOnly: true, hideReasoningEffort: true }),
		build({ hideHostname: true, omitProvider: true, hideDuration: true, hideTime: true, basenameOnly: true, hideCost: true, hideContextMaximum: true, hideIcons: true, hideConnectors: true, branchOnly: true, hideReasoningEffort: true, hideStatsGroup: true }),
	];
}
