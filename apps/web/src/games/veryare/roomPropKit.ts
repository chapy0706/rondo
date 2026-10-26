/**
 * ランダム間取りの和室の小物のキット（room-props / issue-72）を読み、置き方（roomPropLayout.ts）のとおりに
 * 描く形にする。
 *
 * - キットは、three の GLTFLoader が読んだ glb（tools/room_props.mjs で作る）。小物ごとのノード（元の名前は
 *   "room-prop:<種類>"。userData.name に残る）の下のメッシュを、足もとの中心が原点の形（メートル）にする。
 *   量子化（KHR_mesh_quantization）の位置と拡大は、形に焼き込む
 * - 境で検証する: scene の extras（rondoRoomProps）の版、4 種がそろうこと、どの小物も第 1 段階の上限
 *   （roomProps.ts の lowProp）と、置き方が見込む大きさ（PROP_SIZES）以下であること。合わなければ null
 *   （小物なしで動く。警告は出さない）
 * - 描くのは、種類 × 材質ごとに 1 つの InstancedMesh（描画の呼び出しの数を、小物の種類の数ほどに抑える）
 *
 * 小物は見た目だけ。狙い・スポイト・カメラの守りの対象（scene.ts の boxGroup・surfaceGroup・家具の箱）
 * には入れない。
 */

import * as THREE from "three";
import { z } from "zod";
import type { PropStats } from "./assetTrace";
import { originalName } from "./fusumaView";
import type { PlacedProp } from "./roomPropLayout";
import {
	PROP_EXTRAS_KEY,
	PROP_KINDS,
	PROP_NODE_PREFIX,
	PROP_SIZES,
	type PropKind,
	lowProp,
} from "./roomProps";

/** 大きさの見込み（PROP_SIZES）を超えてよい量（m。量子化の誤差）。 */
const SIZE_TOLERANCE = 0.02;

/** 小物の 1 つの材質ぶんの形（足もとの中心が原点、メートル）。 */
export interface PropPart {
	readonly geometry: THREE.BufferGeometry;
	readonly material: THREE.Material;
}

/** 種類ごとの形。 */
export type RoomPropKit = ReadonlyMap<PropKind, readonly PropPart[]>;

const extrasSchema = z.object({
	[PROP_EXTRAS_KEY]: z.object({
		version: z.literal(1),
		props: z.record(z.string(), z.unknown()),
	}),
});

/** 正規化された整数の頂点の値を、小数に戻す（形を焼き込むため）。 */
function floatAttribute(
	attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
	const size = attribute.itemSize;
	const array = new Float32Array(attribute.count * size);
	for (let i = 0; i < attribute.count; i++) {
		for (let k = 0; k < size; k++) {
			array[i * size + k] = attribute.getComponent(i, k);
		}
	}
	return new THREE.BufferAttribute(array, size);
}

/** 小物のノードの下のメッシュを、ノードの親の座標の形にする。 */
function partsOf(node: THREE.Object3D, root: THREE.Object3D): PropPart[] {
	root.updateWorldMatrix(true, true);
	const toRoot = root.matrixWorld.clone().invert();
	const parts: PropPart[] = [];
	node.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		const material: unknown = object.material;
		if (!(material instanceof THREE.Material)) return;
		const source = object.geometry as THREE.BufferGeometry;
		const geometry = new THREE.BufferGeometry();
		for (const name of ["position", "normal", "uv"]) {
			const attribute = source.getAttribute(name);
			if (attribute !== undefined) {
				geometry.setAttribute(name, floatAttribute(attribute));
			}
		}
		const index = source.getIndex();
		if (index !== null) geometry.setIndex(index.clone());
		geometry.applyMatrix4(toRoot.clone().multiply(object.matrixWorld));
		parts.push({ geometry, material });
	});
	return parts;
}

