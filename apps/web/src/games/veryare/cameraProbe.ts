/**
 * カメラのまわりの、実物のメッシュを調べる（テスト用の口だけが使う / testHooks.ts）。
 *
 * カメラの位置から 26 方向に線を引き、見えている物（surfaceColor.ts の firstVisibleHit と同じく、
 * 隠れている物・透ける物は飛ばす）に最初に当たる面を見る。最初に当たる面が裏向きなら、カメラは
 * その物の中にある。いちばん近い面までの距離と、その物の名前も返す。
 *
 * 片面の材質の裏面は、three のレイキャストでは当たらないので、調べる間だけ両面にして、終わったら
 * 元に戻す（本番の描画では使わない）。
 */

import * as THREE from "three";
import { firstVisibleHit } from "./surfaceColor";

/** 26 方向（立方体の面・辺・角の向き）。 */
export const PROBE_DIRECTIONS: readonly THREE.Vector3[] = (() => {
	const list: THREE.Vector3[] = [];
	for (const x of [-1, 0, 1]) {
		for (const y of [-1, 0, 1]) {
			for (const z of [-1, 0, 1]) {
				if (x === 0 && y === 0 && z === 0) continue;
				list.push(new THREE.Vector3(x, y, z).normalize());
			}
		}
	}
	return list;
})();

export interface SurroundingsProbe {
	/** 最初に当たる面が裏向きだった方向の数（0 でなければ、物の中）。 */
	readonly backFaces: number;
	/** いちばん近い面までの距離（range の内に無ければ null）。 */
	readonly nearest: number | null;
	/** いちばん近い面の物の名前（自分か祖先の、空でない名前）。 */
	readonly nearestName: string | null;
}

function nameOf(object: THREE.Object3D): string {
	for (
		let node: THREE.Object3D | null = object;
		node !== null;
		node = node.parent
	) {
		const original: unknown = node.userData.name;
		if (typeof original === "string" && original !== "") return original;
		if (node.name !== "") return node.name;
	}
	return "(名前なし)";
}

/** root の下の、見えている物を調べる。range より遠い面は見ない。 */
export function probeSurroundings(
	root: THREE.Object3D,
	position: THREE.Vector3,
	range: number,
): SurroundingsProbe {
	const restore: [THREE.Material, THREE.Side][] = [];
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		const materials: unknown[] = Array.isArray(node.material)
			? node.material
			: [node.material];
		for (const material of materials) {
			if (
				material instanceof THREE.Material &&
				material.side !== THREE.DoubleSide
			) {
				restore.push([material, material.side]);
				material.side = THREE.DoubleSide;
			}
		}
	});
	try {
		root.updateMatrixWorld(true);
		const raycaster = new THREE.Raycaster();
		raycaster.far = range;
		let backFaces = 0;
		let nearest: number | null = null;
		let nearestName: string | null = null;
		const normal = new THREE.Vector3();
		for (const direction of PROBE_DIRECTIONS) {
			raycaster.set(position, direction);
			const hit = firstVisibleHit(raycaster.intersectObject(root, true));
			if (hit === null || hit.face == null) continue;
			normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
			if (normal.dot(direction) > 0) backFaces += 1;
			if (nearest === null || hit.distance < nearest) {
				nearest = hit.distance;
				nearestName = nameOf(hit.object);
			}
		}
		return { backFaces, nearest, nearestName };
	} finally {
		for (const [material, side] of restore) material.side = side;
	}
}
