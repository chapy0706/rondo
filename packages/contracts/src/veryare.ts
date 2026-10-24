/**
 * veryare のゲーム内通知のうち、ゲームの外とも形を取り決めるもの（ADR 0009）。
 *
 * 探索フェーズの開始時に、まだ隠れている隠れ側全員の状態を、全員へ同じ内容で一括配信する
 * （ADR 0025 / 0035）。探索中は、鬼の状態を全員へ送り続ける（いまは鬼 CPU だけ / issue-34。
 * 人間の鬼も issue-28 で同じ形で送る）。サーバーは game-state の payload としてこれらを送る。
 */

import type { PlayerId } from "./messages";

/** 隠れ CPU と鬼のポーズ（サーバーが選ぶ3種類 / issue-33）。 */
export const VERYARE_CPU_POSES = ["standing", "crouching", "lying"] as const;
export type VeryareCpuPose = (typeof VERYARE_CPU_POSES)[number];

/**
 * 人間の隠れ側が選ぶ、素材のポーズの識別子（issue-56）。英数字だけ。表示名と素材の対応は、共有の
 * 見本（fixtures/veryare-poses.json）に置き、サーバーの pose.gleam と一致することを両方のテストで
 * 確かめる。
 */
export const VERYARE_MODEL_POSES = [
	"idle",
	"femaleStanding1",
	"femaleStanding2",
	"femaleStanding3",
	"femaleStanding4",
	"femaleStanding5",
	"maleStanding1",
	"maleStanding2",
	"walking",
	"mediumRun",
	"femaleDance",
	"femaleDynamic1",
	"femaleDynamic2",
	"femaleDynamic3",
	"maleCrouch",
	"femaleSitting1",
	"femaleSitting2",
	"maleSitting1",
	"maleSitting2",
	"maleSitting3",
	"maleSitting4",
	"maleLaying1",
	"maleLaying2",
] as const;
export type VeryareModelPose = (typeof VERYARE_MODEL_POSES)[number];

/** 隠れ側のポーズ（CPU・鬼の3種類と、人間が選ぶ素材のポーズ）。 */
export type VeryarePose = VeryareCpuPose | VeryareModelPose;

/**
 * 隠れ側のペイント。全面1色（隠れ CPU が使う）と、人間が描いたストローク（issue-25）。
 */
export type VeryarePaint = VeryareUniformPaint | VeryareStrokesPaint;

export interface VeryareUniformPaint {
	readonly kind: "uniform";
	/** "#rrggbb"。 */
	readonly color: string;
}

/**
 * 人間のペイント（ADR 0037 / issue-25・issue-54）。描き込み面は部位ごとの円柱で、面の上の位置は
 * 円柱を回る角度 u（0〜1）と軸の向きの位置 v（0〜1。胴は 0 が足もと、1 が頭）。胴だけのペイント
 * （issue-25 の形）も、そのまま読める。
 */
export interface VeryareStrokesPaint {
	readonly kind: "strokes";
	readonly strokes: readonly VeryareStroke[];
}

/**
 * 描き込み面の部位（5本円柱 / ADR 0037・issue-54）。胴は頭を含む。u・v は部位ごとの円柱の上の位置
 * （u は円柱を回る角度、v は軸の向きの位置。どちらも 0〜1）。
 */
export const VERYARE_PAINT_PARTS = [
	"torso",
	"left-arm",
	"right-arm",
	"left-leg",
	"right-leg",
] as const;
export type VeryarePaintPart = (typeof VERYARE_PAINT_PARTS)[number];

export interface VeryareStroke {
	readonly part: VeryarePaintPart;
	/** "#rrggbb"（小文字）。 */
	readonly color: string;
	/** ブラシの半径（u・v の単位）。VERYARE_PAINT_LIMITS の minSize〜maxSize。 */
	readonly size: number;
	/** 1点以上。u・v は 0〜1 で、クライアントが小数第3位に丸めて送る。 */
	readonly points: readonly VeryareStrokePoint[];
}

