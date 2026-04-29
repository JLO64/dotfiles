import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Clears the terminal screen before pi renders its UI.
 *
 * Why: When launching pi from a terminal that has previous command output
 * above it, the leftover scrollback clutter is distracting. This extension
 * clears the screen at key lifecycle points:
 *
 *   - On initial startup (via factory function, before TUI mounts)
 *   - On /new or /resume (user switching to a new/restored session)
 *
 * Not cleared on /reload (already running, screen is stable) or /fork
 * (forking preserves continuity).
 */

function clear() {
	process.stdout.write("\x1b[2J\x1b[H");
}

export default function (pi: ExtensionAPI) {
	// ── Clear on initial startup ──────────────────────────────────────
	// The extension factory runs before the TUI mounts, so this write
	// happens before any pi content renders on screen.
	clear();

	// ── Clear on session transitions ──────────────────────────────────
	// When the user starts a brand-new session or resumes an old one,
	// clear any accumulated scrollback from the previous session so the
	// new session starts with a clean slate.
	pi.on("session_start", async (event) => {
		if (event.reason === "new" || event.reason === "resume") {
			clear();
		}
		// "fork" — keep continuity, don't clear
		// "reload" — hot-reload mid-session, screen is already clean
		// "startup" — already cleared in the factory above
	});
}
