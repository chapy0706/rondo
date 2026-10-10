/**
 * veryare のゲーム内通知のうち、ゲームの外とも形を取り決めるもの（ADR 0009）。
 *
 * 探索フェーズの開始時に、まだ隠れている隠れ側全員の状態を、全員へ同じ内容で一括配信する
 * （ADR 0025 / 0035）。探索中は、鬼の状態を全員へ送り続ける（いまは鬼 CPU だけ / issue-34。
 * 人間の鬼も issue-28 で同じ形で送る）。サーバーは game-state の payload としてこれらを送る。
 */

import type { PlayerId } from "./messages";

/** 隠れ側のポーズ（仮の3種類 / issue-33）。見た目と選ぶ画面は後の issue で作る。 */
export type VeryarePose = "standing" | "crouching" | "lying";

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
 * 人間のペイント（ADR 0037 の簡略版 / issue-25）。描き込み面は円柱で、面の上の位置は
 * 円柱を回る角度 u（0〜1）と高さ v（0 が足もと、1 が頭）。いまの部位は胴（体全体）だけ。
 */
export interface VeryareStrokesPaint {
	readonly kind: "strokes";
	readonly strokes: readonly VeryareStroke[];
}

/** 描き込み面の部位。5本円柱（ADR 0037）で "left-arm" などを足す。 */
export type VeryarePaintPart = "torso";

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

/** ペイントの確定（ペイントフェーズの終わりに、隠れ側が一度だけ送る / ADR 0025）。 */
export interface VeryarePaintEvent {
	readonly type: "paint";
	readonly paint: VeryareStrokesPaint;
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
