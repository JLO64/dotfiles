import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, test } from "node:test";
import { createPrivateSession, getPrivateSession, getPrivateSessionState, isSessionHandle, privateSessionDir, setPrivateSessionState, updatePrivateSessionContext, withPrivateSessionLock } from "../session-store.ts";

const originalHome = process.env.HOME;
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-session-test-"));
process.env.HOME = testHome;
after(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await fs.rm(testHome, { recursive: true, force: true });
});

describe("private subagent sessions", () => {
	test("creates a random opaque handle and persists private owner metadata", async () => {
		const session = await createPrivateSession({
			agent: "researcher", agentSource: "user", agentFilePath: "/profiles/researcher.md", cwd: "/work",
			agentScope: "both", contextTokenLimit: 90000,
		});
		assert.equal(isSessionHandle(session.handle), true);
		assert.deepEqual(await getPrivateSession(session.handle), session);
		assert.equal(await getPrivateSessionState(session.handle), "ready");
		await setPrivateSessionState(session.handle, "uncertain");
		assert.equal(await getPrivateSessionState(session.handle), "uncertain");
		await updatePrivateSessionContext(session.handle, 80_000, { tokens: 32_000, measuredAt: 1_700_000_000_000 });
		assert.deepEqual(await getPrivateSession(session.handle), {
			...session, contextTokenLimit: 80_000, lastContextMeasurement: { tokens: 32_000, measuredAt: 1_700_000_000_000 },
		});
		assert.equal((await fs.stat(privateSessionDir(session.handle))).mode & 0o777, 0o700);
		assert.equal(isSessionHandle("../../sessions"), false);
		assert.equal(await getPrivateSession("../../sessions"), undefined);
	});

	test("reads older owner records without optional measurement metadata", async () => {
		const session = await createPrivateSession({
			agent: "researcher", agentSource: "user", agentFilePath: "/profiles/researcher.md", cwd: "/work",
			agentScope: "user", contextTokenLimit: 90_000,
		});
		const ownerPath = path.join(privateSessionDir(session.handle), "owner.json");
		const { lastContextMeasurement: _, ...legacy } = session;
		await fs.writeFile(ownerPath, JSON.stringify(legacy));
		assert.deepEqual(await getPrivateSession(session.handle), legacy);
	});

	test("reloads metadata after acquiring a queued continuation lock", async () => {
		const session = await createPrivateSession({
			agent: "researcher", agentSource: "user", agentFilePath: "/profiles/researcher.md", cwd: "/work",
			agentScope: "user", contextTokenLimit: 90_000,
		});
		const staleSnapshot = await getPrivateSession(session.handle);
		let releaseFirst!: () => void;
		const firstHasLock = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const first = withPrivateSessionLock(session.handle, async () => {
			await firstHasLock;
			await updatePrivateSessionContext(session.handle, 70_000);
		});
		const second = withPrivateSessionLock(session.handle, async () => {
			const fresh = await getPrivateSession(session.handle);
			assert.equal(staleSnapshot?.contextTokenLimit, 90_000);
			assert.equal(fresh?.contextTokenLimit, 70_000);
		});
		releaseFirst();
		await Promise.all([first, second]);
	});

	test("serializes same-session prompts", async () => {
		const session = await createPrivateSession({
			agent: "researcher", agentSource: "user", agentFilePath: "/profiles/researcher.md", cwd: "/work",
			agentScope: "user", contextTokenLimit: 90000,
		});
		const order: number[] = [];
		await Promise.all([1, 2].map((value) => withPrivateSessionLock(session.handle, async () => {
			order.push(value);
			await new Promise((resolve) => setTimeout(resolve, 5));
			order.push(value);
		})));
		assert.ok(order[0] === order[1] && order[2] === order[3]);
		assert.notEqual(order[0], order[2]);
	});
});
