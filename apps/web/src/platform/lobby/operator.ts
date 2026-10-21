/**
 * 運営の画面（issue-67）。発表会などで、運営が観戦ルームを作るための画面。URL に ?operator=1 があるとき
 * （実行時の判定。ビルド時の旗には頼らない）だけ、ロビーに観戦ルームを作るトグルを出し、旗
 * （SPECTATE_READY）が下りていても、観戦の行を押せる。
 *
 * 画面を出すだけで、入れるかはサーバーが決める（旗が下りている間は、環境変数 RONDO_SPECTATE_DEV=1 の
 * ときだけ、観戦ルームの作成を受け付ける / docs/runbook.md）。来場者が URL を知っても、サーバーが受け付け
 * なければ作れない。
 */

import type { RoomOption } from "@rondo/contracts";

/** URL の検索の部分（location.search）が、運営の画面を指しているか。 */
export function isOperator(search: string): boolean {
	return new URLSearchParams(search).get("operator") === "1";
}

/**
 * 観戦ルームの作成の設定（create-room の settings）。spectate: 1 と、選択肢ごとの値（選んでいない・選択肢に
 * 無い値は既定）。ステージは送らない（観戦ルームは、ランダム間取りだけ）。
 */
export function spectateSettingsToSend(
	options: readonly RoomOption[],
	settings: Readonly<Record<string, number>>,
): Record<string, number> {
	const out: Record<string, number> = { spectate: 1 };
	for (const option of options) {
		const value = settings[option.key];
		out[option.key] =
			value !== undefined && option.choices.includes(value)
				? value
				: option.default;
	}
	return out;
}
