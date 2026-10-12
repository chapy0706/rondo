/**
 * テスト用の口（issue-52 の方針 / issue-46 の続き）。テスト用の環境変数
 * NEXT_PUBLIC_RONDO_TEST_HOOKS=1 のときだけ、window.__rondoTest.veryare を作り、ブラウザの E2E
 * （e2e/tests/hiraya-camera.e2e.ts。@hiraya）が、カメラの位置と、まわりの実物のメッシュを数値で読む。
 *
 * 無効のとき（本番の既定）は何も作らない。呼び出し側（Veryare.tsx）は、環境変数が "1" のときだけ、
 * このファイルを動的に読み込む。その条件はビルド時に false に置き換わるので、このファイルと
 * cameraProbe.ts は本番の配るファイルに入らず、画面の挙動も変わらない。
 * 本番のビルド（apps/web/Dockerfile）は、この変数を渡さない（testHooks.test.ts で確かめる）。
 */

import type { Object3D } from "three";
import { Vector3 } from "three";
import type { Vec3 } from "./aim";
import { type FurnitureBox, NEAR_CLEARANCE } from "./cameraGuard";
import { probeSurroundings } from "./cameraProbe";

/** テスト用の環境変数の名前。 */
export const TEST_HOOKS_ENV = "NEXT_PUBLIC_RONDO_TEST_HOOKS";

/** まわりを調べる範囲（メートル）。 */
const PROBE_RANGE = 0.5;

/** 口が読むシーンの機能（scene.ts の VeryareScene の一部）。 */
export interface TestableScene {
	/** 平屋の glb を表示しているか。 */
	modelShown(): boolean;
	/** いまのカメラの位置。 */
	cameraPosition(): Vec3;
	/**
	 * 体が (x, z) にいて、視点の向きが yaw（ラジアン）のときのカメラの位置。描画と同じ守り
	 * （cameraGuard.ts）を当てた、落ち着いたときの位置。feet はそこの床の高さ。
	 */
	guardedCameraAt(
		x: number,
		z: number,
		yaw: number,
	): {
		readonly position: Vec3;
		readonly feet: number;
	} | null;
	/** 表示している平屋の glb の根（表示していなければ null）。 */
	modelRoot(): Object3D | null;
	/** カメラの守りに使っている家具の箱。 */
	furnitureBoxes(): readonly FurnitureBox[];
}

/**
 * window（target）に口を作る。enabled が false なら何もしない。返り値は片付け（口を消す）。
 */
export function installVeryareTestHook(
	enabled: boolean,
	target: Record<string, unknown>,
	scene: () => TestableScene | null,
): () => void {
	if (!enabled) return () => undefined;
	target.__rondoTest = {
		veryare: {
			ready: () => scene()?.modelShown() ?? false,
			camera: () => scene()?.cameraPosition() ?? null,
			nearClearance: NEAR_CLEARANCE,
			furniture: () => scene()?.furnitureBoxes() ?? [],
			probeCamera: (x: number, z: number, yaw: number) => {
				const current = scene();
				const placed = current?.guardedCameraAt(x, z, yaw) ?? null;
				const root = current?.modelRoot() ?? null;
				if (placed === null || root === null) return null;
				const { x: px, y: py, z: pz } = placed.position;
				return {
					...placed,
					...probeSurroundings(root, new Vector3(px, py, pz), PROBE_RANGE),
				};
			},
		},
	};
	return () => {
		Reflect.deleteProperty(target, "__rondoTest");
	};
}
