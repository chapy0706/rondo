/**
 * 部屋タイプの代表色（issue-29c / ADR 0038）。
 *
 * ステージの床の色と、隠れ側を塗る代表色（issue-25 のペイント）は、この1つの表から引く。
 * 値はサーバーの server/src/rondo_server/games/veryare/palette.gleam と同じで、共有の見本
 * packages/contracts/src/fixtures/veryare-palette.json を通して、両方のテストが一致を確かめる。
 * 仮の値で、モデルと素材がそろったら平均色を取って合わせ直す（サーバーと同時に変える）。
 */

import type { Cell, StageGrid } from "./stage";

/** 廊下・縁側・玄関の代表色（板張りの明るい茶色）。 */
export const FLOOR_COLOR = "#a07850";

/** まだ塗っていない体の色。 */
export const UNPAINTED_COLOR = "#ece8f5";

/** 部屋タイプ（ステージの通知の rooms の値）の代表色。 */
export const ROOM_COLORS: Readonly<Record<string, string>> = {
	washitsu: "#b5a46a",
	"washitsu-oshiire": "#a8956a",
	"washitsu-kakejiku": "#c2b280",
	oshiire: "#6b5440",
};

/** その場の代表色。部屋の中ならその部屋タイプの色、それ以外は廊下の色（palette.gleam の place_color）。 */
export function placeColor(grid: StageGrid, cell: Cell): string {
	const region = grid.regionAt(cell);
	if (region === null) return FLOOR_COLOR;
	const room = grid.rooms[region];
	return (room === undefined ? undefined : ROOM_COLORS[room]) ?? FLOOR_COLOR;
}
