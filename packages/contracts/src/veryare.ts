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
 * 隠れ側のペイント。いまは全面1色（隠れ CPU が使う）だけ。
 * 人間のペイント（5本の円柱へのストローク / ADR 0037）は issue-25 で種類を足す。
 */
export type VeryarePaint = {
	readonly kind: "uniform";
	/** "#rrggbb"。 */
	readonly color: string;
};

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

/** 襖。廊下のマスと、部屋のマスの境にある。 */
export interface VeryareDoor {
	readonly corridor: VeryareCell;
	readonly slot: VeryareCell;
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
	/** 開いている襖（開けっぱなし / ADR 0033）。 */
	readonly openDoors: readonly VeryareDoor[];
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
