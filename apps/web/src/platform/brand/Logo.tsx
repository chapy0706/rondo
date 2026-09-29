/**
 * rondo のロゴ（issue-05 / ADR 0029）。
 *
 * フォントに頼らず、同じ太さの線と円で組んだ SVG で描く。最初の「o」をアクセント色の
 * 輪にして、人が集まって輪になる（rondo = 輪舞）ことを表す。この輪は単独のマーク
 * （RondoMark）としても使う。色はテーマのトークン（globals.css）から取る。
 */

const STROKE = 7;

/** 名称「rondo」のワードマーク。文字は currentColor、輪はアクセント色。 */
export function RondoWordmark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 168 60"
			role="img"
			aria-label="rondo"
			className={className}
			fill="none"
			strokeWidth={STROKE}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<g stroke="currentColor">
				{/* r */}
				<path d="M6 52 V36 A12 12 0 0 1 18 24 H22" />
				{/* n */}
				<path d="M64 24 V52 M64 36 A12 12 0 0 1 88 36 V52" />
				{/* d */}
				<circle cx="110" cy="38" r="14" />
				<path d="M124 8 V52" />
				{/* o */}
				<circle cx="146" cy="38" r="14" />
			</g>
			{/* 最初の o = rondo の輪 */}
			<circle cx="40" cy="38" r="14" stroke="var(--color-accent)" />
		</svg>
	);
}

/** 輪だけのマーク。ローディングなど、名称を出さない場面で使う。 */
export function RondoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 40 40"
			aria-hidden="true"
			className={className}
			fill="none"
			strokeWidth={STROKE}
		>
			<circle cx="20" cy="20" r="14" stroke="var(--color-accent)" />
		</svg>
	);
}
