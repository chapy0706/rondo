/**
 * `make bots` が動かすサーバーの時間（issue-49 / issue-27）。シナリオの待ち時間が、縮めた
 * フェーズの中に収まるかを、サーバーなしで確かめるために使う（scenarios.test.ts）。
 *
 * 値はサーバーの既定と、tools/bots.sh の短縮（RONDO_BOTS_PHASE_DIVISOR の既定 20）に合わせる。
 * どちらかを変えたら、ここも変える。
 */

/** tools/bots.sh が渡す、フェーズ時間を割る数。 */
export const BOTS_PHASE_DIVISOR = 20;

/** サーバーの既定（server/src/rondo_server/games/veryare/game.gleam と room.gleam）。 */
export const SERVER_DEFAULTS = {
	/** 探索フェーズ（作成時の設定を省いたときの 40 秒）。 */
	explorationMs: 40_000,
	/** 撃つ間隔（issue-27）。 */
	reloadMs: 3_000,
} as const;

/** 縮めた時間（サーバーの timing.apply と同じく、割って切り捨て、1 より小さくしない）。 */
export function scaled(ms: number, divisor = BOTS_PHASE_DIVISOR): number {
	return Math.max(1, Math.floor(ms / divisor));
}