export interface VeryareStrokePoint {
	readonly u: number;
	readonly v: number;
}

/**
 * ペイントの確定（ペイントフェーズの終わりに、隠れ側が一度だけ送る / ADR 0025）。選んだポーズ
 * （issue-56）も同じ電文で送る。塗っていなければ paint は null、ポーズを変えていなければ pose は
 * null（省略も null と同じ）。両方 null の電文は、サーバーが捨てる。一覧に無い pose は null として扱う。
 *
 * 動ける隠れ側の規則（ADR 0053）では、同じ電文を、見た目の更新として、ペイントと探索の間に何度でも
 * 送れる（同じ人は VERYARE_ROAMING.lookIntervalMs あける。短い間の更新はサーバーが捨てる）。null の
 * 項目は前のまま残る。探索の間に受け付けた更新は、見た目の通知（VeryareLookNotice）で全員に届く。
 */
export interface VeryarePaintEvent {
	readonly type: "paint";
	readonly paint: VeryareStrokesPaint | null;
	readonly pose?: VeryareModelPose | null;
}

/**
 * ペイントの上限（電文の大きさを抑える / issue-25）。クライアントとサーバーで同じ値を使い、
 * 共有の見本（fixtures/veryare-paint.json の limits）で一致を確かめる。上限を超えたペイントは、
 * サーバーが丸ごと捨てる。
 */
export const VERYARE_PAINT_LIMITS = {
	/** ストロークの本数の上限。 */
	maxStrokes: 100,
	/** 点の数の上限（全ストロークの合計）。 */
	maxPoints: 1000,
	/** u・v を丸める小数の桁数。 */
	decimals: 3,
	/** ブラシの半径の下限と上限（u・v の単位）。 */
	minSize: 0.01,
	maxSize: 0.15,
} as const;

/** 隠れ側1人の状態。座標は床の上（x, z）、向きはラジアン。 */
export interface VeryareHiderState {
	readonly playerId: PlayerId;
	readonly x: number;
	readonly z: number;
	/** 向き。まだ持たないとき（人間の隠れ側 / issue-25 まで）は null。 */
	readonly facing: number | null;
	readonly pose: VeryarePose | null;
	readonly paint: VeryarePaint | null;
}

/** 探索開始時の一括配信。 */
export interface VeryareHidersNotice {
	readonly type: "hiders";
	readonly hiders: readonly VeryareHiderState[];
}

/** 骨格のマス（1m 四方）。x は幅方向、z は奥（0）から手前（玄関側）。 */
export interface VeryareCell {
	readonly x: number;
	readonly z: number;
}

/** 探索中の鬼の状態。鬼 CPU は 0.5秒ごとに送る。 */
export interface VeryareOniNotice {
	readonly type: "oni";
	readonly playerId: PlayerId;
	readonly x: number;
	readonly z: number;
	/** 向き（ラジアン。x 軸から z 軸の向きへ回る）。 */
	readonly facing: number;
	readonly pose: VeryarePose;
	/**
	 * 開いている襖（開けっぱなし / ADR 0033）。ゲームの襖の状態そのもの（人間・鬼 CPU が開けた
	 * 襖をまとめたもの / issue-29b）。境 {a, b} で指す（ADR 0042）。
	 */
	readonly openDoors: readonly VeryareEdge[];
	/**
	 * 増え鬼（ADR 0053）のルームだけ載る。途中から鬼になった人（見つかった順）の位置と向き（丸めは
	 * VeryareRoamingHider と同じ）。複数の鬼を、この 1 通にまとめる。従来の規則のルームでは載らない。
	 * 人が鬼になったとき、その場で送る。途中から鬼になった人が動いたら、変わったときだけ 120 ms の
	 * 間隔で送る。
	 */
	readonly others?: readonly VeryareRoamingHider[];
}

/**
 * まだ隠れている隠れ側の一覧（参加順）。一覧が変わるたび（発見・被りの失格・離脱）に送る。
 * 一覧から外れた隠れ側は観戦になる（issue-28）。
 */
