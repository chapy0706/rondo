/**
 * 外れの理由の推定（issue-45 の続き）。サーバーと同じ規則（射程 8 m、地図の辺の通れる・通れない、
 * 撃つ間隔）で、手元で外れの理由を推定し、画面に短く出す。判定はサーバーだけが行い、ここは表示だけ
 * （推定が外れても、勝敗には関わらない）。
 *
 * 見通しは、サーバーの grid.line_clear と同じ走査（マスの境を順にたどり、角をちょうど通るときは
 * 両脇がどちらも通るときだけ通す）。遮ったものが閉じた襖か、それ以外（壁・いつも閉じている戸・
 * 歩けないマス）かを返す。
 */

import type { Point } from "./rules";
import { type Cell, type StageGrid, cellAt, edgeKey, passable } from "./stage";

/** 射程（メートル。サーバーの game.shot_range と同じ）。 */
export const SHOT_RANGE = 8;

export type MissReason = "no-target" | "reload" | "range" | "fusuma" | "wall";

const NEVER = 1e18;
const EPSILON = 1e-9;

/** a と b の境が通れないとき、その理由（閉じた襖か、壁など）。通れれば null。 */
function blockOf(
	grid: StageGrid,
	open: ReadonlySet<string>,
	a: Cell,
	b: Cell,
): "fusuma" | "wall" | null {
	if (passable(grid, open, a, b)) return null;
	return grid.doors.get(edgeKey(a, b)) === "fusuma" ? "fusuma" : "wall";
}

/** from から to への線を遮る、最初のもの。遮るものが無ければ null。 */
export function lineBlocker(
	grid: StageGrid,
	open: ReadonlySet<string>,
	from: Point,
	to: Point,
): "fusuma" | "wall" | null {
	const start = cellAt(grid, from);
	const goal = cellAt(grid, to);
	if (grid.regionAt(start) === null || grid.regionAt(goal) === null) {
		return "wall";
	}
	const u0 = (from.x - grid.origin.x) / grid.cellSize;
	const v0 = (from.z - grid.origin.z) / grid.cellSize;
	const du = (to.x - grid.origin.x) / grid.cellSize - u0;
	const dv = (to.z - grid.origin.z) / grid.cellSize - v0;
	const stepX = Math.sign(du);
	const stepZ = Math.sign(dv);
	const deltaX = du === 0 ? NEVER : 1 / Math.abs(du);
	const deltaZ = dv === 0 ? NEVER : 1 / Math.abs(dv);
	let tx =
		stepX > 0
			? (start.x + 1 - u0) / du
			: stepX < 0
				? (start.x - u0) / du
				: NEVER;
	let tz =
		stepZ > 0
			? (start.z + 1 - v0) / dv
			: stepZ < 0
				? (start.z - v0) / dv
				: NEVER;
	let cell = start;
	const budget = (grid.width + grid.depth) * 2 + 4;
	for (let i = 0; i < budget; i++) {
		if (cell.x === goal.x && cell.z === goal.z) return null;
		const nextX = { x: cell.x + stepX, z: cell.z };
		const nextZ = { x: cell.x, z: cell.z + stepZ };
		if (tx < tz - EPSILON) {
			const block = blockOf(grid, open, cell, nextX);
			if (block !== null) return block;
			cell = nextX;
			tx += deltaX;
		} else if (tz < tx - EPSILON) {
			const block = blockOf(grid, open, cell, nextZ);
			if (block !== null) return block;
			cell = nextZ;
			tz += deltaZ;
		} else {
			// 角をちょうど通る。両脇の道筋がどちらも通せるときだけ斜めに進む。
			const diagonal = { x: cell.x + stepX, z: cell.z + stepZ };
			const blocks = [
				blockOf(grid, open, cell, nextX),
				blockOf(grid, open, nextX, diagonal),
				blockOf(grid, open, cell, nextZ),
				blockOf(grid, open, nextZ, diagonal),
			].filter((block) => block !== null);
			if (blocks.length > 0)
				return blocks.includes("fusuma") ? "fusuma" : "wall";
			cell = diagonal;
			tx += deltaX;
			tz += deltaZ;
		}
	}
	return "wall";
}

/**
 * 外れの理由の推定。target は狙った隠れ側の位置（狙った所にいなければ null）。grid が null
 * （ステージの地図が無い）なら、射程だけを見る。当たるはずなら null。
 */
export function missHint(options: {
	readonly grid: StageGrid | null;
	readonly open: ReadonlySet<string>;
	readonly oni: Point;
	readonly target: Point | null;
	readonly reloadMs: number;
}): MissReason | null {
	const { grid, open, oni, target, reloadMs } = options;
	if (reloadMs > 0) return "reload";
	if (target === null) return "no-target";
	const dx = target.x - oni.x;
	const dz = target.z - oni.z;
	if (dx * dx + dz * dz > SHOT_RANGE * SHOT_RANGE) return "range";
	if (grid === null) return null;
	return lineBlocker(grid, open, oni, target);
}

const TEXTS: Readonly<Record<MissReason, string>> = {
	"no-target": "外れ: 狙った所に、隠れている人がいません",
	reload: "外れ: 間隔中です",
	range: `外れ: 遠すぎます（${SHOT_RANGE} m まで）`,
	fusuma: "外れ: 襖が閉まっています",
	wall: "外れ: 壁の向こうです",
};

/** 画面に出す短い文。 */
export function missText(reason: MissReason): string {
	return TEXTS[reason];
}

/** 開発中だけ Console に出す、射撃の結果（狙った相手、推定、隠れ中の一覧の変化）。 */
export function shotLogMessage(options: {
	readonly target: string | null;
	readonly hint: MissReason | null;
	readonly before: readonly string[];
	readonly after: readonly string[];
}): string {
	const { target, hint, before, after } = options;
	const found = before.filter((id) => !after.includes(id));
	const change =
		found.length === 0 ? "変化なし" : `${found.join(", ")} が見つかった`;
	return `[veryare-shoot] 結果: target=${target ?? "なし"}・推定=${hint ?? "当たるはず"}・隠れている ${before.join(", ")} → ${after.join(", ")}（${change}）`;
}
