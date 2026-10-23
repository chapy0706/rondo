/**
 * 盤のマスの大きさを、見える領域から決める（ひとり用のゲームを、iPhone の縦画面にスクロールなしで
 * 収める）。純粋な関数。
 *
 * 1 マスの幅 = min(使える幅 ÷ 列の数, (使える高さ − 操作部品の高さ) ÷ (行の数 × マスの縦横比))。
 * マスどうしの隙間（gap）は、先に引いてから割る。端数は切り捨てる（はみ出さない）。
 * 使える幅と高さは、画面いっぱいの枠（GameFrame）の中身の大きさ（セーフエリアの内側）を渡す。
 */

export interface FitInput {
	/** 使える幅（px）。 */
	readonly width: number;
	/** 使える高さ（px）。 */
	readonly height: number;
	/** 盤のほかに、縦に要る高さ（得点の行・操作部品・隙間。px）。 */
	readonly reserved: number;
	readonly cols: number;
	readonly rows: number;
	/** マスの高さ ÷ 幅（既定 1 = 正方形）。 */
	readonly aspect?: number;
	/** マスどうしの隙間（px。既定 0）。 */
	readonly gap?: number;
	/** 1 マスの幅の上限（px）。大きな画面で、盤が大きくなりすぎないように。 */
	readonly max?: number;
}

/** 1 マスの幅（px。整数）。場所が足りなければ 0。 */
export function fitCell(input: FitInput): number {
	const aspect = input.aspect ?? 1;
	const gap = input.gap ?? 0;
	const byWidth = (input.width - (input.cols - 1) * gap) / input.cols;
	const byHeight =
		(input.height - input.reserved - (input.rows - 1) * gap) /
		(input.rows * aspect);
	const cell = Math.floor(
		Math.min(byWidth, byHeight, input.max ?? Number.POSITIVE_INFINITY),
	);
	return Number.isFinite(cell) && cell > 0 ? cell : 0;
}
