/**
 * ステージの箱（stageBoxes.ts）に、平屋の材質（stage-materials の素材）を貼って描く形を作る。
 *
 * - 箱を、材質と寄せる色の組ごとに、1つの形（頂点の並び）にまとめる。描画の呼び出しは組の数だけで、
 *   色ごとの InstancedMesh（素材が無いときの表示）と同じくらいになる
 * - 床は上の面だけ（高さ 0）。天井は下を向く面だけ（高さ 2.4 m。UV は世界の x・z）。UV は、絵の原点（畳は部屋の隅。ほかは世界の原点）からの x・z ÷ 1枚の
 *   大きさ。隣の箱との継ぎ目で、模様がつながる
 * - 壁・襖・枠・いつも閉じている戸は、6 面（鴨居の下の面が見えるため）。側面の UV は wallUv（壁に沿う
 *   向きの世界の位置と、−高さ ÷ 1枚の大きさ。木目が絵の縦に走る wood-dark では、壁の木目が縦になる）。
 *   上下の面は x・z。面によっては模様が左右反転するが、木目では目立たない
 * - 色の寄せ（tintFactor）と掛ける色（multiplyFactor）は、材質の色の値に入れる（three の色は線形の値）
 *
 * buildSurfaces は three を使わない純粋関数。素材の検証と three の形・材質を作るのは
 * pickStageMaterials と surfaceMeshes。
 */

import * as THREE from "three";
import type { StageBox } from "./stageBoxes";
import {
	STAGE_MATERIAL_KEYS,
	type StageMaterialInfo,
	type StageMaterialKey,
	floorUv,
	multiplyFactor,
	parseStageMaterials,
	tintFactor,
	wallUv,
} from "./stageMaterials";

/** 材質と寄せる色の組ごとの、まとめた形（three の BufferGeometry にそのまま渡せる並び）。 */
export interface SurfaceGroup {
	/** "材質|寄せる色|掛ける色"（無いときは "-"）。 */
	readonly key: string;
	readonly material: StageMaterialKey;
	readonly tint: string | null;
	readonly multiply: string | null;
	readonly positions: number[];
	readonly normals: number[];
	readonly uvs: number[];
	readonly indices: number[];
}

type Axis = 0 | 1 | 2;

/** 面の向き（法線の軸と符号）と、面の上の2つの軸（u × v = 法線。外から見て反時計回り）。 */
const FACES: readonly { axis: Axis; sign: 1 | -1; u: Axis; v: Axis }[] = [
	{ axis: 0, sign: 1, u: 1, v: 2 },
	{ axis: 0, sign: -1, u: 2, v: 1 },
	{ axis: 1, sign: 1, u: 2, v: 0 },
	{ axis: 1, sign: -1, u: 0, v: 2 },
	{ axis: 2, sign: 1, u: 0, v: 1 },
	{ axis: 2, sign: -1, u: 1, v: 0 },
];
const TOP = FACES[2] as (typeof FACES)[number];
const BOTTOM = FACES[3] as (typeof FACES)[number];

/** 面の頂点の、絵の座標。 */
function uvOf(
	box: StageBox,
	axis: Axis,
	point: readonly [number, number, number],
	tile: readonly [number, number],
): [number, number] {
	const [x, y, z] = point;
	const uv =
		axis === 1
			? floorUv({ x, z }, box.uvOrigin, tile)
			: wallUv(axis === 0 ? z : x, y, tile);
	return [uv.u, uv.v];
}

/** 箱を、材質と寄せる色の組ごとにまとめる。組の並びは、最初に出てきた順。 */
export function buildSurfaces(
	boxes: readonly StageBox[],
	info: Readonly<Record<StageMaterialKey, StageMaterialInfo>>,
): SurfaceGroup[] {
	const groups = new Map<string, SurfaceGroup>();
	for (const box of boxes) {
		const key = `${box.material}|${box.tint ?? "-"}|${box.multiply ?? "-"}`;
		let group = groups.get(key);
		if (group === undefined) {
			group = {
				key,
				material: box.material,
				tint: box.tint,
				multiply: box.multiply,
				positions: [],
				normals: [],
				uvs: [],
				indices: [],
			};
			groups.set(key, group);
		}
		const center = [box.x, box.y, box.z];
		const half = [box.width / 2, box.height / 2, box.depth / 2];
		const faces =
			box.kind === "floor" ? [TOP] : box.kind === "ceiling" ? [BOTTOM] : FACES;
		for (const face of faces) {
			const first = group.positions.length / 3;
			for (const [su, sv] of [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1],
			] as const) {
				const point = [0, 0, 0] as [number, number, number];
				for (const axis of [0, 1, 2] as const) {
					const offset =
						axis === face.axis
							? face.sign * (half[axis] ?? 0)
							: axis === face.u
								? su * (half[axis] ?? 0)
								: sv * (half[axis] ?? 0);
					point[axis] = (center[axis] ?? 0) + offset;
				}
				const normal = [0, 0, 0];
				normal[face.axis] = face.sign;
				group.positions.push(...point);
				group.normals.push(...normal);
				group.uvs.push(...uvOf(box, face.axis, point, info[box.material].tile));
			}
			group.indices.push(
				first,
				first + 1,
				first + 2,
				first,
				first + 2,
				first + 3,
			);
		}
	}
	return [...groups.values()];
}

