/**
 * シナリオの書き方（issue-49）。ボットの動きと、期待する結果を、宣言として並べる。
 *
 * - bots: 参加するボットの名前。先頭がルームを作り、残りは順に参加する
 * - steps: 「いつ（on）」「誰が（bot）」「何をする（action）」「どれだけ待って（delayMs）」の並び。いつは、全員が
 *   そろった直後（"joined"）か、そのボット自身にフェーズ（と鬼希望エリアの色）の通知が
 *   届いたとき。1つの手順は1回だけ動く
 * - receivers: game-ended が届くべきボット（ゲームの終わりに部屋にいる参加者）
 * - rankings: 期待する結果の行（順位・score・details）。名前はボットの名前
 * - targeted: 限定配信（ADR 0021）の確認をするか。宛先でないボットに game-state-to が
 *   届かないこと、少なくとも1通は観測できたことを確かめる
 */

/** ボットの動き。 */
export type Action =
	/** 鬼希望エリアの中央へ動く（立候補）。 */
	| { readonly type: "touch-area" }
	/** 指定の位置へ動く。 */
	| { readonly type: "move"; readonly x: number; readonly z: number }
	/** ルームから退出する（leave-room。猶予を待たずに離脱が確定する）。 */
	| { readonly type: "leave" }
	/** その場にとどまる（何も送らない。宣言として書くため）。 */
	| { readonly type: "stay" }
	/** 鬼として撃つ（issue-27。契約の VeryareShootEvent）。target はボットの名前、null は狙いなし。 */
	| { readonly type: "shoot"; readonly target: string | null };

/** 手順を動かす時点。 */
export type Trigger =
	| "joined"
	| {
			readonly phase: string;
			readonly area?: "waiting" | "ready" | "counting";
	  };

export interface Step {
	readonly on: Trigger;
	readonly bot: string;
	readonly action: Action;
	/** 引き金から動くまでの待ち（ミリ秒）。撃つ間隔を空けるときなどに使う。既定は 0。 */
	readonly delayMs?: number;
}

export interface ExpectedRow {
	readonly bot: string;
	readonly rank: number;
	readonly score: number;
	readonly details: Readonly<Record<string, string>>;
}

export interface Scenario {
	readonly name: string;
	readonly bots: readonly string[];
	readonly steps: readonly Step[];
	readonly receivers: readonly string[];
	readonly rankings: readonly ExpectedRow[];
	readonly targeted?: boolean;
}

/** 隠れ側・鬼の details（サーバーの games/veryare/result.gleam の写し方）。 */
export const details = {
	hiderWon: { 役割: "隠れる側", 結果: "勝ち", 状態: "逃げ切り" },
	hiderLost: { 役割: "隠れる側", 結果: "負け", 状態: "発見・失格・離脱" },
	oniWon: { 役割: "鬼", 結果: "勝ち" },
	oniLost: { 役割: "鬼", 結果: "負け" },
	void: { 結果: "不成立" },
} as const;

/** フェーズの通知（game-state の payload）が、引き金に合うか。 */
export function matchesTrigger(
	trigger: Exclude<Trigger, "joined">,
	payload: unknown,
): boolean {
	if (typeof payload !== "object" || payload === null) return false;
	const { type, phase, area } = payload as Record<string, unknown>;
	if (type !== "phase" || phase !== trigger.phase) return false;
	return trigger.area === undefined || area === trigger.area;
}
