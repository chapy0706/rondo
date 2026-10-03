/**
 * rolling のモード（issue-36）。
 *
 * モードごとに「利用可能か」を持ち、利用できないモードを選んだときのお知らせも
 * ここで決める。対戦モードを実装するときは available を true にし、遊び始め方を
 * 足せばよい（画面側の分岐は chooseMode の結果に従うだけ）。
 */

import { TEXT } from "./text";

export type ModeId = "solo" | "versus";

export interface Mode {
	readonly id: ModeId;
	readonly label: string;
	readonly note: string;
	readonly available: boolean;
	/** 利用できないときに出すお知らせ。 */
	readonly unavailableMessage?: string;
}

export const MODES: readonly Mode[] = [
	{
		id: "solo",
		label: TEXT.soloMode,
		note: TEXT.soloModeNote,
		available: true,
	},
	{
		id: "versus",
		label: TEXT.versusMode,
		note: TEXT.versusModeNote,
		available: false,
		unavailableMessage: TEXT.versusUnavailable,
	},
];

/** モードを選んだ結果。遊び始めるか、お知らせを出すか。 */
export type ModeChoice =
	| { readonly kind: "play" }
	| { readonly kind: "notice"; readonly message: string };

export function chooseMode(id: ModeId): ModeChoice {
	const mode = MODES.find((candidate) => candidate.id === id);
	if (mode?.available === true) return { kind: "play" };
	return {
		kind: "notice",
		message: mode?.unavailableMessage ?? TEXT.versusUnavailable,
	};
}
