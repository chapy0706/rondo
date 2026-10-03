/**
 * veryare のゲーム内通知のうち、ゲームの外とも形を取り決めるもの（ADR 0009）。
 *
 * 探索フェーズの開始時に、まだ隠れている隠れ側全員の状態を、全員へ同じ内容で一括配信する
 * （ADR 0025 / 0035）。サーバーは game-state の payload としてこの形を送る。
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
