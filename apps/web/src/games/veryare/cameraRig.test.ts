import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import {
	CAMERA_DISTANCE,
	CAMERA_MIN_HEIGHT,
	CAMERA_PITCH,
	CAMERA_PITCH_MAX,
	CAMERA_SETTLE_SECONDS,
	CAMERA_WALL_MARGIN,
	cameraPose,
} from "./camera";
import { CAMERA_MAX_HEIGHT, DEFAULT_CAMERA, EYE_HEIGHT } from "./camera";
import { cameraReach, followCameraReach, reachedPose } from "./cameraRig";
import { parseStageNotice } from "./stage";

const grid = parseStageNotice(hirayaFixture.stage);
if (grid === null) throw new Error("平屋の見本が読めない");

/** マス（列, 行）の中心。 */
const at = (x: number, z: number) => ({
	x: grid.origin.x + grid.cellSize * (x + 0.5),
	z: grid.origin.z + grid.cellSize * (z + 0.5),
});

describe("cameraReach - 体からカメラへの線のうち、体の領域に収まる割合（issue-46 / ADR 0043）", () => {
	it("同じ領域の中なら 1（和室Cの中）", () => {
		expect(cameraReach(grid, at(24, 28), at(28, 32))).toBe(1);
	});

	it("壁の手前で止まる（和室A → キッチンの壁。境は x = 0.075）", () => {
		const from = at(18, 7);
		const to = at(24, 7);
		const t = cameraReach(grid, from, to);
		expect(from.x + (to.x - from.x) * t).toBeCloseTo(0.075, 6);
	});

	it("襖は、開いていても閉じていても、戸の境で止まる（和室A → ダイニング）", () => {
		const from = at(18, 15);
		const to = at(24, 15);
		const t = cameraReach(grid, from, to);
		expect(from.x + (to.x - from.x) * t).toBeCloseTo(0.075, 6);
	});

	it("いつも開いている戸でも止まる（洗面所 → 東の廊下。境は z = 3.625）", () => {
		const from = at(34, 10);
		const to = at(34, 16);
		const t = cameraReach(grid, from, to);
		expect(from.z + (to.z - from.z) * t).toBeCloseTo(3.625, 6);
	});

	it("角をちょうど通るときは、両脇の一方でも領域が変われば止まる（安全側）", () => {
		// 和室A (19,19) から、ダイニングとの境と、和室Bとの境が交わる角 (21,21) をちょうど通る斜めの線。
		const from = at(19, 19);
		const to = at(23, 23);
		const t = cameraReach(grid, from, to);
		expect(t).toBeGreaterThan(0);
		expect(t).toBeLessThan(1);
		expect(from.x + (to.x - from.x) * t).toBeLessThanOrEqual(0.075 + 1e-9);
	});

	it("体が領域の境の上に立っているときは、体のマス（位置のマス）の側から線を引く", () => {
		// x = 0.075 はダイニング（列 21）のマスの左の辺。体のマスはダイニング。
		const body = { x: 0.075, z: at(25, 15).z };
		// ダイニングの中へ（東へ）は、領域の中なので止まらない。
		expect(cameraReach(grid, body, at(27, 15))).toBe(1);
		// 和室Aへ（西へ）は、すぐに境なので 0。
		expect(cameraReach(grid, body, at(15, 15))).toBe(0);
	});

	it("歩けないマスから引いたときは 0（体は歩けるマスにいるはずなので、安全側）", () => {
		expect(cameraReach(grid, at(0, 0), at(2, 2))).toBe(0);
	});
});

