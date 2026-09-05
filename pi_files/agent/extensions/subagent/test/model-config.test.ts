import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveAgentModel } from "../model-config.ts";

describe("git-operator model override", () => {
	test("uses a non-empty override for git-operator", () => {
		assert.equal(
			resolveAgentModel("git-operator", "anthropic/claude-sonnet", { PI_GIT_OPERATOR_MODEL: "openai/gpt-5.6-luna" }),
			"openai/gpt-5.6-luna",
		);
	});

	test("retains the frontmatter model when the override is unset, empty, or whitespace", () => {
		for (const PI_GIT_OPERATOR_MODEL of [undefined, "", " \t "]) {
			assert.equal(
				resolveAgentModel("git-operator", "anthropic/claude-sonnet", { PI_GIT_OPERATOR_MODEL }),
				"anthropic/claude-sonnet",
			);
		}
	});

	test("does not apply the override to other agents", () => {
		assert.equal(
			resolveAgentModel("code-editor", "anthropic/claude-sonnet", { PI_GIT_OPERATOR_MODEL: "openai/gpt-5.6-luna" }),
			"anthropic/claude-sonnet",
		);
	});

	test("supplies the override when git-operator has no frontmatter model", () => {
		assert.equal(
			resolveAgentModel("git-operator", undefined, { PI_GIT_OPERATOR_MODEL: "openai/gpt-5.6-luna" }),
			"openai/gpt-5.6-luna",
		);
	});
});