export interface VeryareHidingNotice {
	readonly type: "hiding";
	readonly playerIds: readonly PlayerId[];
}

/**
 * 鬼の射撃の申告（issue-27 / ADR 0022）。鬼のクライアントが game-event の payload として送る。
 * target は照準に重なった隠れ側。何にも重なっていなければ null（外れとして、撃つ間隔は始まる）。
 * 当たったかどうかはサーバーが判定する（探索フェーズ・鬼・まだ隠れている・射程 8 m・撃つ間隔
 * 3 秒）。命中は、まだ隠れている一覧（VeryareHidingNotice）の更新で全員に伝わる。
 */
export interface VeryareShootEvent {
	readonly type: "shoot";
	readonly target: PlayerId | null;
}

/** 戸の種類（issue-29a / ADR 0042）。襖は開閉でき、ほかの2つは変わらない。 */
export type VeryareDoorKind = "fusuma" | "always-open" | "always-closed";

/** 隣り合う2マスの境（向きは問わない）。襖・戸を指すのに使う（ADR 0042）。 */
export interface VeryareEdge {
	readonly a: VeryareCell;
	readonly b: VeryareCell;
}

/** ステージの戸。境と種類。 */
export interface VeryareStageDoor extends VeryareEdge {
	readonly kind: VeryareDoorKind;
}

/**
 * ステージの通知（issue-29a / ADR 0042）。選ばれたステージの地図のデータそのもの。
 * ルームの開始で全員へ、途中参加・再接続の人には本人へ送る。クライアントはステージの
 * データの写しを持たず、この地図で表示し、サーバーと同じ移動の規則で動く。
 *
 * マス (x, z) は、原点（列 0・行 0 のマスの角）から cellSize ごとに数える。
 * rows[z] の x 文字目が、そのマスの文字。文字の意味は regions で引き、regions に無い
 * 文字（壁・庭・空きのスロットなど）のマスは歩けない。同じ領域どうしの境は通れ、
 * 異なる領域どうしの境は、doors に戸があるときだけ、その種類と開閉で通れる。
 */
export interface VeryareStageNotice {
	readonly type: "stage";
	/** 1マスの大きさ（メートル）。 */
	readonly cellSize: number;
	/** 列 0・行 0 のマスの角の座標（メートル）。 */
	readonly origin: { readonly x: number; readonly z: number };
	readonly width: number;
	readonly depth: number;
	/** z の順に depth 行。各行は x の順に width 文字。 */
	readonly rows: readonly string[];
	/** マスの文字 → 領域の名前。歩けるマスの文字だけを載せる。 */
	readonly regions: Readonly<Record<string, string>>;
	/** 部屋のスロットの文字 → 部屋タイプ（見た目の色分けに使う）。 */
	readonly rooms: Readonly<Record<string, string>>;
	readonly doors: readonly VeryareStageDoor[];
	/** 玄関（鬼と隠れ側のリスポーン位置 / ADR 0032）。 */
	readonly spawn: { readonly x: number; readonly z: number };
}

/**
 * 襖の通知（issue-29b / ADR 0042）。開いている襖の一覧。準備移動の開始で全部開き、探索の
 * 開始で全部閉じ、答え合わせの開始で全部開く。開ける報告が通ったときにも送る。
 * 途中参加・再接続の人には、本人へ今の状態を送る。
 */
export interface VeryareDoorsNotice {
	readonly type: "doors";
	readonly open: readonly VeryareEdge[];
}

/**
 * 襖を開ける報告（issue-29b）。game-event の payload として送る。開けられるかはサーバーが
 * 決める（準備移動・ペイント・探索の間、ステージにいる人が、襖の境から 1.5 m 以内）。
 * 開いたかどうかは、襖の通知で分かる。
 */
export interface VeryareOpenDoorEvent {
	readonly type: "open-door";
	readonly door: VeryareEdge;
}