describe("reachedPose - 近づいたぶん、見下ろす角度を上げる", () => {
	const center = { x: 1, z: 2, feet: 0.6 };
	const full = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);

	it("開けた所（水平の距離がいっぱい）では、いまの cameraPose と同じ", () => {
		const pose = reachedPose(center, 0.4, full);
		const base = cameraPose(center, 0.4, CAMERA_PITCH);
		expect(pose.position.x).toBeCloseTo(base.position.x, 9);
		expect(pose.position.y).toBeCloseTo(base.position.y, 9);
		expect(pose.position.z).toBeCloseTo(base.position.z, 9);
		expect(pose.pitch).toBeCloseTo(CAMERA_PITCH, 9);
	});

	it("水平の距離は、渡した距離を超えない。近いほど角度が上がり、最大を超えない", () => {
		let previous = CAMERA_PITCH;
		for (const h of [full * 0.75, full * 0.5, full * 0.25, 0]) {
			const pose = reachedPose(center, 0.4, h);
			// 見る点は前へずれるので、体（目線の点）からの水平の距離を測る。
			const dx = pose.position.x - center.x;
			const dz = pose.position.z - center.z;
			expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(h + 1e-9);
			expect(pose.pitch).toBeGreaterThan(previous);
			expect(pose.pitch).toBeLessThanOrEqual(CAMERA_PITCH_MAX + 1e-9);
			previous = pose.pitch;
		}
	});

	it("水平の距離が 0 でも、カメラは見る点の上にあり、数は有限（NaN・無限にならない）", () => {
		const pose = reachedPose(center, 0.4, 0);
		expect(pose.position.y - pose.target.y).toBeGreaterThanOrEqual(
			CAMERA_MIN_HEIGHT - 1e-9,
		);
		for (const v of [
			pose.position.x,
			pose.position.y,
			pose.position.z,
			pose.pitch,
		]) {
			expect(Number.isFinite(v)).toBe(true);
		}
	});
});

describe("followCameraReach - 縮むときは即座、伸びるときはなめらか", () => {
	it("縮むときは、その場で合わせる（1 フレームでも領域の外に出さない）", () => {
		expect(followCameraReach(2.4, 0.5, 1 / 60)).toBe(0.5);
	});

	it("伸びるときは、CAMERA_SETTLE_SECONDS で 95% 以上を追い、行き過ぎない", () => {
		expect(CAMERA_SETTLE_SECONDS).toBe(0.15);
		const next = followCameraReach(0.5, 2.4, CAMERA_SETTLE_SECONDS);
		expect(next).toBeGreaterThanOrEqual(0.5 + 1.9 * 0.95);
		expect(next).toBeLessThanOrEqual(2.4);
		expect(followCameraReach(0.5, 2.4, 0)).toBe(0.5);
	});
});

describe("戸口を通る間の動き（壁と戸の手前で止め、数が破綻しない）", () => {
	it("和室Cから東の廊下へ、開いた襖をまたいで歩く間、どの位置でもカメラは有限で、体の領域を出ない", () => {
		const full = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
		let reach = full;
		// 和室C (30, 30) から 東の廊下 (36, 30) へ、0.05 m ずつ。カメラは西（体の後ろ）を向く。
		for (let x = at(30, 30).x; x <= at(36, 30).x; x += 0.05) {
			const body = { x, z: at(30, 30).z };
			const yaw = -Math.PI / 2; // カメラは体の -x 側（西）。
			const want = {
				x: body.x + Math.sin(yaw) * full,
				z: body.z + Math.cos(yaw) * full,
			};
			const allowed = Math.max(
				0,
				Math.min(
					full,
					cameraReach(grid, body, want) * full - CAMERA_WALL_MARGIN,
				),
			);
			reach = followCameraReach(reach, allowed, 1 / 60);
			const pose = reachedPose({ ...body, feet: 0.6 }, yaw, reach);
			for (const v of [
				pose.position.x,
				pose.position.y,
				pose.position.z,
				pose.pitch,
			]) {
				expect(Number.isFinite(v)).toBe(true);
			}
			const camera = { x: pose.position.x, z: pose.position.z };
			expect(cameraReach(grid, body, camera)).toBe(1);
		}
	});
});

