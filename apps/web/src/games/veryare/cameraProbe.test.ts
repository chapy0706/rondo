import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PROBE_DIRECTIONS, probeSurroundings } from "./cameraProbe";

/** 中心 (cx, cy, cz)、一辺 size の箱のメッシュ（外向きの面。材質は片面）。 */
const cube = (name: string, size: number, at: [number, number, number]) => {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(size, size, size),
		new THREE.MeshStandardMaterial(),
	);
	mesh.name = name;
	mesh.position.set(...at);
	return mesh;
};

describe("probeSurroundings - カメラのまわりの、実物のメッシュ（テスト用の口 / issue-46 の続き）", () => {
	it("26 方向に線を引く", () => {
		expect(PROBE_DIRECTIONS).toHaveLength(26);
		for (const d of PROBE_DIRECTIONS) expect(d.length()).toBeCloseTo(1, 9);
	});

	it("メッシュの外なら、裏向きの面は 0。いちばん近い面までの距離と、その物の名前", () => {
		const root = new THREE.Group();
		root.add(cube("タンス", 1, [1, 0, 0]));
		root.updateMatrixWorld(true);
		const probe = probeSurroundings(root, new THREE.Vector3(0, 0, 0), 1);
		expect(probe.backFaces).toBe(0);
		expect(probe.nearest).toBeCloseTo(0.5, 6);
		expect(probe.nearestName).toBe("タンス");
	});

	it("メッシュの中なら、最初に当たる面が裏向きの方向を数える（片面の材質でも数える）", () => {
		const root = new THREE.Group();
		const box = cube("壁", 1, [0, 0, 0]);
		root.add(box);
		root.updateMatrixWorld(true);
		const probe = probeSurroundings(root, new THREE.Vector3(0, 0, 0), 2);
		expect(probe.backFaces).toBe(26);
		// 調べたあとは、材質の面の設定を元に戻す。
		expect((box.material as THREE.Material).side).toBe(THREE.FrontSide);
	});

	it("見えない物（祖先が隠れている屋根など）と、透ける物は数えない。範囲の外は null", () => {
		const root = new THREE.Group();
		const roof = new THREE.Group();
		roof.visible = false;
		roof.add(cube("屋根", 1, [0, 0, 0]));
		const glass = cube("ガラス", 1, [0, 0, 0]);
		glass.material = new THREE.MeshStandardMaterial({
			transparent: true,
			opacity: 0.2,
		});
		root.add(roof, glass);
		root.updateMatrixWorld(true);
		const probe = probeSurroundings(root, new THREE.Vector3(0, 0, 0), 2);
		expect(probe.backFaces).toBe(0);
		expect(probe.nearest).toBeNull();
		expect(probe.nearestName).toBeNull();
	});
});
