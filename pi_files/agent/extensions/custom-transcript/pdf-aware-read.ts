import {
	createReadToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { constants } from "node:fs";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { withCollapsedResult } from "./collapsed-tool-output.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_DPI = 200;
const DEFAULT_MAX_PAGES = 20;

type PdfTransport = "page-images" | "unsupported";

type ReadResult = { content: (TextContent | ImageContent)[]; details: object };

function isPdfFile(path: string): boolean {
	return path.toLowerCase().endsWith(".pdf");
}

async function checkCommand(command: string): Promise<boolean> {
	const checkCmd = process.platform === "win32" ? "where" : "which";
	try {
		await execFileAsync(checkCmd, [command]);
		return true;
	} catch {
		return false;
	}
}

/** Pi currently serializes only text and image tool-result blocks. */
function selectPdfTransport(supportsImages: boolean): PdfTransport {
	return supportsImages ? "page-images" : "unsupported";
}

async function convertPdfToImages(
	pdfPath: string,
	dpi = DEFAULT_DPI,
	maxPages = DEFAULT_MAX_PAGES,
): Promise<{ images: ImageContent[]; pageCount: number }> {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-pdf-vision-"));
	try {
		let pageCount = 0;
		try {
			const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
			const match = stdout.match(/Pages:\s*(\d+)/);
			if (match) pageCount = parseInt(match[1], 10);
		} catch {
			// pdfinfo is optional; count the rendered files instead.
		}

		await execFileAsync("pdftoppm", [
			"-png", "-r", String(dpi), "-f", "1", "-l", String(maxPages), pdfPath, join(tempDir, "page"),
		]);
		const imageFiles = (await readdir(tempDir))
			.filter((file) => file.endsWith(".png"))
			.sort((a, b) => {
				const page = (file: string) => parseInt(file.match(/-(\d+)\.png$/)?.[1] ?? "0", 10);
				return page(a) - page(b);
			});
		if (!pageCount) pageCount = imageFiles.length;

		return {
			images: await Promise.all(imageFiles.map(async (file) => ({
				type: "image" as const,
				data: await readFile(join(tempDir, file), { encoding: "base64" }),
				mimeType: "image/png" as const,
			}))),
			pageCount,
		};
	} finally {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
}

async function executePdfRead(path: string, ctx: { cwd: string; model?: { id?: string; input: string[] } }): Promise<ReadResult> {
	const absolutePath = resolve(ctx.cwd, path);
	try {
		await access(absolutePath, constants.R_OK);
	} catch (error: any) {
		return {
			content: [{ type: "text", text: `Error: Cannot read "${path}" — ${error.message}` }],
			details: { error: true, path: absolutePath },
		};
	}

	const pdfTransport = selectPdfTransport(ctx.model?.input.includes("image") ?? false);
	if (pdfTransport === "unsupported") {
		return {
			content: [{
				type: "text",
				text: `PDF detected: "${path}" (${absolutePath})\n\nThe current model (${ctx.model?.id ?? "unknown"}) does not support image input. Switch to a vision-capable model to read this PDF visually.`,
			}],
			details: { error: true, pdf: true, path: absolutePath },
		};
	}

	if (!await checkCommand("pdftoppm")) {
		return {
			content: [{
				type: "text",
				text: `PDF detected: "${path}"\n\nThe \`pdftoppm\` command is required to convert PDF pages to images, but it was not found.\n\nInstall poppler:\n  macOS:   brew install poppler\n  Ubuntu:  apt-get install poppler-utils\n  Windows: https://github.com/oschwartz10612/poppler-windows/releases/`,
			}],
			details: { error: true, pdf: true, missingDependency: "pdftoppm", path: absolutePath },
		};
	}

	try {
		const { images, pageCount } = await convertPdfToImages(absolutePath);
		if (images.length === 0) {
			return {
				content: [{ type: "text", text: `No pages could be extracted from "${path}".` }],
				details: { error: true, pdf: true, path: absolutePath },
			};
		}
		const note = images.length < pageCount
			? ` (showing first ${images.length} of ${pageCount} pages; limit is ${DEFAULT_MAX_PAGES})`
			: ` (${pageCount} page(s))`;
		return {
			content: [{ type: "text", text: `PDF: "${path}"${note}\n` }, ...images],
			details: { pdf: true, transport: pdfTransport, pageCount, imagesRendered: images.length, path: absolutePath },
		};
	} catch (error: any) {
		return {
			content: [{ type: "text", text: `Error converting PDF "${path}": ${error.message}` }],
			details: { error: true, pdf: true, path: absolutePath },
		};
	}
}

/**
 * Reuses Pi's standard read definition for ordinary files and changes only
 * PDF execution. The inherited renderers retain Pi's call headers and full
 * Ctrl+O-expanded result display.
 */
export function createPdfAwareReadToolDefinition(cwd: string) {
	const standardRead = createReadToolDefinition(cwd);
	return withCollapsedResult({
		...standardRead,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!isPdfFile(params.path)) return standardRead.execute(toolCallId, params, signal, onUpdate, ctx);
			return executePdfRead(params.path, ctx);
		},
	});
}

export function registerPdfAwareCollapsedRead(pi: ExtensionAPI): void {
	pi.registerTool(createPdfAwareReadToolDefinition(process.cwd()));
}
