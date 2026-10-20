/**
 * 画面いっぱいのゲーム画面（GameFrame.tsx）の、横向きの案内を出すか（純粋関数）。
 */

/** 横向きの案内（上の端の細い帯）を出すか。タッチの端末の横向きで、「×」で閉じていないときだけ。 */
export function rotateHintVisible(state: {
	readonly landscape: boolean;
	/** 主な入力がタッチか（(pointer: coarse)）。パソコンの横長の画面には出さない。 */
	readonly coarse: boolean;
	readonly dismissed: boolean;
}): boolean {
	return state.landscape && state.coarse && !state.dismissed;
}
