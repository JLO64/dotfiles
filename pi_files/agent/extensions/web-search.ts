import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const EXA_BASE = "https://api.exa.ai";

function getApiKey(): string {
	const key = process.env.EXA_API_KEY;
	if (!key) throw new Error("EXA_API_KEY environment variable is not set");
	return key;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search (Exa)",
		description:
			"Search the web using Exa neural search. Returns titles, URLs, and snippets for the top results.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			numResults: Type.Optional(
				Type.Number({ description: "Number of results to return (default: 5)" }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const response = await fetch(`${EXA_BASE}/search`, {
					method: "POST",
					headers: {
						"x-api-key": getApiKey(),
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						query: params.query,
						numResults: params.numResults ?? 5,
						type: "auto",
					}),
				});

				if (!response.ok) {
					const err = await response.text();
					return {
						content: [{ type: "text", text: `Exa search error (${response.status}): ${err}` }],
						isError: true,
					};
				}

				const data = await response.json() as {
					results: Array<{
						title: string;
						url: string;
						publishedDate?: string;
						snippet?: string;
					}>;
				};

				const lines = data.results.map((r, i) => {
					const parts = [`${i + 1}. ${r.title}`, `   ${r.url}`];
					if (r.publishedDate) parts.push(`   Published: ${r.publishedDate}`);
					if (r.snippet) parts.push(`   ${r.snippet}`);
					return parts.join("\n");
				});

				return { content: [{ type: "text", text: lines.join("\n\n") }] };
			} catch (err: any) {
				return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch (Exa)",
		description: "Retrieve the full text content of a webpage by URL using Exa.",
		parameters: Type.Object({
			url: Type.String({ description: "URL of the page to fetch" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const response = await fetch(`${EXA_BASE}/contents`, {
					method: "POST",
					headers: {
						"x-api-key": getApiKey(),
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						urls: [params.url],
						text: true,
					}),
				});

				if (!response.ok) {
					const err = await response.text();
					return {
						content: [{ type: "text", text: `Exa fetch error (${response.status}): ${err}` }],
						isError: true,
					};
				}

				const data = await response.json() as {
					results: Array<{ url: string; title: string; text?: string }>;
				};

				const result = data.results[0];
				if (!result?.text) {
					return {
						content: [{ type: "text", text: `No content returned for ${params.url}` }],
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: `# ${result.title}\n${result.url}\n\n${result.text}` }],
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
			}
		},
	});
}