/** 読めた材質（three の材質と、1枚の大きさ・平均色）。 */
export interface StageMaterialEntry extends StageMaterialInfo {
	readonly material: THREE.MeshStandardMaterial;
}
export type StageMaterialSet = Readonly<
	Record<StageMaterialKey, StageMaterialEntry>
>;

const isKey = (name: string): name is StageMaterialKey =>
	(STAGE_MATERIAL_KEYS as readonly string[]).includes(name);

/**
 * 材質の素材（stage-materials の glb の scene）から、材質を取り出す。scene の extras が正しく、
 * すべての鍵に、色の絵のある材質（材質の名前 = 鍵）があるときだけ。そうでなければ null（色の箱のまま）。
 * 絵は繰り返して貼る。
 */
export function pickStageMaterials(
	root: THREE.Object3D,
): StageMaterialSet | null {
	const info = parseStageMaterials(root.userData);
	if (info === null) return null;
	const found = new Map<StageMaterialKey, THREE.MeshStandardMaterial>();
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		const material: unknown = node.material;
		if (
			material instanceof THREE.MeshStandardMaterial &&
			material.map !== null &&
			isKey(material.name)
		) {
			found.set(material.name, material);
		}
	});
	const entries: [StageMaterialKey, StageMaterialEntry][] = [];
	for (const key of STAGE_MATERIAL_KEYS) {
		const material = found.get(key);
		if (material === undefined) return null;
		for (const texture of [material.map, material.normalMap]) {
			if (texture === null) continue;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.RepeatWrapping;
			texture.needsUpdate = true;
		}
		entries.push([key, { ...info[key], material }]);
	}
	return Object.fromEntries(entries) as Record<
		StageMaterialKey,
		StageMaterialEntry
	>;
}

/**
 * 材質を貼った箱のメッシュ（組ごとに1つ）。材質は、素材の材質を複製し（絵は共有する）、色の値に
 * 寄せる色の倍率か掛ける色を入れる。片付けでは、形と複製した材質だけを捨てる（絵は素材のもの）。
 */
export function surfaceMeshes(
	boxes: readonly StageBox[],
	set: StageMaterialSet,
): THREE.Mesh[] {
	return buildSurfaces(boxes, set).map((group) => {
		const entry = set[group.material];
		const material = entry.material.clone();
		const [r, g, b] =
			group.tint !== null
				? tintFactor(group.tint, entry.mean)
				: group.multiply !== null
					? multiplyFactor(group.multiply)
					: [1, 1, 1];
		material.color.setRGB(r ?? 1, g ?? 1, b ?? 1, THREE.LinearSRGBColorSpace);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(group.positions, 3),
		);
		geometry.setAttribute(
			"normal",
			new THREE.Float32BufferAttribute(group.normals, 3),
		);
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute(group.uvs, 2));
		geometry.setIndex(group.indices);
		geometry.computeBoundingSphere();
		const mesh = new THREE.Mesh(geometry, material);
		mesh.userData.stageMaterial = group.key;
		return mesh;
	});
}

/** どの表示を見せるか（平屋の glb / 材質を貼った箱 / 色の箱）。 */
export function stageLayers(
	modelShown: boolean,
	hasSurfaces: boolean,
): {
	readonly model: boolean;
	readonly surfaces: boolean;
	readonly boxes: boolean;
} {
	if (modelShown) return { model: true, surfaces: false, boxes: false };
	if (hasSurfaces) return { model: false, surfaces: true, boxes: false };
	return { model: false, surfaces: false, boxes: true };
}
