import type { GameManifest, RoomOption } from "@rondo/contracts";

/**
 * 平屋（issue-44〜46）をロビーの選択肢に出してよいか。射撃の見通しは、平屋でも入った（issue-45 の
 * 段階 1・2）が、CPU の一般化（段階 3〜5）が残るので、issue-45 を閉じるまでは false にしておく
 * （通っていない機能は選択画面に出さない）。issue-45 を閉じるときに true にする。
 *
 * 手で確かめるときだけ、開発用の環境変数 NEXT_PUBLIC_VERYARE_HIRAYA=1 で出せる（docs/e2e.md）。
 * 本番のビルド（apps/web/Dockerfile）は、この変数を渡さない。
 */
export const HIRAYA_READY = false;

/** 開発用の指定（NEXT_PUBLIC_VERYARE_HIRAYA=1）。平屋の選択肢と、屋根の切り替えボタンを出す。 */
export const HIRAYA_DEV = process.env.NEXT_PUBLIC_VERYARE_HIRAYA === "1";

/** 平屋の選択肢を出すか（ロビーの先読みも、このときだけ行う）。 */
export const HIRAYA_ENABLED = HIRAYA_READY || HIRAYA_DEV;

/**
 * 屋根と天井の切り替えボタンを出すか。来場者の画面には出さない（屋根は隠したまま）。開発用の
 * 指定があるときか、URL に ?roof=1 があるときだけ出す。search は location.search。
 */
export function roofToggleAllowed(dev: boolean, search: string): boolean {
	return dev || new URLSearchParams(search).get("roof") === "1";
}

/** ステージの選択肢（サーバーの room.gleam の stage と揃える。0 = ランダム間取り、1 = 平屋）。 */
const STAGE_OPTION: RoomOption = {
	key: "stage",
	label: "ステージ",
	choices: [0, 1],
	default: 0,
	choiceLabels: { 0: "ランダム間取り", 1: "平屋" },
};

/** ルーム作成の選択肢。hiraya なら、先頭にステージ（ランダム間取り / 平屋）を足す。 */
export function veryareRoomOptions(hiraya: boolean): RoomOption[] {
	return hiraya ? [STAGE_OPTION, ...BASE_OPTIONS] : [...BASE_OPTIONS];
}

const BASE_OPTIONS: readonly RoomOption[] = [
	{
		key: "explorationSeconds",
		label: "探索時間",
		choices: [40, 60, 80, 100, 120],
		default: 40,
	},
	{
		key: "cpu",
		label: "CPU",
		// 0 = なし、1〜3 = 隠れ側 CPU の数、4 = 鬼 CPU（サーバーの room.gleam と揃える）。
		choices: [0, 1, 2, 3, 4],
		default: 0,
		choiceLabels: {
			0: "なし",
			1: "隠れ側 CPU 1体",
			2: "隠れ側 CPU 2体",
			3: "隠れ側 CPU 3体",
			4: "鬼 CPU",
		},
	},
	{
		key: "cpuStrength",
		label: "鬼 CPU の強さ",
		// 0 = よわい、1 = ふつう、2 = つよい（サーバーの room.gleam と揃える）。
		// 鬼 CPU を選んだときだけ使われる。
		choices: [0, 1, 2],
		default: 1,
		choiceLabels: { 0: "よわい", 1: "ふつう", 2: "つよい" },
	},
];

/**
 * veryare の自己記述（ADR 0003 / 0023）。
 *
 * 鬼1人と隠れ側最大4人のリアルタイムゲーム（ADR 0030）。フェーズと勝敗はサーバー権威
 * （server/src/rondo_server/games/veryare/）が決める。探索時間はルーム作成時に選び、
 * ルーム一覧には出さない（ADR 0024）。CPU（ADR 0038）もルーム作成時に選び、
 * 接続を持たない参加者（CPU N）として加わる。
 */
export const veryareManifest: GameManifest = {
	id: "veryare",
	title: "veryare",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 5,
	thumbnail: "/games/veryare.png",
	description: "見た目を塗って景色に溶け込む、鬼1人のかくれんぼ。",
	// 起動画面（サーバーを探す / 作る）は veryare 自身が持つ（issue-29）。
	launchScreen: "custom",
	roomOptions: veryareRoomOptions(HIRAYA_ENABLED),
};
