/**
 * テスト用の口（issue-52 / issue-46 の続き）。テスト用の環境変数
 * NEXT_PUBLIC_RONDO_TEST_HOOKS=1 のときだけ、window.__rondoTest.veryare を作り、ブラウザの E2E が
 * 3D の状態を数値で読む（canvas のピクセルは比べない）。
 * - カメラの位置と、まわりの実物のメッシュ（e2e/tests/hiraya-camera.e2e.ts。@hiraya）
 * - ゲームの状態（state。フェーズ、自分の位置、視点の向き、開いている襖の数、見えている隠れ側の数、
 *   体が素材か。e2e/tests/extended の E2E）
 * 値は読み取り専用（写しを凍らせて返す）。テストから、ゲームの状態は書き換えない。
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
	/** 自分の体が素材の体か（仮のカプセルなら false）。 */
	bodyPosable(): boolean;
	/** 描いている隠れ側の体（探索の開始の一括配信の後）。 */
	hiderBodies(): readonly unknown[];
}

/** 画面（Veryare.tsx）が持つ、ゲームの状態。 */
export interface VeryareGameState {
	readonly phase: string;
	/** 自分の位置（手元の位置。床の上の x, z）。 */
	readonly position: { readonly x: number; readonly z: number };
	/** 視点の向き（ラジアン）。 */
	readonly yaw: number;
	/** 開いている襖の数。 */
	readonly openDoors: number;
}

/** state が返す形。 */
export interface VeryareTestState extends VeryareGameState {
	readonly visibleHiders: number;
	readonly body: "asset" | "placeholder";
}

/**
 * window（target）に口を作る。enabled が false なら何もしない。返り値は片付け（口を消す）。
 */
export function installVeryareTestHook(
	enabled: boolean,
	target: Record<string, unknown>,
	scene: () => TestableScene | null,
	game: () => VeryareGameState | null = () => null,
): () => void {
	if (!enabled) return () => undefined;
	target.__rondoTest = {
		veryare: {
			ready: () => scene()?.modelShown() ?? false,
			state: (): VeryareTestState | null => {
				const current = scene();
				const now = game();
				if (current === null || now === null) return null;
				return Object.freeze({
					phase: now.phase,
					position: Object.freeze({ x: now.position.x, z: now.position.z }),
					yaw: now.yaw,
					openDoors: now.openDoors,
					visibleHiders: current.hiderBodies().length,
					body: current.bodyPosable() ? "asset" : "placeholder",
				});
			},
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