/**
 * 鬼の視界の報告（issue-32 / ADR 0036）。探索フェーズの間、人間の鬼のクライアントが 0.5 秒ごとに、
 * カメラの視界に遮るものなく入っている隠れ側（壁越しを除く）を、game-event の payload として送る。
 * 圏内（距離）の判定と、見逃しポイントの加算はサーバーが行う（性善説 / ADR 0035）。
 */
export interface VeryareSightEvent {
	readonly type: "sight";
	readonly playerIds: readonly PlayerId[];
}

/**
 * いいね（issue-32 / ADR 0036）。答え合わせの間、隠れていた隠れ側へ送る。game-event の payload。
 * 1人が同じ隠れ側に送れるのは1回まで、自分自身には送れない（サーバーが決める）。
 */
export interface VeryareLikeEvent {
	readonly type: "like";
	readonly target: PlayerId;
}

/**
 * いいねの数の通知（issue-32）。答え合わせの間、数が変わるたびに全員へ送る。探索の開始の時点で
 * 隠れていた隠れ側ごとに、受け取った数（0 を含む）。途中参加・再接続の人には、本人宛てで送る。
 */
export interface VeryareLikesNotice {
	readonly type: "likes";
	readonly likes: readonly {
		readonly playerId: PlayerId;
		readonly count: number;
	}[];
}

/**
 * 待機ルームのメンバー1人（issue-59 / ADR 0044）。位置はサーバーが円に丸めた後の値（小数第 2 位）、
 * 向きは 0.05 rad 単位に丸めた値。向きをまだ報告していなければ null。pose は待機ポーズ（ゲームの
 * 隠れ側のポーズとは別）で、選んでいなければ null。名前は載せない（参加者の一覧から引く）。
 */
export interface VeryareWaitingMember {
	readonly playerId: PlayerId;
	readonly x: number;
	readonly z: number;
	readonly facing: number | null;
	readonly pose: VeryareModelPose | null;
}

/**
 * 待機ルームのメンバーの通知（issue-59 / ADR 0044）。鬼選出の間だけ、待機ルームにいる人間の参加者
 * 全員をまとめて、全員へ送る（CPU は載せない）。変わったときだけ、150 ms の間隔で送る。途中参加・
 * 再接続の人には、本人宛てで今の様子を送る。ステージに移ったら送らない。ステージの位置は載らない。
 */
export interface VeryareMembersNotice {
	readonly type: "members";
	readonly members: readonly VeryareWaitingMember[];
}

/**
 * 待機ポーズの変更（issue-59）。game-event の payload として送る。サーバーは、鬼選出の間だけ、
 * VERYARE_MODEL_POSES の識別子だけを受け付け、同じ人の変更は 0.3 秒あける。変わった待機ポーズは、
 * メンバーの通知で全員に届く。
 */
export interface VeryareWaitingPoseEvent {
	readonly type: "waiting-pose";
	readonly pose: VeryareModelPose;
}

/**
 * 観戦用の通知の、体の動き（issue-67）。隠れ CPU と鬼のポーズの 3 種類と、準備移動で歩いている間の
 * walking。walking は止まった姿勢ではなく、歩く動きとして描く（素材のポーズの walking とは別）。
 */
export type VeryareSpectatePose = VeryareCpuPose | "walking";

/**
 * 観戦用の通知の 1 人（issue-67）。ステージに出ている人だけ。位置と向きは、小数第 2 位までに丸めた値。
 */
export interface VeryareSpectateActor {
	readonly playerId: PlayerId;
	readonly x: number;
	readonly z: number;
	/** 向き（ラジアン。x 軸から z 軸の向きへ回る）。 */
	readonly facing: number;
	readonly pose: VeryareSpectatePose;
}

/** 隠れ CPU の見た目（issue-67）。色は全面 1 色、pose は隠れるときのポーズ。 */
export interface VeryareSpectateLook {
	readonly playerId: PlayerId;
	readonly pose: VeryareCpuPose;
	readonly paint: VeryareUniformPaint;
}

