/**
 * rondo のホーム画面のアイコン（issue-69）。既存の RondoMark（アクセントの黄の輪）を、ink の背景の
 * 中央に置く。Next の画像の生成（next/og の ImageResponse）で PNG を作るので、画像のファイルは置かない。
 *
 * - app/icon.svg: ブラウザのタブ（同じ形の SVG）
 * - app/apple-icon.tsx: iPhone のホーム画面（180 × 180）
 * - app/pwa-icon/[size]/route.tsx: Web App Manifest のアイコン（192・512）
 */

/** ink（地）とアクセント（globals.css の --color-ink・--color-accent）。 */
export const RONDO_ICON_COLORS = {
	background: "#13111f",
	ring: "#f5b841",
} as const;

/** Web App Manifest に載せるアイコンの大きさ。 */
export const PWA_ICON_SIZES = [192, 512] as const;

/** RondoMark の枠（40）を、アイコンのこの割合の大きさで中央に置く（丸い切り抜きでも欠けない）。 */
const MARK_SCALE = 0.6;

/** 文字列が、Web App Manifest のアイコンの大きさか。 */
export function isPwaIconSize(value: string): boolean {
	return (PWA_ICON_SIZES as readonly number[]).includes(Number(value));
}

/**
 * 輪の大きさ（px）。RondoMark は 40 の枠に半径 14・太さ 7 の輪なので、外の直径は 35。
 * diameter は外の直径、border は太さ。
 */
export function ringGeometry(size: number): {
	readonly diameter: number;
	readonly border: number;
} {
	const unit = (size * MARK_SCALE) / 40;
	return { diameter: Math.round(35 * unit), border: Math.round(7 * unit) };
}

/** ImageResponse に渡す、アイコンの見た目（一辺 size px）。 */
export function rondoIconElement(size: number) {
	const { diameter, border } = ringGeometry(size);
	return (
		<div
			style={{
				width: size,
				height: size,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: RONDO_ICON_COLORS.background,
			}}
		>
			<div
				style={{
					width: diameter,
					height: diameter,
					borderRadius: "50%",
					border: `${border}px solid ${RONDO_ICON_COLORS.ring}`,
				}}
			/>
		</div>
	);
}
