import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NEAR_CLEARANCE } from "./cameraGuard";
import {
	TEST_HOOKS_ENV,
	type TestableScene,
	installVeryareTestHook,
} from "./testHooks";

describe("installVeryareTestHook - テスト用の口（issue-52 の方針。環境変数が有効なときだけ）", () => {
	it("無効なら、window に何も作らない（片付けも何もしない）", () => {
		const target: Record<string, unknown> = {};
		const remove = installVeryareTestHook(false, target, () => null);
		expect(Object.keys(target)).toEqual([]);
		remove();
		expect(Object.keys(target)).toEqual([]);
	});

	it("有効なら、__rondoTest.veryare を作り、片付けで消す", () => {
		const target: Record<string, unknown> = {};
		const remove = installVeryareTestHook(true, target, () => null);
		const hook = target.__rondoTest as { veryare?: { ready(): boolean } };
		expect(hook.veryare?.ready()).toBe(false);
		remove();
		expect(target.__rondoTest).toBeUndefined();
	});

	it("環境変数の名前は NEXT_PUBLIC_RONDO_TEST_HOOKS。本番のビルド（apps/web/Dockerfile）は渡さない", () => {
		expect(TEST_HOOKS_ENV).toBe("NEXT_PUBLIC_RONDO_TEST_HOOKS");
		const dockerfile = readFileSync(
			new URL("../../../Dockerfile", import.meta.url),
			"utf8",
		);
		expect(dockerfile).not.toContain(TEST_HOOKS_ENV);
	});

	it("probeCamera は、守りを当てたカメラの位置と、まわりの実物のメッシュを返す", () => {
		const root = new THREE.Group();
		const wall = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial(),
		);
		wall.name = "壁";
		wall.position.set(1, 1.5, 0);
		root.add(wall);
		const scene: TestableScene = {
			modelShown: () => true,
			cameraPosition: () => ({ x: 0, y: 1.5, z: 0 }),
			guardedCameraAt: () => ({
				position: { x: 0.2, y: 1.5, z: 0 },
				feet: 0.6,
			}),
			modelRoot: () => root,
			furnitureBoxes: () => [
				{
					name: "タンス",
					min: { x: 0, y: 0, z: 0 },
					max: { x: 1, y: 1, z: 1 },
				},
			],
		};
		const target: Record<string, unknown> = {};
		installVeryareTestHook(true, target, () => scene);
		const hook = (
			target.__rondoTest as {
				veryare: {
					ready(): boolean;
					nearClearance: number;
					furniture(): unknown;
					probeCamera(x: number, z: number, yaw: number): unknown;
				};
			}
		).veryare;
		expect(hook.ready()).toBe(true);
		expect(hook.nearClearance).toBe(NEAR_CLEARANCE);
		expect(hook.furniture()).toEqual([
			{ name: "タンス", min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
		]);
		expect(hook.probeCamera(0, 0, 0)).toEqual({
			position: { x: 0.2, y: 1.5, z: 0 },
			feet: 0.6,
			backFaces: 0,
			nearest: expect.closeTo(0.3, 6),
			nearestName: "壁",
		});
	});
});
