/**
 * 牌の見た目（issue-37）。画像を使わず、文字で麻雀牌風に描く。
 * 種類 0 〜 11 に、文字と色を割り当てる（東南西北・中發白・一〜五萬）。
 */

export interface TileFace {
	/** 上の段の文字。 */
	readonly top: string;
	/** 下の段の文字（萬子の「萬」など）。無ければ1文字の牌。 */
	readonly bottom?: string;
	/** 文字の色（Tailwind のクラス）。 */
	readonly color: string;
	/** 読み上げ用の名前。 */
	readonly label: string;
}

const MAN = "text-red-700";
const HONOR = "text-slate-900";

export const TILE_FACES: readonly TileFace[] = [
	{ top: "東", color: HONOR, label: "東" },
	{ top: "南", color: HONOR, label: "南" },
	{ top: "西", color: HONOR, label: "西" },
	{ top: "北", color: HONOR, label: "北" },
	{ top: "中", color: "text-red-600", label: "中" },
	{ top: "發", color: "text-green-700", label: "發" },
	{ top: "白", color: "text-sky-700", label: "白" },
	{ top: "一", bottom: "萬", color: MAN, label: "一萬" },
	{ top: "二", bottom: "萬", color: MAN, label: "二萬" },
	{ top: "三", bottom: "萬", color: MAN, label: "三萬" },
	{ top: "四", bottom: "萬", color: MAN, label: "四萬" },
	{ top: "五", bottom: "萬", color: MAN, label: "五萬" },
];

export function faceOf(kind: number): TileFace {
	return TILE_FACES[kind] ?? { top: "?", color: HONOR, label: "?" };
}
