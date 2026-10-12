import * as THREE from "three";
import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import skeletons from "../../../../../packages/contracts/src/fixtures/veryare-skeleton-stages.json";
import { parseStageNotice } from "./stage";
import { type StageBox, stageBoxes } from "./stageBoxes";
import {
	STAGE_MATERIAL_KEYS,
	type StageMaterialInfo,
	type StageMaterialKey,
	WALL_MULTIPLY,
	multiplyFactor,
	tintFactor,
} from "./stageMaterials";
import {
	buildSurfaces,
	pickStageMaterials,
	stageLayers,
	surfaceMeshes,
} from "./stageSurfaces";
import { type TexelSource, surfaceColor } from "./surfaceColor";

const grid = parseStageNotice(movement.stage);
if (grid === null) throw new Error("見本が読めない");

const info = Object.fromEntries(
	STAGE_MATERIAL_KEYS.map((key) => [
		key,
		{ tile: key === "tatami" ? [1.8, 1.8] : [1, 1], mean: [0.3, 0.2, 0.1] },
	]),
) as unknown as Record<(typeof STAGE_MATERIAL_KEYS)[number], StageMaterialInfo>;

describe("buildSurfaces - 箱を、材質と寄せる色の組ごとに1つの形にまとめる", () => {
	const boxes = stageBoxes(grid, new Set());
	const groups = buildSurfaces(boxes, info);

	it("組は、材質と寄せる色の組み合わせごと（箱の数と頂点の数が合う）", () => {
		const keys = new Set(
			boxes.map((b) => `${b.material}|${b.tint ?? "-"}|${b.multiply ?? "-"}`),
		);
		expect(groups.map((g) => g.key).sort()).toEqual([...keys].sort());
		for (const group of groups) {
			const members = boxes.filter(
				(b) =>
					b.material === group.material &&
					b.tint === group.tint &&
					b.multiply === group.multiply,
			);
			const vertices = members.reduce(
				(n, b) => n + (b.kind === "floor" || b.kind === "ceiling" ? 4 : 24),
				0,
			);
			expect(group.positions.length / 3, group.key).toBe(vertices);
			expect(group.normals.length / 3).toBe(vertices);
			expect(group.uvs.length / 2).toBe(vertices);
			expect(group.indices.length).toBe((vertices / 4) * 6);
		}
	});

	it("面は外向き（三角形の向きと、法線がそろう）", () => {
		for (const group of groups) {
			const p = group.positions;
			for (let t = 0; t < group.indices.length; t += 3) {
				const [a, b, c] = [0, 1, 2].map((k) => group.indices[t + k] as number);
				const v = (i: number) =>
					new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
				const cross = v(b as number)
					.sub(v(a as number))
					.cross(v(c as number).sub(v(a as number)));
				const n = new THREE.Vector3(
					group.normals[(a as number) * 3],
					group.normals[(a as number) * 3 + 1],
					group.normals[(a as number) * 3 + 2],
				);
				expect(cross.dot(n), group.key).toBeGreaterThan(0);
			}
		}
	});

	it("床は上の面だけ（高さ 0）。UV は、絵の原点からの x・z ÷ 1枚の大きさ（畳は部屋の隅から 1.8 m）", () => {
		const tatami = groups.find((g) => g.material === "tatami");
		if (tatami === undefined) throw new Error("畳が無い");
		for (let i = 0; i < tatami.positions.length / 3; i++) {
			expect(tatami.positions[i * 3 + 1]).toBeCloseTo(0, 9);
			expect(tatami.normals[i * 3 + 1]).toBe(1);
			const x = tatami.positions[i * 3] as number;
			const z = tatami.positions[i * 3 + 2] as number;
			// 和室 A の隅は (2, 0)。
			expect(tatami.uvs[i * 2]).toBeCloseTo((x - 2) / 1.8, 9);
			expect(tatami.uvs[i * 2 + 1]).toBeCloseTo((z - 0) / 1.8, 9);
		}
	});

	it("天井は下を向く面だけ（高さ 2.4 m。法線は −y）。UV は世界の x・z ÷ 1枚の大きさ", () => {
		const ceiling = groups.find(
			(g) => g.material === "wood-board" && g.multiply !== null,
		);
		if (ceiling === undefined) throw new Error("天井が無い");
		for (let i = 0; i < ceiling.positions.length / 3; i++) {
			expect(ceiling.positions[i * 3 + 1]).toBeCloseTo(2.4, 9);
			expect(ceiling.normals[i * 3 + 1]).toBe(-1);
			expect(ceiling.uvs[i * 2]).toBeCloseTo(
				ceiling.positions[i * 3] as number,
				9,
			);
			expect(ceiling.uvs[i * 2 + 1]).toBeCloseTo(
				ceiling.positions[i * 3 + 2] as number,
				9,
			);
		}
	});

	it("隣の箱との継ぎ目で、模様がつながる（同じ位置の頂点は、同じ UV）", () => {
		const board = groups.find((g) => g.material === "wood-board");
		if (board === undefined) throw new Error("板が無い");
		const seen = new Map<string, string>();
		for (let i = 0; i < board.positions.length / 3; i++) {
			const at = [0, 1, 2]
				.map((k) => (board.positions[i * 3 + k] as number).toFixed(6))
				.join(",");
			const uv = [0, 1]
				.map((k) => (board.uvs[i * 2 + k] as number).toFixed(6))
				.join(",");
			const before = seen.get(at);
			if (before !== undefined) expect(uv).toBe(before);
			seen.set(at, uv);
		}
	});

	it("壁の側面の UV は、壁に沿う向きの位置と、高さ（絵の上が上になるよう、v は −高さ）÷ 1枚の大きさ", () => {
		const wall: StageBox = {
			kind: "wall",
			x: 2,
			y: 1.2,
			z: 0.5,
			width: 0.1,
			height: 2.4,
			depth: 1,
			color: "#7a6a58",
			material: "wood-dark",
			tint: null,
			multiply: WALL_MULTIPLY,
			uvOrigin: { x: 0, z: 0 },
		};
		const [group] = buildSurfaces([wall], info);
		if (group === undefined) throw new Error("組が無い");
		// +x を向く面の頂点: u は z（壁に沿う向き）、v は −高さ（絵の上の行が、高い位置に来る）。
		let checked = 0;
		for (let i = 0; i < group.positions.length / 3; i++) {
			if (group.normals[i * 3] !== 1) continue;
			checked += 1;
			expect(group.uvs[i * 2]).toBeCloseTo(
				group.positions[i * 3 + 2] as number,
				9,
			);
			expect(group.uvs[i * 2 + 1]).toBeCloseTo(
				-(group.positions[i * 3 + 1] as number),
				9,
			);
		}
		expect(checked).toBe(4);
	});

	it("描画の呼び出しの数（組の数）は、色ごとの箱の数と同じくらい（10種の骨格で、多くても +2）", () => {
		skeletons.stages.forEach((notice, index) => {
			const g = parseStageNotice(notice);
			if (g === null) throw new Error("見本が読めない");
			const list = stageBoxes(g, new Set());
			const colors = new Set(list.map((b) => b.color)).size;
			expect(
				buildSurfaces(list, info).length,
				`骨格${index + 1}`,
			).toBeLessThanOrEqual(colors + 2);
		});
	});
});

