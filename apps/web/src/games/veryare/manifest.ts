import type { GameManifest, RoomOption } from "@rondo/contracts";
import { VERYARE_ROAMING, VERYARE_SPREADING } from "@rondo/contracts";

/**
 * 平屋（issue-44〜46）をロビーの選択肢に出してよいか。素材の配信がつながったので true にした
 * （ロビーの選択肢は、ランダム間取り（既定）と平屋の 2 つ）。平屋を選んだときは、CPU の選択肢を
 * 出さない（veryareHiddenOptions。サーバーが平屋と CPU の組み合わせを断るため）。
 *
 * 出すのをやめるときは、false に戻す（手順は docs/e2e.md の「平屋のステージ」）。false の間も、
 * 手で確かめるときだけ、開発用の環境変数 NEXT_PUBLIC_VERYARE_HIRAYA=1 で出せる。
 */
export const HIRAYA_READY = true;

/** 開発用の指定（NEXT_PUBLIC_VERYARE_HIRAYA=1）。平屋の選択肢と、屋根の切り替えボタンを出す。 */
export const HIRAYA_DEV = process.env.NEXT_PUBLIC_VERYARE_HIRAYA === "1";

/** 平屋の選択肢を出すか（ロビーの先読みも、このときだけ行う）。 */
export const HIRAYA_ENABLED = HIRAYA_READY || HIRAYA_DEV;

/**
 * 動ける隠れ側の規則（ADR 0053。探索中も動けて塗れる・襖は近づくと開く）を、ロビーの選択肢に出して
 * よいか。既定（従来か、動けるか）は 10/25 に決める。それまでは false のまま、開発用の環境変数
 * NEXT_PUBLIC_VERYARE_ROAMING=1（make e2e の web も付ける）のときだけ出す。出さない間は、作成の設定に
 * roaming を載せないので、サーバーの既定（room.gleam の default_roaming）の規則になる。
 */
export const ROAMING_READY = false;

/** 開発用の指定（NEXT_PUBLIC_VERYARE_ROAMING=1）。動ける隠れ側の規則の選択肢を出す。 */
export const ROAMING_DEV = process.env.NEXT_PUBLIC_VERYARE_ROAMING === "1";

/** 動ける隠れ側の規則の選択肢を出すか。 */
export const ROAMING_ENABLED = ROAMING_READY || ROAMING_DEV;

/**
 * 増え鬼（ADR 0053 の最小版）を、ロビーの選択肢に出してよいか。動ける隠れ側と同じく、10/25 まで false の
 * まま、開発用の環境変数 NEXT_PUBLIC_VERYARE_SPREADING=1 のときだけ出す。
 */
export const SPREADING_READY = false;

/** 開発用の指定（NEXT_PUBLIC_VERYARE_SPREADING=1）。増え鬼の選択肢を出す。 */
export const SPREADING_DEV = process.env.NEXT_PUBLIC_VERYARE_SPREADING === "1";

/** 増え鬼の選択肢を出すか。 */
export const SPREADING_ENABLED = SPREADING_READY || SPREADING_DEV;

/**
 * 屋根と天井の切り替えボタンを出すか。来場者の画面には出さない（屋根は隠したまま）。開発用の
 * 指定があるときか、URL に ?roof=1 があるときだけ出す。search は location.search。
 */
export function roofToggleAllowed(dev: boolean, search: string): boolean {
	return dev || new URLSearchParams(search).get("roof") === "1";
}

/**
 * ステージの選択肢（サーバーの room.gleam の stage と揃える。0 = ランダム間取り、1 = 平屋）。
 * サーバーは、ほかに 2 = おまかせ（4 分の 1 で広い屋敷 / issue-65）と、3 = 広い屋敷だけ（ボット・E2E・
 * 開発用。ロビーには出さない）を受け付ける。おまかせは、広い屋敷を本番に出す準備ができるまで（サーバーの
 * wide_ready）10 種だけを選ぶので、ロビーには、まだ出さない。
 */
const STAGE_OPTION: RoomOption = {
	key: "stage",
	label: "ステージ",
	choices: [0, 1],
	default: 0,
	choiceLabels: { 0: "ランダム間取り", 1: "平屋" },
};

/**
 * いまの選び方では、ロビーに出さない選択肢の key。平屋（stage 1）では、隠れ側 CPU と鬼 CPU の強さを
 * 出さない（サーバーの room.gleam は、平屋と CPU の組み合わせを断る）。出さない選択肢は、既定値
 * （CPU なし）で送る（platform/lobby/roomOptions の settingsToSend）。
 */