describe("見る点を前へずらす（カメラが近づいたぶん / 上から見下ろす視点にならないように）", () => {
	const center = { x: 1, z: 2, feet: 0.6 };
	const full = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
	const eye = { x: 1, y: 0.6 + EYE_HEIGHT, z: 2 };

	it("開けた所（水平の距離がいっぱい）では、ずらさない", () => {
		const pose = reachedPose(center, 0.4, full);
		expect(pose.target.x).toBeCloseTo(eye.x, 9);
		expect(pose.target.y).toBeCloseTo(eye.y, 9);
		expect(pose.target.z).toBeCloseTo(eye.z, 9);
	});

	it("いちばん近づいたとき、カメラの向きの前方へ、ずらす量のぶんだけずらす。カメラの位置は変えない", () => {
		const yaw = 0.4;
		const settings = { ...DEFAULT_CAMERA, lookAhead: 1.0 };
		const pose = reachedPose(center, yaw, 0, settings);
		// カメラは体の +(sin yaw, cos yaw) 側にあるので、前方は -(sin yaw, cos yaw)。
		expect(pose.target.x).toBeCloseTo(eye.x - Math.sin(yaw), 9);
		expect(pose.target.z).toBeCloseTo(eye.z - Math.cos(yaw), 9);
		expect(pose.target.y).toBeCloseTo(eye.y, 9);
		const still = reachedPose(center, yaw, 0, { ...settings, lookAhead: 0 });
		expect(pose.position).toEqual(still.position);
	});

	it("近づくほど、ずらす量が増える（間は比例）", () => {
		const shift = (h: number) => eye.z - reachedPose(center, 0, h).target.z;
		expect(shift(full / 2)).toBeCloseTo(DEFAULT_CAMERA.lookAhead / 2, 9);
		expect(shift(full / 4)).toBeGreaterThan(shift(full / 2));
	});

	it("水平の距離 0 でも、見下ろす角度は 30° 未満（真上から床を見ない）", () => {
		const pose = reachedPose(center, 0, 0);
		const horizontal = Math.hypot(
			pose.target.x - pose.position.x,
			pose.target.z - pose.position.z,
		);
		const down = Math.atan2(pose.position.y - pose.target.y, horizontal);
		expect(down).toBeLessThan((30 * Math.PI) / 180);
	});
});

describe("壁際でも、カメラは体の領域（部屋）の外に出ない（ADR 0043）", () => {
	it("壁に接した体のまわりを、どの向きに回しても、カメラは体の領域の中", () => {
		const full = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
		// 和室Aのキッチンとの壁際・和室Cの隅・トイレ（狭い部屋）・広縁（細い通り道）・縁側の端。
		const bodies = [
			{ x: 0.07, z: at(18, 7).z },
			{ x: at(32, 34).x, z: at(32, 34).z },
			{ x: at(38, 16).x, z: at(38, 16).z },
			{ x: at(5, 30).x, z: at(5, 30).z },
			{ x: at(1, 43).x, z: at(1, 43).z },
		];
		for (const body of bodies) {
			for (let k = 0; k < 24; k++) {
				const yaw = (k / 24) * 2 * Math.PI;
				const want = {
					x: body.x + Math.sin(yaw) * full,
					z: body.z + Math.cos(yaw) * full,
				};
				const allowed = Math.max(
					0,
					Math.min(
						full,
						cameraReach(grid, body, want) * full - CAMERA_WALL_MARGIN,
					),
				);
				const pose = reachedPose({ ...body, feet: 0.6 }, yaw, allowed);
				expect(
					cameraReach(grid, body, { x: pose.position.x, z: pose.position.z }),
				).toBe(1);
			}
		}
	});
});

describe("床の高さは、カメラの高さに一度だけ足す（二重に足さない）", () => {
	it("床 0.6 m のマスでも、足もとからのカメラの高さは、床なしのときと同じ（どの水平の距離でも）", () => {
		const full = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
		for (const h of [full, full / 2, 0]) {
			const flat = reachedPose({ x: 1, z: 2, feet: 0 }, 0.3, h);
			const raised = reachedPose({ x: 1, z: 2, feet: 0.6 }, 0.3, h);
			expect(raised.position.y - 0.6).toBeCloseTo(flat.position.y, 9);
			expect(raised.target.y - 0.6).toBeCloseTo(flat.target.y, 9);
		}
	});
});

describe("カメラの高さの上限（issue-56。体の高さ 1.6 m で目が高くなったため）", () => {
	it("どの水平の距離でも、カメラは足もとから CAMERA_MAX_HEIGHT（1.85 m）より高くならない", () => {
		expect(CAMERA_MAX_HEIGHT).toBe(1.85);
		const full = CAMERA_DISTANCE * Math.cos(CAMERA_PITCH);
		for (let i = 0; i <= 100; i++) {
			const pose = reachedPose({ x: 0, z: 0, feet: 0.6 }, 0, (full * i) / 100);
			expect(pose.position.y - 0.6).toBeLessThanOrEqual(
				CAMERA_MAX_HEIGHT + 1e-9,
			);
			// 見る点（目）より下にはならない。
			expect(pose.position.y).toBeGreaterThan(pose.target.y);
		}
		const open = cameraPose({ x: 0, z: 0, feet: 0.6 }, 0, CAMERA_PITCH);
		expect(open.position.y - 0.6).toBeLessThanOrEqual(CAMERA_MAX_HEIGHT + 1e-9);
	});
});
