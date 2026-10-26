/**
 * ランダム間取りの和室に置く小物（issue-72 第 1 段階 / ADR 0054）の決まり。three と React を使わない。
 *
 * 小物は見た目だけ。移動・見通し・射撃・カメラの守りには入れない（ADR 0039 の考えの延長）。第 1 段階は、
 * 見えない所を作らない低い小物だけ: 高さが PROP_MAX_HEIGHT 以下で、上から見た長い辺が PROP_MAX_SPAN 以下
 * （寝た体を上から覆えない）。素材（キットの glb。key は room-props）は tools/room_props.mjs で作り、
 * 公開リポジトリには入れない（ADR 0040）。
 *
 * 旗 PROPS_READY（既定 false）の裏に置く。false のときは、何も読まず、何も描かない。開発用の合図
 * （NEXT_PUBLIC_VERYARE_HIRAYA、または URL の ?roof=1）のときだけ、旗に関わらず出せる。
 */

/** 小物を出す準備ができたか（本番で出すときに true にする）。 */
export const PROPS_READY = false;

/** 小物の高さの上限（m）。寝る姿勢の体の高さの上の端（0.33〜0.55 m）。 */
export const PROP_MAX_HEIGHT = 0.55;
/** 上から見た長い辺の上限（m）。これより長い天板は、寝た体（約 1.6 m）の大半を上から覆いうる。 */
export const PROP_MAX_SPAN = 1.0;

/** 小物の種類（キットのノードの名前は "room-prop:<種類>"）。 */
export const PROP_KINDS = ["chabudai", "zaisu", "tsubo", "yunomi"] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** キットのノードの名前の頭。 */
export const PROP_NODE_PREFIX = "room-prop:";
/** キットの scene の extras の名前。 */
export const PROP_EXTRAS_KEY = "rondoRoomProps";

/** 小物の大きさ（m）。幅は x、奥行きは z（足もとの中心が原点）。 */
export interface PropSize {
	readonly width: number;
	readonly depth: number;
	readonly height: number;
}

/**
 * 置き方（roomPropLayout.ts）が見込む大きさの上限（m）。平屋の元の glb の実物の寸法（2026-10-26 に
 * 調べた値）。キットの小物は、この大きさ以下であること（roomPropsFile.test.ts）。
 * - ちゃぶ台（ちゃぶ台-002 W90D90H35）、座椅子（座椅子-001）、壺（壺-001）、湯呑み（湯呑み(軽)-001。
 *   ちゃぶ台の上に置く）
 */
export const PROP_SIZES: Readonly<Record<PropKind, PropSize>> = {
	chabudai: { width: 0.9, depth: 0.9, height: 0.35 },
	zaisu: { width: 0.54, depth: 0.4, height: 0.51 },
	tsubo: { width: 0.28, depth: 0.28, height: 0.36 },
	yunomi: { width: 0.06, depth: 0.06, height: 0.07 },
};

/** 小物ごとの三角形の数の上限（キットを作るときに meshopt で減らす目安 / tools/room_props.mjs）。 */
export const PROP_TRIANGLES: Readonly<Record<PropKind, number>> = {
	chabudai: 700,
	zaisu: 700,
	tsubo: 700,
	yunomi: 250,
};

/** 小物で増える三角形の数の、全体の上限（10 種と広い屋敷の、どの地図でも）。 */
export const PROP_TRIANGLE_BUDGET = 30_000;

/** キットの大きさの上限（バイト）。 */
export const PROP_KIT_MAX_BYTES = 2 * 1024 * 1024;

/** 第 1 段階に入れてよい大きさか（高さと、上から見た長い辺）。 */
export function lowProp(size: PropSize): boolean {
	return (
		size.height <= PROP_MAX_HEIGHT &&
		Math.max(size.width, size.depth) <= PROP_MAX_SPAN
	);
}

/**
 * 小物を出すか。旗（ready）か、開発用の合図（dev = NEXT_PUBLIC_VERYARE_HIRAYA、または URL の ?roof=1）。
 * search は location.search。
 */
export function propsEnabled(
	ready: boolean,
	dev: boolean,
	search: string,
): boolean {
	return ready || dev || new URLSearchParams(search).get("roof") === "1";
}
