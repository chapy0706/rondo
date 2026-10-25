/**
 * 体の大きさ（issue-56）。素材の人型（X Bot）も仮のカプセルも、この高さにそろえる（素材が読めない
 * ときも、同じ遊びの値で動くため）。体の高さに結びつく値（目の高さ、狙いの当たりの円柱、描き込み面の
 * 範囲、仮のカプセル）は、すべてここから決める。three を使わない。
 *
 * 体の座標は、足もとが y = 0、頭が y = BODY_HEIGHT（体の縦の軸が x = z = 0）。
 */

/** 体の高さ（足もとから頭まで。メートル）。 */
export const BODY_HEIGHT = 1.6;

/** 体の太さ（狙いの当たりの円柱と、描き込み面の円柱の半径。メートル）。 */
export const BODY_RADIUS = 0.2;

/**
 * 頭の半径（メートル）。素材の体（X Bot）の頭の幅の半分（0.09 m。体の高さ 1.81 m のとき）を、体の高さに
 * そろえた値（0.09 × 1.6 / 1.81 ≒ 0.08）。ブラシの「大」の大きさ（paint.ts の BRUSH_SIZES）。仮の
 * カプセルでも、同じ値を使う。
 */
export const HEAD_RADIUS = 0.08;

/** 目の高さの、体の高さに対する割合。 */
export const EYE_HEIGHT_RATIO = 0.8;

/** 目の高さ（三人称カメラが見る点。足もとから。メートル）。 */
export const EYE_HEIGHT = BODY_HEIGHT * EYE_HEIGHT_RATIO;

/** 仮のカプセル（three の CapsuleGeometry の半径と、まっすぐな部分の長さ。中心の高さ）。 */
export const PLACEHOLDER_CAPSULE = {
	radius: BODY_RADIUS,
	length: BODY_HEIGHT - 2 * BODY_RADIUS,
	centerY: BODY_HEIGHT / 2,
} as const;
