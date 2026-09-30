import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type PrivateSessionState = "ready" | "active" | "uncertain";

export interface PrivateSubagentSession {
	handle: string;
	agent: string;
	agentSource: "user" | "project";
	agentFilePath: string;
	cwd: string;
	agentScope: "user" | "project" | "both";
	contextTokenLimit: number;
	lastContextMeasurement?: { tokens: number; measuredAt: number };
}

const HANDLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const locks = new Map<string, Promise<void>>();

export function privateSessionRoot(): string {
	return path.join(os.homedir(), ".pi", "agent", "subagent-sessions");
}

export function isSessionHandle(value: string): boolean {
	return HANDLE_PATTERN.test(value);
}

export async function createPrivateSession(session: Omit<PrivateSubagentSession, "handle">): Promise<PrivateSubagentSession> {
	const handle = randomUUID();
	const record = { ...session, handle };
	const root = privateSessionRoot();
	const sessions = path.join(root, "sessions");
	await fs.mkdir(sessions, { recursive: true, mode: 0o700 });
	await fs.chmod(root, 0o700);
	await fs.chmod(sessions, 0o700);
	const dir = path.join(sessions, handle);
	await fs.mkdir(dir, { mode: 0o700 });
	await fs.writeFile(path.join(dir, "owner.json"), JSON.stringify(record), { encoding: "utf8", mode: 0o600, flag: "wx" });
	await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ state: "ready" }), { encoding: "utf8", mode: 0o600, flag: "wx" });
	return record;
}

export async function getPrivateSession(handle: string): Promise<PrivateSubagentSession | undefined> {
	if (!isSessionHandle(handle)) return undefined;
	const file = path.join(privateSessionRoot(), "sessions", handle, "owner.json");
	try {
		const stat = await fs.lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
		const data: unknown = JSON.parse(await fs.readFile(file, "utf8"));
		if (!data || typeof data !== "object") return undefined;
		const record = data as Partial<PrivateSubagentSession>;
		if (record.handle !== handle || typeof record.agent !== "string" || typeof record.agentFilePath !== "string" ||
			typeof record.cwd !== "string" || typeof record.contextTokenLimit !== "number" ||
			(record.agentSource !== "user" && record.agentSource !== "project") ||
			(record.agentScope !== "user" && record.agentScope !== "project" && record.agentScope !== "both")) return undefined;
		const measurement = (record as any).lastContextMeasurement;
		if (measurement !== undefined && (!measurement || !Number.isSafeInteger(measurement.tokens) || measurement.tokens < 0 ||
			!Number.isSafeInteger(measurement.measuredAt) || measurement.measuredAt < 0)) return undefined;
		return record as PrivateSubagentSession;
	} catch {
		return undefined;
	}
}

export async function updatePrivateSessionContext(
	handle: string,
	contextTokenLimit: number,
	measurement?: { tokens: number; measuredAt: number },
): Promise<void> {
	const file = path.join(privateSessionDir(handle), "owner.json");
	const session = await getPrivateSession(handle);
	if (!session) throw new Error("Cannot update invalid private subagent session");
	const updated: PrivateSubagentSession = {
		...session,
		contextTokenLimit,
		...(measurement ? { lastContextMeasurement: measurement } : {}),
	};
	const temp = `${file}.${randomUUID()}.tmp`;
	await fs.writeFile(temp, JSON.stringify(updated), { encoding: "utf8", mode: 0o600, flag: "wx" });
	await fs.rename(temp, file);
}

export async function getPrivateSessionState(handle: string): Promise<PrivateSessionState> {
	if (!isSessionHandle(handle)) return "uncertain";
	try {
		const value = JSON.parse(await fs.readFile(path.join(privateSessionDir(handle), "state.json"), "utf8"));
		return value.state === "active" || value.state === "uncertain" ? value.state : "ready";
	} catch {
		return "uncertain";
	}
}

export async function setPrivateSessionState(handle: string, state: PrivateSessionState): Promise<void> {
	const file = path.join(privateSessionDir(handle), "state.json");
	const temp = `${file}.${randomUUID()}.tmp`;
	await fs.writeFile(temp, JSON.stringify({ state }), { encoding: "utf8", mode: 0o600, flag: "wx" });
	await fs.rename(temp, file);
}

export function privateSessionDir(handle: string): string {
	if (!isSessionHandle(handle)) throw new Error("Invalid private subagent session handle");
	return path.join(privateSessionRoot(), "sessions", handle);
}

/** Serialize all prompts for a session within this extension process. */
export async function withPrivateSessionLock<T>(handle: string, operation: () => Promise<T>): Promise<T> {
	const prior = locks.get(handle) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => { release = resolve; });
	const tail = prior.then(() => current);
	locks.set(handle, tail);
	await prior;
	const lockDir = path.join(privateSessionDir(handle), ".write-lock");
	let ownsLock = false;
	try {
		while (!ownsLock) {
			try {
				await fs.mkdir(lockDir, { mode: 0o700 });
				await fs.writeFile(path.join(lockDir, "owner"), `${process.pid} ${Date.now()}`, { mode: 0o600, flag: "wx" });
				ownsLock = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				let stale = false;
				try {
					const [pidText, timestampText] = (await fs.readFile(path.join(lockDir, "owner"), "utf8")).split(" ");
					const pid = Number(pidText);
					const timestamp = Number(timestampText);
					if (Date.now() - timestamp > 24 * 60 * 60 * 1000) stale = true;
					else {
						try { process.kill(pid, 0); } catch (probeError) {
							if ((probeError as NodeJS.ErrnoException).code === "ESRCH") stale = true;
						}
					}
				} catch {
					const stat = await fs.stat(lockDir).catch(() => undefined);
					stale = !!stat && Date.now() - stat.mtimeMs > 30_000;
				}
				if (stale) await fs.rm(lockDir, { recursive: true, force: true });
				else await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
		return await operation();
	} finally {
		if (ownsLock) await fs.rm(lockDir, { recursive: true, force: true });
		release();
		if (locks.get(handle) === tail) locks.delete(handle);
	}
}
