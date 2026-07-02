/**
 * 入力ポート。
 *
 * ゲーム本体は方向入力 (x, y) という契約だけを受け取り、それが VirtualPad から
 * 来るか Accelerometer から来るかを知らない（ADR 0018）。入力元を差し替えても
 * ゲーム本体に手を入れずに済む。
 */

/** 方向入力。各軸は [-1, 1] に正規化される。中立は 0。y は下方向を正とする。 */
export interface Direction {
	readonly x: number;
	readonly y: number;
}

/** 中立（入力なし）の方向。 */
export const NEUTRAL: Direction = { x: 0, y: 0 };

/** 方向入力を供給するポート。入力元の実体（仮想パッド等）を隠す。 */
export interface InputPort {
	/** 現在の方向入力を返す。 */
	read(): Direction;
	/** 方向入力の変化を購読する。購読解除の関数を返す。 */
	subscribe(listener: (direction: Direction) => void): () => void;
}