export function veryareHiddenOptions(
	settings: Readonly<Record<string, number>>,
): readonly string[] {
	return settings.stage === 1 ? ["cpu", "cpuStrength"] : [];
}

/**
 * 隠れ側の動きの選択肢（ADR 0053。サーバーの room.gleam の roaming と揃える。0 = 従来、1 = 動ける）。
 * 既定は契約の VERYARE_ROAMING.defaultRoaming（サーバーの default_roaming と、共有の見本で一致を確かめる）。
 */
const ROAMING_OPTION: RoomOption = {
	key: "roaming",
	label: "隠れ側の動き",
	choices: [0, 1],
	default: VERYARE_ROAMING.defaultRoaming,
	choiceLabels: { 0: "従来（探索中は動けない）", 1: "探索中も動ける" },
};

/** ルールの選択肢（ADR 0053。サーバーの room.gleam の spreading と揃える。0 = ベーシック、1 = 増え鬼）。 */
const SPREADING_OPTION: RoomOption = {
	key: "spreading",
	label: "ルール",
	choices: [0, 1],
	default: VERYARE_SPREADING.defaultSpreading,
	choiceLabels: { 0: "ベーシック", 1: "増え鬼" },
};

/**
 * 新しい規則の選択肢（隠れ側の動きとルール / ADR 0053）。ロビーの入口（URL の ?rules=1 / platform/lobby の
 * rulesEntry）が、旗に関わらず足す。
 */
export function veryareRuleOptions(): RoomOption[] {
	return [ROAMING_OPTION, SPREADING_OPTION];
}

/**
 * ルーム作成の選択肢。hiraya なら、先頭にステージ（ランダム間取り / 平屋）を足す。roaming なら、隠れ側の
 * 動き、spreading なら、ルール（増え鬼）を、この順で最後に足す（ADR 0053）。
 */
export function veryareRoomOptions(
	hiraya: boolean,
	roaming = false,
	spreading = false,
): RoomOption[] {
	return [
		...(hiraya ? [STAGE_OPTION] : []),
		...BASE_OPTIONS,
		...(roaming ? [ROAMING_OPTION] : []),
		...(spreading ? [SPREADING_OPTION] : []),
	];
}

/**
 * 観戦ルームの作成の設定（issue-67。運営の画面 ?operator=1 のロビーだけで出す）。隠れ CPU の数（観戦ルーム
 * では hiderCpus。対戦のルームの cpu とは意味が違う）と、探索の時間。既定は、make simulate の観戦ルームの表で
 * 決めた値（サーバーの room.gleam の spectate_default_exploration_seconds と揃える）。ステージは、ランダム
 * 間取りだけ（選ばせない）。
 */
export const VERYARE_SPECTATE_OPTIONS: readonly RoomOption[] = [
	{
		key: "hiderCpus",
		label: "隠れ CPU",
		choices: [1, 2, 3, 4],
		default: 3,
		choiceLabels: { 1: "1体", 2: "2体", 3: "3体", 4: "4体" },
	},
	{
		key: "explorationSeconds",
		label: "探索時間",
		choices: [40, 60, 80, 100, 120],
		default: 100,
	},
];

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
 * ゲーム画面を、画面いっぱいの 1 枚にするか（上部バー・状態の行・3D の画面。スマホの縦画面で、
 * スクロールなしで収める）。共通の入れ物（platform/host/PlayHost.tsx）が、games/registry の
 * isFullscreenGame を通して読む。契約の型（GameManifest）には足さない。
 */
export const VERYARE_FULLSCREEN = true;

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
	title: "すごくアレ",
	kind: "realtime",
	minPlayers: 2,
	maxPlayers: 5,
	description: "隠れて、ばれずに、逃げ切ろう",
	// ロゴ（issue-69）。画像が読めないときは、背景の色と頭文字の仮のタイル。
	logo: { src: "/games/veryare/logo.webp", background: "#26315c" },
	// 起動画面（サーバーを探す / 作る）は veryare 自身が持つ（issue-29）。
	launchScreen: "custom",
	roomOptions: veryareRoomOptions(
		HIRAYA_ENABLED,
		ROAMING_ENABLED,
		SPREADING_ENABLED,
	),
};
