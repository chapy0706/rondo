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
 * - settings: ルーム作成時の設定（create-room の settings。例: 平屋は { stage: 1 } / issue-44）。
 *   無ければ送らない（サーバーの既定）
 * - roomName: ルーム作成時の名前（create-room の roomName / issue-58）。あれば、作成の返事と、
 *   一覧（list-rooms）に、整えた名前が載ることを確かめる。無ければ送らない（既定の名前）
 * - waitingSync: 待機ルームの同期（issue-59）の確かめをするか。鬼選出の後に、どのボットにも待機の
 *   通知（members）が届かないことを確かめる
 * - expiry: 結果のあと、ルームが閉じるまで待つか（issue-70）。game-ended に、閉じるまでの残り
 *   （縮めた 3 分）が載り、その時間のあとに、受け手の全員へ error の room-expired が届くことを確かめる
 */

import type { VeryareModelPose } from "@rondo/contracts";

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
	/**
	 * 隠れ側として、玄関から一直線にたどれる別々の場所の index 番目へ動く（issue-29a）。
	 * 場所はステージの通知から選ぶ（stage.ts の spreadSpots）。全員が玄関に現れるので、
	 * 被りで失格しないよう、隠れ側ごとに違う index を使う。
	 */
	| { readonly type: "hide"; readonly index: number }
	/**
	 * 壁越し・襖越しの射撃のために選んだマス（plan.ts の pickDoorShot。c・s・r・w）へ、
	 * 通れる境をたどって1マスずつ歩く（issue-29b）。doors は、道を探すときの襖の扱い
	 * （準備移動の間は "open"、探索の間は "closed"）。
	 */
	| {
			readonly type: "go";
			readonly to: "c" | "s" | "r" | "w";
			readonly doors: "open" | "closed";
	  }
	/**
	 * 隠れ側として、ペイントを確定する（issue-25。契約の VeryarePaintEvent）。体の正面に、color の
	 * 点を1つ描いたストローク1本を送る。
	 */
	| { readonly type: "paint"; readonly color: string }
	/**
	 * 隠れ側として、塗らずにポーズだけを確定する（issue-56。契約の VeryarePaintEvent の paint を null、
	 * pose を指定）。
	 */
	| { readonly type: "pose"; readonly pose: VeryareModelPose }
	/**
	 * 確かめ（issue-56）: 探索の開始に届いた隠れ側の一括配信で、target のポーズが pose か（null は
	 * 確定しなかった・既定の立ち姿）。違えば、check の名前を添えて問題にする。
	 */
	| {
			readonly type: "expect-pose";
			readonly check: string;
			readonly target: string;
			readonly pose: string | null;
	  }
	/**
	 * 確かめ（issue-25）: 探索の開始に届いた隠れ側の一括配信で、target のペイントが、color の
	 * ストロークか。違えば、check の名前を添えて問題にする。
	 */
	| {
			readonly type: "expect-paint";
			readonly check: string;
			readonly target: string;
			readonly color: string;
	  }
	/** 選んだ襖（c と s の境）を開ける報告を送る（issue-29b。契約の VeryareOpenDoorEvent）。 */
	| { readonly type: "open-door" }
	/**
	 * 確かめ（issue-29b）: いま届いている、まだ隠れている一覧に、target がいるか（hiding が
	 * true）・いないか（false）。違えば、check の名前を添えて問題にする。
	 */
	| {
			readonly type: "expect-hiding";
			readonly check: string;
			readonly target: string;
			readonly hiding: boolean;
	  }
	/** 鬼として撃つ（issue-27。契約の VeryareShootEvent）。target はボットの名前、null は狙いなし。 */
	| { readonly type: "shoot"; readonly target: string | null }
	/**
	 * 確かめ（issue-44）: 届いたステージの通知の、1マスの大きさが cellSize、リスポーン位置が
	 * spawn か。違えば、check の名前を添えて問題にする。
	 */
	| {
			readonly type: "expect-stage";
			readonly check: string;
			readonly cellSize: number;
			readonly spawn: { readonly x: number; readonly z: number };
	  }
	/**
	 * 確かめ（issue-65）: 届いたステージの通知が広い屋敷（幅 20 m 以上）で、いちばん新しいルーム情報
	 * （room-info）の探索時間が explorationSeconds（ルームで選んだ時間 +80 秒）か。違えば、check の名前を
	 * 添えて問題にする。
	 */
	| {
			readonly type: "expect-wide";
			readonly check: string;
			readonly explorationSeconds: number;
	  }
	/**
	 * 確かめ（issue-44）: いちばん新しい襖の通知で、開いている襖の辺の数が open か。違えば、
	 * check の名前を添えて問題にする。襖の通知はフェーズの通知の後に届くので、delayMs を空ける。
	 */
	| {
			readonly type: "expect-doors";
			readonly check: string;
			readonly open: number;
	  }
	/** 待機ポーズを変える（issue-59。契約の VeryareWaitingPoseEvent）。 */
	| { readonly type: "waiting-pose"; readonly pose: VeryareModelPose }
	/**
	 * 確かめ（issue-59）: ルームの全ボットの、最新の待機ルームのメンバーの通知に、members の各ボットが
	 * 同じ位置・待機ポーズで載っているか。全員の最新が同じ内容か。違えば、check の名前を添えて問題にする。
	 */
	| {
			readonly type: "expect-members";
			readonly check: string;
			readonly members: readonly {
				readonly bot: string;
				readonly x: number;
				readonly z: number;
				readonly pose: VeryareModelPose | null;
			}[];
	  };

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
	readonly settings?: Readonly<Record<string, number>>;
	readonly roomName?: string;
	readonly waitingSync?: boolean;
	/** 結果のあと、ルームが閉じるまで待つ（issue-70）。 */
	readonly expiry?: boolean;
}

/** 隠れ側・鬼の details（サーバーの games/veryare/result.gleam の写し方）。 */
export const details = {
	hiderWon: { 役割: "隠れる側", 結果: "勝ち", 状態: "逃げ切り" },
	/** 隠れ側の勝ちで、自分は見つかっていた（チーム勝ち / issue-42）。 */
	hiderWonFound: { 役割: "隠れる側", 結果: "勝ち", 状態: "発見・失格・離脱" },
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