describe("材質を貼った箱のスポイト（surfaceColor が、絵の画素 × 材質の色を拾う）", () => {
	it("床の上から当てると、UV の画素に、材質の色（寄せる色の倍率）を掛けた色", () => {
		const floor: StageBox = {
			kind: "floor",
			x: 0.5,
			y: -0.025,
			z: 0.5,
			width: 1,
			height: 0.05,
			depth: 1,
			color: "#a07850",
			material: "wood-board",
			tint: "#a07850",
			multiply: null,
			uvOrigin: { x: 0, z: 0 },
		};
		const [group] = buildSurfaces([floor], info);
		if (group === undefined) throw new Error("組が無い");
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
		const texture = new THREE.Texture();
		texture.flipY = false;
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		const material = new THREE.MeshStandardMaterial({ map: texture });
		material.color.setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.updateMatrixWorld();
		const raycaster = new THREE.Raycaster(
			new THREE.Vector3(0.25, 3, 0.25),
			new THREE.Vector3(0, -1, 0),
		);
		const [hit] = raycaster.intersectObject(mesh);
		if (hit === undefined) throw new Error("当たらない");
		// 2×2 の絵。uv (0.25, 0.25) は左上の画素（白）。
		const pixels: TexelSource = {
			width: 2,
			height: 2,
			data: [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255],
		};
		const color = surfaceColor(hit, () => pixels);
		// 白（線形 1）× 0.5（線形）→ sRGB で #bcbcbc。
		expect(color).toBe("#bcbcbc");
	});
});

/** 材質の素材（glb を three で読んだ scene）の代わり。 */
function fakeAsset(
	options: { drop?: string; noMap?: string; extras?: unknown } = {},
): THREE.Group {
	const root = new THREE.Group();
	root.userData = options.extras ?? {
		rondoStageMaterials: { version: 1, materials: info },
	};
	for (const key of STAGE_MATERIAL_KEYS) {
		if (key === options.drop) continue;
		const material = new THREE.MeshStandardMaterial({
			map: key === options.noMap ? null : new THREE.Texture(),
		});
		material.name = key;
		root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
	}
	return root;
}

