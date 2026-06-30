/**
 * スコア・結果の共通型。
 *
 * ソロ・リアルタイム双方のゲームが、プレイの結果を基盤に返すために使う。
 * 結果発表（issue-14）と、リアルタイムの順位確定（ADR 0014）が参照する。
 */

import type { PlayerId } from "./messages";

/** 数値スコア。大小の意味は order が与える。 */
export type Score = number;

/** スコアの並び順の意味。基盤がランキングを組み立てる際に使う。 */
export type ScoreOrder = "higher-is-better" | "lower-is-better";

/**
 * 1プレイの結果。
 *
 * ソロゲームはこれを1つ基盤に返す。details は表示用の補助指標
 * （クリア時間、消したライン数など）で、ゲームごとに意味づけする。
 */
export interface PlayResult {
	readonly score: Score;
	readonly details?: Readonly<Record<string, number | string>>;
}

/** ランキング1行。リアルタイムの結果発表で1プレイヤー分を表す。 */
export interface RankingEntry {
	readonly playerId: PlayerId;
	readonly name: string;
	/** 1 始まりの順位。サーバー受信順を権威として確定する（ADR 0014）。 */
	readonly rank: number;
	readonly result: PlayResult;
}

/**
 * リアルタイムゲームの最終結果。
 *
 * 順位付きの一覧。ルームは1ゲームの終了で解散するため（ADR 0017）、
 * これがそのルームの最終結果になる。
 */
export interface RealtimeResult {
	readonly order: ScoreOrder;
	readonly rankings: readonly RankingEntry[];
}
