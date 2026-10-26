import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseRoomPropKit, propMeshes, propStats } from "./roomPropKit";
import type { PlacedProp } from "./roomPropLayout";
import {
	PROP_EXTRAS_KEY,
	PROP_KINDS,
	PROP_NODE_PREFIX,
	PROP_SIZES,
	type PropKind,
	type PropSize,
} from "./roomProps";

/** three の GLTFLoader が読んだ形（ノードの元の名前は userData.name、scene の extras は userData）。 */
function kitRoot(
	options: {
		sizes?: Partial<Record<PropKind, PropSize>>;
		omit?: PropKind;
		extras?: unknown;
		parts?: number;
	} = {},
): THREE.Group {
	const root = new THREE.Group();
	root.userData =
		options.extras === undefined
			? {
					[PROP_EXTRAS_KEY]: {
						version: 1,
						props: Object.fromEntries(
							PROP_KINDS.map((kind) => [kind, PROP_SIZES[kind]]),
						),
					},
				}
			: (options.extras as Record<string, unknown>);
	for (const kind of PROP_KINDS) {
		if (kind === options.omit) continue;
		const size = options.sizes?.[kind] ?? PROP_SIZES[kind];
		const node = new THREE.Group();
		node.name = `room-prop${kind}`;
		node.userData = { name: `${PROP_NODE_PREFIX}${kind}`, ...size };
		// 量子化の形: ノードが位置と拡大を持ち、形は -1〜1 の箱（足もとの中心が原点になるように）。
		node.position.set(0, size.height / 2, 0);
		node.scale.set(size.width / 2, size.height / 2, size.depth / 2);
		for (let i = 0; i < (options.parts ?? 1); i++) {
			const mesh = new THREE.Mesh(
				new THREE.BoxGeometry(2, 2, 2),
				new THREE.MeshStandardMaterial({ name: `${kind}-${i}` }),
			);
			node.add(mesh);
		}
		root.add(node);
	}
	return root;
}

const placed = (kind: PropKind, x: number, z: number, yaw = 0): PlacedProp => ({
	room: "A",
	kind,
	x,
	z,
	y: kind === "yunomi" ? PROP_SIZES.chabudai.height : 0,
	yaw,
});

describe("parseRoomPropKit - 小物のキットを読む（形が違えば null。小物なしで動く）", () => {
	it("4 種がそろい、大きさが見込み以下なら、種類ごとの形にする（足もとの中心が原点、メートル）", () => {
		const kit = parseRoomPropKit(kitRoot());
		expect(kit).not.toBeNull();
		for (const kind of PROP_KINDS) {
			const parts = kit?.get(kind) ?? [];
			expect(parts.length, kind).toBe(1);
			const geometry = parts[0]?.geometry as THREE.BufferGeometry;
			geometry.computeBoundingBox();
			const box = geometry.boundingBox as THREE.Box3;
			expect(box.min.y).toBeCloseTo(0, 5);
			expect(box.max.y).toBeCloseTo(PROP_SIZES[kind].height, 5);
			expect(box.max.x - box.min.x).toBeCloseTo(PROP_SIZES[kind].width, 5);
			expect(box.max.z - box.min.z).toBeCloseTo(PROP_SIZES[kind].depth, 5);
		}
	});

	it("足りない種類がある・extras が無い・版が違うときは null", () => {
		expect(parseRoomPropKit(kitRoot({ omit: "tsubo" }))).toBeNull();
		expect(parseRoomPropKit(kitRoot({ extras: {} }))).toBeNull();
		expect(
			parseRoomPropKit(
				kitRoot({ extras: { [PROP_EXTRAS_KEY]: { version: 2, props: {} } } }),
			),
		).toBeNull();
	});

	it("第 1 段階の上限（高さ 0.55 m・長い辺 1.0 m）か、置き方の見込みの大きさを超える小物があれば null", () => {
		expect(
			parseRoomPropKit(
				kitRoot({ sizes: { zaisu: { width: 0.54, depth: 0.4, height: 0.9 } } }),
			),
		).toBeNull();
		expect(
			parseRoomPropKit(
				kitRoot({
					sizes: { chabudai: { width: 2.1, depth: 0.9, height: 0.4 } },
				}),
			),
		).toBeNull();
		expect(
			parseRoomPropKit(
				kitRoot({ sizes: { tsubo: { width: 0.5, depth: 0.5, height: 0.36 } } }),
			),
		).toBeNull();
	});
});

describe("propMeshes - 小物を、種類と材質ごとの InstancedMesh にまとめる", () => {
	it("描画の呼び出しは、種類 × 材質の数。置いた数だけ写しを持つ", () => {
		const kit = parseRoomPropKit(kitRoot({ parts: 2 }));
		if (kit === null) throw new Error("読めない");
		const meshes = propMeshes(kit, [
			placed("chabudai", 1, 2),
			placed("chabudai", 5, 2),
			placed("zaisu", 2, 2, Math.PI / 2),
			placed("yunomi", 1, 2),
		]);
		// ちゃぶ台・座椅子・湯呑み × 材質 2（壺は置いていないので作らない）。
		expect(meshes.length).toBe(6);
		const counts = meshes.map((mesh) => [mesh.name, mesh.count]);
		expect(counts).toEqual([
			["room-prop:chabudai", 2],
			["room-prop:chabudai", 2],
			["room-prop:zaisu", 1],
			["room-prop:zaisu", 1],
			["room-prop:yunomi", 1],
			["room-prop:yunomi", 1],
		]);
	});

	it("写しの位置と向きは、置き方のとおり（湯呑みは、ちゃぶ台の天板の高さ）", () => {
		const kit = parseRoomPropKit(kitRoot());
		if (kit === null) throw new Error("読めない");
		const [chair, cup] = propMeshes(kit, [
			placed("zaisu", 2, 3, Math.PI / 2),
			placed("yunomi", 1, 4),
		]);
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const rotation = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		chair?.getMatrixAt(0, matrix);
		matrix.decompose(position, rotation, scale);
		expect(position.toArray()).toEqual([2, 0, 3]);
		expect(new THREE.Euler().setFromQuaternion(rotation).y).toBeCloseTo(
			Math.PI / 2,
			5,
		);
		cup?.getMatrixAt(0, matrix);
		matrix.decompose(position, rotation, scale);
		expect(position.y).toBeCloseTo(PROP_SIZES.chabudai.height, 5);
	});

	it("置く小物が無ければ、何も作らない", () => {
		const kit = parseRoomPropKit(kitRoot());
		if (kit === null) throw new Error("読めない");
		expect(propMeshes(kit, [])).toEqual([]);
	});
});

describe("propStats - 小物の数と、描く重さ（開発用の記録 / assetTrace.ts）", () => {
	it("小物の数・部屋の数・描画の呼び出しの数・増える三角形の数（写しの数を掛ける）", () => {
		const kit = parseRoomPropKit(kitRoot());
		if (kit === null) throw new Error("読めない");
		const props = [
			placed("chabudai", 1, 2),
			{ ...placed("chabudai", 5, 2), room: "B" },
			placed("yunomi", 1, 2),
		];
		const meshes = propMeshes(kit, props);
		// 箱の形は 12 個の三角形。ちゃぶ台 2 つと湯呑み 1 つ。
		expect(propStats(props, meshes)).toEqual({
			props: 3,
			rooms: 2,
			drawCalls: 2,
			triangles: 36,
		});
	});
});
