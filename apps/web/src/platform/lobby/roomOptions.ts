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

/** プルダウンに出す表示名。表示名が無い値は数値をそのまま出す。 */
export function choiceLabel(option: RoomOption, value: number): string {
	return option.choiceLabels?.[value] ?? String(value);
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

/**
 * 画面に出す選択肢。hidden は、いまの選び方では出さない選択肢の key（何を出さないかはゲームの側が
 * 決める / games/registry の hiddenRoomOptions）。宣言の順のまま並べる。
 */
export function visibleOptions(
	options: readonly RoomOption[],
	hidden: readonly string[],
): readonly RoomOption[] {
	return options.filter((option) => !hidden.includes(option.key));
}

/**
 * create-room に送る設定。出さない選択肢は、選んでいた値ではなく、既定値を送る（選んでいた値は
 * 手元の settings に残すので、出す状態へ戻せば、そのまま使える）。
 */
export function settingsToSend(
	options: readonly RoomOption[],
	settings: RoomSettings,
	hidden: readonly string[],
): RoomSettings {
	const defaults = Object.fromEntries(
		options
			.filter((option) => hidden.includes(option.key))
			.map((option) => [option.key, option.default]),
	);
	return { ...settings, ...defaults };
}