/**
 * 観戦用の通知（issue-67）。観戦ルームの観戦者にだけ、サーバーが送る（人間が参加するルームでは送らない）。
 * 100 ms ごとに確かめ、全員の位置・向き・ポーズが変わったときだけ送る。actors は、隠れ CPU（参加順）と、
 * 探索の開始からは鬼 CPU（最後）。looks は、試合の最初の 1 通と、入室・復帰の 1 通にだけ載る。
 */
export interface VeryareSpectateNotice {
	readonly type: "spectate";
	readonly actors: readonly VeryareSpectateActor[];
	readonly looks?: readonly VeryareSpectateLook[];
}

/**
 * 動ける隠れ側の規則（ADR 0053）。ルーム作成の設定 roaming（0 = 従来、1 = 動ける）で選ぶ。動ける規則では、
 * まだ隠れている人間の隠れ側が、ペイントと探索の間も動け、見た目を変えられる。探索の間は、鬼と隠れ側が
 * 襖の境から autoDoorReach 以内に近づくと、サーバーがその襖を開ける（開けっぱなし。開ける報告は使わない）。
 * ルーム情報（room-info）に roaming: true が載る。サーバーの値（room.gleam・game.gleam）と、共有の見本
 * （fixtures/veryare-roaming.json）で一致を確かめる。
 */
export const VERYARE_ROAMING = {
	/** 作成の設定 roaming を省略したときの規則（0 = 従来、1 = 動ける）。ロビーの既定も、この値。 */
	defaultRoaming: 0,
	/** 同じ人の見た目の更新をあける間（ミリ秒）。 */
	lookIntervalMs: 1000,
	/** 襖が開く距離（メートル。襖の境から）。 */
	autoDoorReach: 0.8,
} as const;

/**
 * 増え鬼（ADR 0053 の最小版）。ルーム作成の設定 spreading（0 = 従来、1 = 増え鬼）で選ぶ。増え鬼では、
 * 見つかった人間の隠れ側が、見つかった場所で鬼になる（すぐ動け、撃てる）。隠れ CPU は鬼にならない。
 * 隠れ側が 0 人で鬼の勝ち、時間切れで 1 人以上残れば隠れ側の勝ち。ルーム情報に spreading: true が載る。
 */
export const VERYARE_SPREADING = {
	/** 作成の設定 spreading を省略したときの規則（0 = 従来、1 = 増え鬼）。ロビーの既定も、この値。 */
	defaultSpreading: 0,
} as const;

/** 動く隠れ側 1 人。位置は小数第 2 位、向きは 0.05 rad 単位に丸めた値。向きを報告していなければ null。 */
export interface VeryareRoamingHider {
	readonly playerId: PlayerId;
	readonly x: number;
	readonly z: number;
	readonly facing: number | null;
}

/**
 * 動く隠れ側の通知（ADR 0053）。動ける規則のルームの探索の間だけ、まだ隠れている人間の隠れ側（参加順。
 * 隠れ CPU は載せない）を 1 通にまとめ、全員へ送る。変わったときだけ、120 ms の間隔で送る。探索・答え
 * 合わせの間に入り直した人には、本人宛てで送る。従来の規則のルームでは送らない。
 */
export interface VeryareRoamingNotice {
	readonly type: "roaming";
	readonly hiders: readonly VeryareRoamingHider[];
}

/**
 * 見た目の通知（ADR 0053）。動ける規則のルームの探索の間に、隠れ側の見た目の更新を受け付けたとき、その人の
 * いまの見た目（ポーズとペイント。無ければ null）を全員へ送る。ペイントの間の更新は送らない（探索の開始の
 * 一括配信 VeryareHidersNotice に載る）。
 */
export interface VeryareLookNotice {
	readonly type: "look";
	readonly playerId: PlayerId;
	readonly pose: VeryareModelPose | null;
	readonly paint: VeryareStrokesPaint | null;
}