/** 形の大きさが、第 1 段階の上限と、置き方の見込み以下で、足もとの中心が原点か。 */
function fits(kind: PropKind, parts: readonly PropPart[]): boolean {
	const box = new THREE.Box3();
	for (const part of parts) {
		part.geometry.computeBoundingBox();
		if (part.geometry.boundingBox !== null) {
			box.union(part.geometry.boundingBox);
		}
	}
	if (box.isEmpty()) return false;
	const size = {
		width: box.max.x - box.min.x,
		depth: box.max.z - box.min.z,
		height: box.max.y - box.min.y,
	};
	const expected = PROP_SIZES[kind];
	return (
		lowProp(size) &&
		size.width <= expected.width + SIZE_TOLERANCE &&
		size.depth <= expected.depth + SIZE_TOLERANCE &&
		size.height <= expected.height + SIZE_TOLERANCE &&
		Math.abs(box.min.y) <= SIZE_TOLERANCE &&
		Math.abs((box.min.x + box.max.x) / 2) <= SIZE_TOLERANCE &&
		Math.abs((box.min.z + box.max.z) / 2) <= SIZE_TOLERANCE
	);
}

/** キットを読む。形が違えば null（小物なし）。 */
export function parseRoomPropKit(root: THREE.Object3D): RoomPropKit | null {
	if (!extrasSchema.safeParse(root.userData).success) return null;
	const nodes = new Map<string, THREE.Object3D>();
	root.traverse((object) => {
		const name = originalName(object);
		if (name.startsWith(PROP_NODE_PREFIX)) {
			nodes.set(name.slice(PROP_NODE_PREFIX.length), object);
		}
	});
	const kit = new Map<PropKind, readonly PropPart[]>();
	for (const kind of PROP_KINDS) {
		const node = nodes.get(kind);
		if (node === undefined) return null;
		const parts = partsOf(node, root);
		if (parts.length === 0 || !fits(kind, parts)) {
			for (const part of parts) part.geometry.dispose();
			for (const done of kit.values()) {
				for (const part of done) part.geometry.dispose();
			}
			return null;
		}
		kit.set(kind, parts);
	}
	return kit;
}

/**
 * 置いた小物を、種類 × 材質ごとの InstancedMesh にする（種類の並びは PROP_KINDS の順）。形と材質は
 * キットのもの（捨てるときは、InstancedMesh だけを dispose する）。
 */
export function propMeshes(
	kit: RoomPropKit,
	placed: readonly PlacedProp[],
): THREE.InstancedMesh[] {
	const meshes: THREE.InstancedMesh[] = [];
	const matrix = new THREE.Matrix4();
	const rotation = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const one = new THREE.Vector3(1, 1, 1);
	for (const kind of PROP_KINDS) {
		const mine = placed.filter((prop) => prop.kind === kind);
		if (mine.length === 0) continue;
		for (const part of kit.get(kind) ?? []) {
			const mesh = new THREE.InstancedMesh(
				part.geometry,
				part.material,
				mine.length,
			);
			mesh.name = `${PROP_NODE_PREFIX}${kind}`;
			mine.forEach((prop, index) => {
				rotation.setFromAxisAngle(up, prop.yaw);
				matrix.compose(
					new THREE.Vector3(prop.x, prop.y, prop.z),
					rotation,
					one,
				);
				mesh.setMatrixAt(index, matrix);
			});
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingSphere();
			meshes.push(mesh);
		}
	}
	return meshes;
}

/** 置いた小物の数と、描く重さ（描画の呼び出しの数と、増える三角形の数。写しの数も掛けて数える）。 */
export function propStats(
	placed: readonly PlacedProp[],
	meshes: readonly THREE.InstancedMesh[],
): PropStats {
	const triangles = meshes.reduce((sum, mesh) => {
		const geometry = mesh.geometry;
		const count =
			geometry.getIndex()?.count ?? geometry.getAttribute("position").count;
		return sum + (count / 3) * mesh.count;
	}, 0);
	return {
		props: placed.length,
		rooms: new Set(placed.map((prop) => prop.room)).size,
		drawCalls: meshes.length,
		triangles: Math.round(triangles),
	};
}
