export const GIT_OPERATOR_AGENT_NAME = "git-operator";
export const GIT_OPERATOR_MODEL_ENV = "PI_GIT_OPERATOR_MODEL";

/**
 * Select the model for an agent profile, allowing only git-operator to receive
 * its dedicated environment override.
 */
export function resolveAgentModel(
	agentName: string,
	frontmatterModel: string | undefined,
	environment: { [GIT_OPERATOR_MODEL_ENV]?: string } = process.env,
): string | undefined {
	if (agentName !== GIT_OPERATOR_AGENT_NAME) return frontmatterModel;

	const override = environment[GIT_OPERATOR_MODEL_ENV]?.trim();
	return override || frontmatterModel;
}
