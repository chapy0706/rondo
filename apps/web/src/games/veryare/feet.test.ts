import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_CAPSULE } from "./bodySize";
import { CAMERA_MAX_HEIGHT, EYE_HEIGHT, cameraPose } from "./camera";
import { FOOT_SETTLE_SECONDS, followFloor } from "./feet";
import { intersectCylinder } from "./paint";

describe("followFloor - 足もとの高さを、なめらかに床へ寄せる（issue-46）", () => {
	it("経過が 0 なら動かない。十分に長ければ床の高さに着く", () => {
		expect(followFloor(0, 0.6, 0)).toBe(0);
		expect(followFloor(0, 0.6, 10)).toBe(0.6);
	});

	it("決めた時間（FOOT_SETTLE_SECONDS）で、段差の 95% 以上を追う。行き過ぎない", () => {
		expect(FOOT_SETTLE_SECONDS).toBeGreaterThanOrEqual(0.1);
		expect(FOOT_SETTLE_SECONDS).toBeLessThanOrEqual(0.15);
		const after = followFloor(0.4, 0.6, FOOT_SETTLE_SECONDS);
		expect(after).toBeGreaterThanOrEqual(0.4 + 0.2 * 0.95);
		expect(after).toBeLessThanOrEqual(0.6);
		const down = followFloor(0.6, 0.4, FOOT_SETTLE_SECONDS);
		expect(down).toBeLessThanOrEqual(0.6 - 0.2 * 0.95);
		expect(down).toBeGreaterThanOrEqual(0.4);
	});

	it("小さな時間で少しずつ寄り、だんだん近づく（跳ねない）", () => {
		let y = 0;
		let previous = 0;
		for (let i = 0; i < 10; i++) {
			y = followFloor(y, 0.6, 1 / 60);
			expect(y).toBeGreaterThan(previous);
			expect(y).toBeLessThanOrEqual(0.6);
			previous = y;
		}
	});

	it("1 mm より近ければ、床の高さに合わせる（いつまでも寄り続けない）", () => {
		expect(followFloor(0.5995, 0.6, 1 / 60)).toBe(0.6);
	});
});

describe("cameraPose - TPS カメラは体の高さについて行く（距離と角度は変えない）", () => {
	it("足もとを上げると、カメラと見る点が同じだけ上がる", () => {
		const low = cameraPose({ x: 1, z: 2, feet: 0 }, 0.3, 0.35);
		const high = cameraPose({ x: 1, z: 2, feet: 0.6 }, 0.3, 0.35);
		expect(high.target.y - low.target.y).toBeCloseTo(0.6, 9);
		expect(high.position.y - low.position.y).toBeCloseTo(0.6, 9);
		expect(high.position.x).toBeCloseTo(low.position.x, 9);
		expect(high.position.z).toBeCloseTo(low.position.z, 9);
	});

	it("箱の表示（足もと 0）では、目線 1.28 m（体の高さ 1.6 m の 0.8）、水平の距離はこれまでと同じ（高さは上限 1.85 m まで）", () => {
		const pose = cameraPose({ x: 0, z: 0, feet: 0 }, 0, 0.35);
		expect(pose.target).toEqual({ x: 0, y: EYE_HEIGHT, z: 0 });
		const dx = pose.position.x - pose.target.x;
		const dz = pose.position.z - pose.target.z;
		expect(Math.hypot(dx, dz)).toBeCloseTo(2.6 * Math.cos(0.35), 9);
		expect(pose.position.y).toBeCloseTo(CAMERA_MAX_HEIGHT, 9);
	});
});

/** カメラを置き、画面の点（-1〜1）の光線を作る（scene.ts の pickPaint・pickHider と同じ手順）。 */
function rayFrom(
	center: { x: number; z: number; feet: number },
	screen: { x: number; y: number },
): THREE.Raycaster {
	const pose = cameraPose(center, 0.4, 0.35);
	const camera = new THREE.PerspectiveCamera(60, 3 / 4, 0.05, 100);
	camera.position.set(pose.position.x, pose.position.y, pose.position.z);
	camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
	camera.updateMatrixWorld();
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
	return raycaster;
}

describe("体の高さを変えても、体の中の相対位置は変わらない（ペイントと照準）", () => {
	it("ペイント: 同じ画面の点で、描き込み面の u・v は、足もと 0 でも 0.72 でも同じ", () => {
		const uvAt = (feet: number) => {
			const body = new THREE.Object3D();
			// 体の座標は、足もとが原点（bodySize.ts）。
			body.position.set(1, feet, 2);
			body.updateMatrixWorld();
			const raycaster = rayFrom({ x: 1, z: 2, feet }, { x: 0.05, y: -0.1 });
			const inverse = body.matrixWorld.clone().invert();
			const origin = raycaster.ray.origin.clone().applyMatrix4(inverse);
			const direction = raycaster.ray.direction
				.clone()
				.transformDirection(inverse);
			return intersectCylinder({ origin, direction });
		};
		const ground = uvAt(0);
		const raised = uvAt(0.72);
		expect(ground).not.toBeNull();
		expect(raised?.u).toBeCloseTo(ground?.u ?? Number.NaN, 9);
		expect(raised?.v).toBeCloseTo(ground?.v ?? Number.NaN, 9);
	});

	it("照準: 鬼と隠れ側が同じ高さの床に立つとき、画面の中央の当たりは、床の高さに依らない", () => {
		const hitAt = (feet: number) => {
			const hider = new THREE.Mesh(
				new THREE.CapsuleGeometry(
					PLACEHOLDER_CAPSULE.radius,
					PLACEHOLDER_CAPSULE.length,
					4,
					12,
				),
			);
			// 鬼の正面（カメラの向き）に、2 m 先に立つ隠れ側。
			const pose = cameraPose({ x: 0, z: 0, feet }, 0.4, 0.35);
			const ahead = new THREE.Vector3(
				pose.target.x - pose.position.x,
				0,
				pose.target.z - pose.position.z,
			).normalize();
			hider.position.set(
				ahead.x * 2,
				PLACEHOLDER_CAPSULE.centerY + feet,
				ahead.z * 2,
			);
			hider.updateMatrixWorld();
			const [hit] = rayFrom(
				{ x: 0, z: 0, feet },
				{ x: 0, y: 0 },
			).intersectObject(hider);
			return hit === undefined ? null : hit.point.y - feet;
		};
		const ground = hitAt(0);
		expect(ground).not.toBeNull();
		expect(hitAt(0.6)).toBeCloseTo(ground ?? Number.NaN, 9);
	});
});
