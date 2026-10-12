/**
 * カメラのめり込みの判定（issue-46 の続き）。カメラの守り（cameraGuard.ts）が置いたカメラの位置を、
 * 守りとは別の、素直な規則で確かめる。自動テストの全探索（cameraGuard.test.ts）と、実データの全探索
 * （tools/check_camera_hiraya.mjs）が、同じこの判定を使う。
 *
 * - 領域の外: 体からカメラへの線が、体のいる領域の外へ出る（ADR 0043）
 * - 壁: カメラから領域の境（壁・すべての戸）までが、壁の面のずれとニアクリップの和より近い
 * - 家具の中・近い: カメラが家具の箱の中にある、または箱までがニアクリップより近い
 * - 隠す: 目からカメラへの線を、家具の箱がふさぐ（体の円柱が箱に重なるときは除く）
 */

import { EYE_HEIGHT } from "./camera";
import {
	type FurnitureBox,
	NEAR_CLEARANCE,
	WALL_FACE_OFFSET,
	bodyOverlapsBox,
	boundaryEdges,
	distanceToBox,
	distanceToSegment,
	segmentHitsBox,
} from "./cameraGuard";
import { cameraReach } from "./cameraRig";
import type { StageGrid } from "./stage";

export type CameraProblem =
	| { readonly kind: "region" }
	| { readonly kind: "wall"; readonly distance: number }
	| { readonly kind: "inside"; readonly object: string }
	| {
			readonly kind: "near";
			readonly object: string;
			readonly distance: number;
	  }
	| { readonly kind: "hides"; readonly object: string };

/** 点が箱の中か（面の上は含めない）。 */
function inside(
	p: { readonly x: number; readonly y: number; readonly z: number },
	box: FurnitureBox,
): boolean {
	return (
		p.x > box.min.x &&
		p.x < box.max.x &&
		p.y > box.min.y &&
		p.y < box.max.y &&
		p.z > box.min.z &&
		p.z < box.max.z
	);
}

/** カメラの位置 camera の問題の一覧（無ければ空）。body は体の位置、feet は足もとの高さ。 */
export function cameraProblems(
	grid: StageGrid,
	body: { readonly x: number; readonly z: number },
	feet: number,
	camera: { readonly x: number; readonly y: number; readonly z: number },
	boxes: readonly FurnitureBox[],
): CameraProblem[] {
	const problems: CameraProblem[] = [];
	if (cameraReach(grid, body, camera) !== 1) problems.push({ kind: "region" });
	const cell = {
		x: Math.floor((camera.x - grid.origin.x) / grid.cellSize),
		z: Math.floor((camera.z - grid.origin.z) / grid.cellSize),
	};
	let nearest = Number.POSITIVE_INFINITY;
	for (const edge of boundaryEdges(grid, cell)) {
		nearest = Math.min(nearest, distanceToSegment(camera, edge.from, edge.to));
	}
	if (nearest < WALL_FACE_OFFSET + NEAR_CLEARANCE) {
		problems.push({ kind: "wall", distance: nearest });
	}
	const eye = { x: body.x, y: feet + EYE_HEIGHT, z: body.z };
	for (const box of boxes) {
		if (inside(camera, box)) {
			problems.push({ kind: "inside", object: box.name });
		} else {
			const distance = distanceToBox(camera, box);
			if (distance < NEAR_CLEARANCE) {
				problems.push({ kind: "near", object: box.name, distance });
			}
		}
		if (
			!bodyOverlapsBox({ ...body, feet }, box) &&
			segmentHitsBox(eye, camera, box) !== null
		) {
			problems.push({ kind: "hides", object: box.name });
		}
	}
	return problems;
}

/** 問題の短い文（一覧に出す）。 */
export function problemText(problem: CameraProblem): string {
	switch (problem.kind) {
		case "region":
			return "領域の外";
		case "wall":
			return `壁まで ${problem.distance.toFixed(3)} m`;
		case "inside":
			return `${problem.object} の中`;
		case "near":
			return `${problem.object} まで ${problem.distance.toFixed(3)} m`;
		case "hides":
			return `${problem.object} が体を隠す`;
	}
}
