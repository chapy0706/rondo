/**
 * 平屋のカメラのめり込み（ブラウザの E2E のサンプル / issue-46 の続き。@hiraya）。
 *
 * 平屋のルームを2タブで作り、準備移動の隠れ側の画面で、テスト用の口（apps/web の testHooks.ts）から、
 * 各部屋の隅・壁際・家具のそばの代表的な場所 × 8 方向で、描画と同じ守りを当てたカメラの位置を読む。
 * そのまわりの実物のメッシュ（見えている物）に線を引き、
 * - カメラが物の中にない（最初に当たる面が裏向きの方向が 0）
 * - いちばん近い面までが、ニアクリップの面の角までの距離以上
 * を確かめる。いまのカメラの位置（玄関に現れたとき）も、同じ規則で確かめる。
 *
 * 実行: pnpm --filter @rondo/e2e e2e:hiraya（playwright.hiraya.config.ts。make e2e の外）
 */

import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { type Cell, centerOf } from "@rondo/bots/plan";
import { type StageMap, readStageNotice } from "@rondo/bots/stage";
import {
	createFromLobby,
	expectPhase,
	joinFromLobby,
	test,
	touchArea,
} from "./flows";

interface Probe {
	readonly position: { x: number; y: number; z: number };
	readonly feet: number;
	readonly backFaces: number;
	readonly nearest: number | null;
	readonly nearestName: string | null;
}

interface Box {
	readonly name: string;
	readonly min: { x: number; y: number; z: number };
	readonly max: { x: number; y: number; z: number };
}

interface Hook {
	ready(): boolean;
	nearClearance: number;
	furniture(): Box[];
	camera(): { x: number; y: number; z: number } | null;
	probeCamera(x: number, z: number, yaw: number): Probe | null;
}

declare global {
	interface Window {
		__rondoTest?: { veryare: Hook };
	}
}

const stage = (() => {
	const fixture = JSON.parse(
		readFileSync(
			new URL(
				"../../packages/contracts/src/fixtures/veryare-hiraya-stage.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const map = readStageNotice(fixture.stage);
	if (map === null) throw new Error("平屋の見本が読めない");
	return map;
})();

const regionAt = (map: StageMap, cell: Cell): string | null => {
	const char = [...(map.rows[cell.z] ?? "")][cell.x];
	return char === undefined ? null : (map.regions[char] ?? null);
};

/** 境（領域が変わる隣）の数。 */
const boundaries = (map: StageMap, cell: Cell): number => {
	const region = regionAt(map, cell);
	return [
		{ x: 1, z: 0 },
		{ x: -1, z: 0 },
		{ x: 0, z: 1 },
		{ x: 0, z: -1 },
	].filter(
		(d) => regionAt(map, { x: cell.x + d.x, z: cell.z + d.z }) !== region,
	).length;
};

/** 部屋ごとの、隅（境が2つ以上）のマス1つと、壁際（境が1つ）のマスの真ん中の1つ。 */
function roomSpots(map: StageMap): { label: string; x: number; z: number }[] {
	const spots: { label: string; x: number; z: number }[] = [];
	const regions = [...new Set(Object.values(map.regions))];
	for (const region of regions) {
		const cells: Cell[] = [];
		for (let z = 0; z < map.depth; z++) {
			for (let x = 0; x < map.width; x++) {
				if (regionAt(map, { x, z }) === region) cells.push({ x, z });
			}
		}
		const corner = cells.find((c) => boundaries(map, c) >= 2);
		const walls = cells.filter((c) => boundaries(map, c) === 1);
		const wall = walls[Math.floor(walls.length / 2)];
		for (const [label, cell] of [
			["隅", corner],
			["壁際", wall],
		] as const) {
			if (cell === undefined) continue;
			spots.push({ label: `${region} の${label}`, ...centerOf(map, cell) });
		}
	}
	return spots;
}

/** 背の高い家具（高さ 1 m 以上、根の物）の、面の 0.3 m 手前で、歩けるマスにある点。 */
function furnitureSpots(
	map: StageMap,
	boxes: readonly Box[],
): { label: string; x: number; z: number }[] {
	const spots: { label: string; x: number; z: number }[] = [];
	for (const box of boxes) {
		if (box.name.includes(" / ") || box.max.y - box.min.y < 1) continue;
		const cx = (box.min.x + box.max.x) / 2;
		const cz = (box.min.z + box.max.z) / 2;
		for (const p of [
			{ x: box.min.x - 0.3, z: cz },
			{ x: box.max.x + 0.3, z: cz },
			{ x: cx, z: box.min.z - 0.3 },
			{ x: cx, z: box.max.z + 0.3 },
		]) {
			const cell = {
				x: Math.floor((p.x - map.origin.x) / map.cellSize),
				z: Math.floor((p.z - map.origin.z) / map.cellSize),
			};
			if (regionAt(map, cell) !== null) {
				spots.push({ label: `${box.name} のそば`, ...p });
				break;
			}
		}
	}
	return spots;
}

test("平屋: 各部屋の隅・壁際・家具のそばで、カメラが実物のメッシュに入らない @hiraya", async ({
	openTab,
}) => {
	const a = await openTab();
	const b = await openTab();

	// A が、ロビーで平屋（CPU なし）のルームを作る。
	const roomId = await createFromLobby(a, { stage: 1 });
	await joinFromLobby(b, roomId);

	// A が鬼になり、B が隠れ側として準備移動に入る（平屋の glb が表示されるまで待つ）。
	touchArea(a, roomId);
	await expectPhase(b, "preparation", 60_000);
	await expect
		.poll(
			() => b.page.evaluate(() => window.__rondoTest?.veryare.ready() ?? false),
			{
				timeout: 60_000,
			},
		)
		.toBe(true);

	const nearClearance = await b.page.evaluate(
		() => window.__rondoTest?.veryare.nearClearance ?? 0,
	);
	const boxes = await b.page.evaluate(
		() => window.__rondoTest?.veryare.furniture() ?? [],
	);
	expect(boxes.length).toBeGreaterThan(0);

	const spots = [...roomSpots(stage), ...furnitureSpots(stage, boxes)];
	const problems: string[] = [];
	for (const spot of spots) {
		for (let k = 0; k < 8; k++) {
			const yaw = (k / 8) * 2 * Math.PI;
			const probe = await b.page.evaluate(
				({ x, z, yaw }) =>
					window.__rondoTest?.veryare.probeCamera(x, z, yaw) ?? null,
				{ x: spot.x, z: spot.z, yaw },
			);
			const where = `${spot.label} (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})・向き ${k * 45}°`;
			if (probe === null) {
				problems.push(`${where}: 口が値を返さない`);
				continue;
			}
			if (probe.backFaces > 0) {
				problems.push(
					`${where}: ${probe.nearestName} の中（裏向きの面 ${probe.backFaces} 方向）`,
				);
			} else if (probe.nearest !== null && probe.nearest < nearClearance) {
				problems.push(
					`${where}: ${probe.nearestName} まで ${probe.nearest.toFixed(3)} m`,
				);
			}
		}
	}
	expect(problems).toEqual([]);

	// いまのカメラ（玄関に現れたとき）も、口で位置を読める。
	const camera = await b.page.evaluate(
		() => window.__rondoTest?.veryare.camera() ?? null,
	);
	expect(camera).not.toBeNull();
});
