/**
 * ルーム作成時の設定（マニフェストの roomOptions）の扱い。
 *
 * ロビーは宣言された選択肢からプルダウンを作るだけで、個々のゲームを知らない（ADR 0003）。
 * 選んだ値は create-room の settings として送り、ルーム一覧には出さない（ADR 0024）。
 */

import type { RoomOption } from "@rondo/contracts";

export type RoomSettings = Readonly<Record<string, number>>;

/** 各選択肢の既定値を key ごとに並べる。 */
export function initialSettings(
	options: readonly RoomOption[] | undefined,
): RoomSettings {
	return Object.fromEntries(
		(options ?? []).map((option) => [option.key, option.default]),
	);
}

/** プルダウンで選んだ値（文字列）を反映する。選択肢にない値は無視する。 */
export function chooseOption(
	settings: RoomSettings,
	option: RoomOption,
	raw: string,
): RoomSettings {
	const value = Number(raw);
	if (!option.choices.includes(value)) return settings;
	return { ...settings, [option.key]: value };
}
