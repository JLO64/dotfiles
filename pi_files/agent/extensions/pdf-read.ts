/**
 * pi-pdf-read
 *
 * Overrides the built-in `read` tool so that when a PDF file is opened,
 * its pages are rendered to PNG images. A vision-capable model can then
 * "see" the document. All other file types are read normally.
 *
 * Dependency: poppler (`pdftoppm` command)
 *
 *   macOS:   brew install poppler
 *   Ubuntu:  apt-get install poppler-utils
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { constants } from "fs";
import { access, readFile, mkdtemp, readdir, rm } from "fs/promises";
import { resolve, join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

/** ------------------------------------------------------------------ */
/*  Defaults                                                            */
/** ------------------------------------------------------------------ */

const DEFAULT_DPI = 200;        // Render quality (dots-per-inch)
const DEFAULT_MAX_PAGES = 20;   // Safety cap for very large PDFs

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

/** ------------------------------------------------------------------ */
/*  Helpers                                                             */
/** ------------------------------------------------------------------ */

function isPdfFile(path: string): boolean {
	return path.toLowerCase().endsWith(".pdf");
}

function isImageFile(path: string): boolean {
	return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(path);
}

function getImageMimeType(path: string): string {
	const ext = path.toLowerCase().split(".").pop();
	switch (ext) {
		case "png": return "image/png";
		case "jpg":
		case "jpeg": return "image/jpeg";
		case "gif": return "image/gif";
		case "webp": return "image/webp";
		case "bmp": return "image/bmp";
		case "svg": return "image/svg+xml";
		default: return "image/png";
	}
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

/** Standard text/image read for non-PDF files. */
async function readNonPdfFile(
	absolutePath: string,
	offset?: number,
	limit?: number,
): Promise<{ content: (TextContent | ImageContent)[]; details: object }> {
	await access(absolutePath, constants.R_OK);

	if (isImageFile(absolutePath)) {
		const data = await readFile(absolutePath, { encoding: "base64" });
		return {
			content: [{ type: "image", data, mimeType: getImageMimeType(absolutePath) }],
			details: { image: true, path: absolutePath },
		};
	}

	const content = await readFile(absolutePath, "utf-8");
	const lines = content.split("\n");
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const endLine = limit ? startLine + limit : lines.length;
	const selectedLines = lines.slice(startLine, endLine);

	let text = selectedLines.join("\n");
	const maxBytes = 50 * 1024;
	if (Buffer.byteLength(text, "utf-8") > maxBytes) {
		text = text.slice(0, maxBytes) + "\n\n[Output truncated at 50KB]";
	}

	return {
		content: [{ type: "text", text }],
		details: { lines: lines.length, path: absolutePath },
	};
}

/** Convert a PDF to a series of base64-encoded PNG images. */
async function convertPdfToImages(
	pdfPath: string,
	dpi = DEFAULT_DPI,
	maxPages = DEFAULT_MAX_PAGES,
): Promise<{ images: ImageContent[]; pageCount: number }> {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-pdf-vision-"));

	try {
		// Attempt to get true page count (gracefully degrade if pdfinfo is missing)
		let pageCount = 0;
		try {
			const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
			const match = stdout.match(/Pages:\s*(\d+)/);
			if (match) pageCount = parseInt(match[1], 10);
		} catch {
			/* pdfinfo may not be present; we'll count generated files instead */
		}

		const args: string[] = ["-png", "-r", String(dpi), "-f", "1", "-l", String(maxPages)];
		args.push(pdfPath, join(tempDir, "page"));

		await execFileAsync("pdftoppm", args);

		const files = await readdir(tempDir);
		const imageFiles = files
			.filter((f) => f.endsWith(".png"))
			.sort((a, b) => {
				const numA = parseInt(a.match(/-(\d+)\.png$/)?.[1] ?? "0", 10);
				const numB = parseInt(b.match(/-(\d+)\.png$/)?.[1] ?? "0", 10);
				return numA - numB;
			});

		if (!pageCount) pageCount = imageFiles.length;

		const images: ImageContent[] = [];
		for (const file of imageFiles) {
			const data = await readFile(join(tempDir, file), { encoding: "base64" });
			images.push({ type: "image", data, mimeType: "image/png" });
		}

		return { images, pageCount };
	} finally {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
}

/** ------------------------------------------------------------------ */
/*  Extension entry point                                               */
/** ------------------------------------------------------------------ */

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "read",
		label: "read (PDF → vision)",
		description:
			"Read file contents. For PDFs, converts pages to PNG images so vision-capable models can analyze them. For other files, reads text or images normally.",
		parameters: readSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { path, offset, limit } = params;
			const absolutePath = resolve(ctx.cwd, path);

			// --- File access check ------------------------------------------------
			try {
				await access(absolutePath, constants.R_OK);
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error: Cannot read "${path}" — ${error.message}` }],
					details: { error: true, path: absolutePath },
				};
			}

			// --- Non-PDF pass-through ---------------------------------------------
			if (!isPdfFile(absolutePath)) {
				const result = await readNonPdfFile(absolutePath, offset, limit);
				return { content: result.content, details: result.details };
			}

			// --- PDF: check model vision support ----------------------------------
			const model = ctx.model;
			if (!model || !model.input.includes("image")) {
				return {
					content: [{
						type: "text",
						text:
							`PDF detected: "${path}" (${absolutePath})\n\n` +
							`The current model (${model?.id ?? "unknown"}) does not support image input. ` +
							`Switch to a vision-capable model to read this PDF visually.`,
					}],
					details: { error: true, pdf: true, path: absolutePath },
				};
			}

			// --- PDF: check for pdftoppm -----------------------------------------
			const hasPdftoppm = await checkCommand("pdftoppm");
			if (!hasPdftoppm) {
				return {
					content: [{
						type: "text",
						text:
							`PDF detected: "${path}"\n\n` +
							`The \`pdftoppm\` command is required to convert PDF pages to images, but it was not found.\n\n` +
							`Install poppler:\n` +
							`  macOS:   brew install poppler\n` +
							`  Ubuntu:  apt-get install poppler-utils\n` +
							`  Windows: https://github.com/oschwartz10612/poppler-windows/releases/`,
					}],
					details: { error: true, pdf: true, missingDependency: "pdftoppm", path: absolutePath },
				};
			}

			// --- PDF: convert and return images ----------------------------------
			try {
				const { images, pageCount } = await convertPdfToImages(absolutePath);

				if (images.length === 0) {
					return {
						content: [{ type: "text", text: `No pages could be extracted from "${path}".` }],
						details: { error: true, pdf: true, path: absolutePath },
					};
				}

				const note =
					images.length < pageCount
						? ` (showing first ${images.length} of ${pageCount} pages; limit is ${DEFAULT_MAX_PAGES})`
						: ` (${pageCount} page(s))`;

				const summaryText = `PDF: "${path}"${note}\n`;

				return {
					content: [{ type: "text", text: summaryText }, ...images],
					details: { pdf: true, pageCount, imagesRendered: images.length, path: absolutePath },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error converting PDF "${path}": ${error.message}` }],
					details: { error: true, pdf: true, path: absolutePath },
				};
			}
		},
	});
}
