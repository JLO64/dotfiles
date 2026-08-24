export type FocusState = {
	active: boolean;
};

export type AssistantContentBlock = {
	type: string;
	text?: string;
	thinking?: string;
};

export type AssistantMessageLike = {
	content: AssistantContentBlock[];
};