describe("pickStageMaterials - 材質の素材を検証して取り出す（読めなければ色の箱のまま）", () => {
	it("extras が正しく、すべての鍵に色の絵のある材質があれば、取り出す。絵は繰り返して貼る", () => {
		const set = pickStageMaterials(fakeAsset());
		expect(set).not.toBeNull();
		for (const key of STAGE_MATERIAL_KEYS) {
			expect(set?.[key].material.name).toBe(key);
			expect(set?.[key].material.map?.wrapS).toBe(THREE.RepeatWrapping);
			expect(set?.[key].tile).toEqual(info[key].tile);
		}
	});

	it("extras が無い・形が違う、材質が欠ける、色の絵が無いときは null", () => {
		expect(pickStageMaterials(fakeAsset({ extras: {} }))).toBeNull();
		expect(
			pickStageMaterials(
				fakeAsset({ extras: { rondoStageMaterials: { version: 2 } } }),
			),
		).toBeNull();
		expect(pickStageMaterials(fakeAsset({ drop: "doma" }))).toBeNull();
		expect(pickStageMaterials(fakeAsset({ noMap: "tatami" }))).toBeNull();
	});

	it("貼ったメッシュは組ごとに1つ。色の値は、寄せる色の倍率（寄せない組は 1）。絵は共有する", () => {
		const set = pickStageMaterials(fakeAsset());
		if (set === null) throw new Error("読めない");
		const boxes = stageBoxes(grid, new Set());
		const meshes = surfaceMeshes(boxes, set);
		expect(meshes).toHaveLength(buildSurfaces(boxes, info).length);
		for (const mesh of meshes) {
			const material = mesh.material as THREE.MeshStandardMaterial;
			const [name, tint, multiply] = String(mesh.userData.stageMaterial).split(
				"|",
			);
			expect(material.map).toBe(set[name as StageMaterialKey].material.map);
			expect(material).not.toBe(set[name as StageMaterialKey].material);
			const want =
				tint !== "-"
					? tintFactor(tint as string, info[name as StageMaterialKey].mean)
					: multiply !== "-"
						? multiplyFactor(multiply as string)
						: [1, 1, 1];
			expect([material.color.r, material.color.g, material.color.b]).toEqual(
				want.map((v) => expect.closeTo(v, 6)),
			);
		}
	});
});

describe("材質を貼った壁のスポイト（壁の木の色が拾える）", () => {
	it("壁の側面に横から当てると、UV の画素（木の色）× 掛ける色（WALL_MULTIPLY）", () => {
		const set = pickStageMaterials(fakeAsset());
		if (set === null) throw new Error("読めない");
		// (1,0) と (2,0)（廊下と部屋 A）の境の壁。x = 2 に立つ。
		const wall = stageBoxes(grid, new Set()).find(
			(b) =>
				b.kind === "wall" &&
				Math.abs(b.x - 2) < 1e-9 &&
				Math.abs(b.z - 0.5) < 1e-9,
		);
		if (wall === undefined) throw new Error("壁が無い");
		const [mesh] = surfaceMeshes([wall], set);
		if (mesh === undefined) throw new Error("メッシュが無い");
		const map = (mesh.material as THREE.MeshStandardMaterial).map;
		if (map === null) throw new Error("絵が無い");
		map.flipY = false;
		map.colorSpace = THREE.SRGBColorSpace;
		mesh.updateMatrixWorld();
		const raycaster = new THREE.Raycaster(
			new THREE.Vector3(1, 1.2, 0.5),
			new THREE.Vector3(1, 0, 0),
		);
		const [hit] = raycaster.intersectObject(mesh);
		if (hit === undefined) throw new Error("当たらない");
		expect(hit.face?.normal.x).toBe(-1);
		// 一色の木の色の絵（2×2）。
		const wood = [150, 100, 60, 255];
		const pixels: TexelSource = {
			width: 2,
			height: 2,
			data: [...wood, ...wood, ...wood, ...wood],
		};
		const color = surfaceColor(hit, () => pixels);
		const [r, g, b] = multiplyFactor(WALL_MULTIPLY);
		const want = new THREE.Color()
			.setRGB(150 / 255, 100 / 255, 60 / 255, THREE.SRGBColorSpace)
			.multiply(new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace));
		expect(color).toBe(`#${want.getHexString()}`);
		// 木の色（茶色）のまま、暗くなる。
		expect(want.r).toBeGreaterThan(want.b);
	});
});

describe("stageLayers - どの表示を見せるか", () => {
	it("平屋の glb を表示していればそれだけ。材質を貼った箱があればそれ。どちらも無ければ、いまの色の箱", () => {
		expect(stageLayers(true, true)).toEqual({
			model: true,
			surfaces: false,
			boxes: false,
		});
		expect(stageLayers(false, true)).toEqual({
			model: false,
			surfaces: true,
			boxes: false,
		});
		expect(stageLayers(false, false)).toEqual({
			model: false,
			surfaces: false,
			boxes: true,
		});
	});
});
