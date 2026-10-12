import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createModelBodyKit, placeholderBodyKit } from "./body";
import { POSE_EXTRAS_KEY, type PoseTable } from "./bodyPose";
import { BODY_HEIGHT } from "./bodySize";

/**
 * 小さな素材の体: 骨2本（Hips が根、Spine が子）と、縦長の板のスキンつきメッシュ。板の下の四角は
 * Hips、上の端は Spine に付く。基準姿勢の高さは 2.0。
 */
function tinyBody(quantScale = 1): THREE.Group {
	const hips = new THREE.Bone();
	hips.name = "mixamorigHips";
	hips.userData.name = "mixamorig:Hips";
	const spine = new THREE.Bone();
	spine.name = "mixamorigSpine";
	spine.userData.name = "mixamorig:Spine";
	spine.position.set(0, 1, 0);
	hips.add(spine);
	// 下の四角（y 0〜1、Hips だけに付く）と、上の四角（y 1〜2。上の2頂点は Spine に付く）。
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(
			[-0.3, 0, 0, 0.3, 0, 0, -0.3, 1, 0, 0.3, 1, 0, -0.3, 2, 0, 0.3, 2, 0].map(
				(v) => v / quantScale,
			),
			3,
		),
	);
	geometry.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
	geometry.setAttribute(
		"skinIndex",
		new THREE.Uint16BufferAttribute(
			[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
			4,
		),
	);
	geometry.setAttribute(
		"skinWeight",
		new THREE.Float32BufferAttribute(
			[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
			4,
		),
	);
	const mesh = new THREE.SkinnedMesh(
		geometry,
		new THREE.MeshStandardMaterial(),
	);
	const root = new THREE.Group();
	root.add(hips, mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton([hips, spine]));
	// 量子化（圧縮）の戻しは、逆バインド行列に入る（gltf-transform の量子化と同じ形）。
	const restore = new THREE.Matrix4().makeScale(
		quantScale,
		quantScale,
		quantScale,
	);
	for (const inverse of mesh.skeleton.boneInverses) inverse.multiply(restore);
	return root;
}

const table = {
	version: 1,
	standingHeight: 2,
	bindMin: [-0.3, 0, 0],
	bindMax: [0.3, 2, 0],
	joints: ["mixamorig:Hips", "mixamorig:Spine"],
	poses: {
		idle: {
			t: [
				[0, 0, 0],
				[0, 1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[0, 0, 0, 1],
			],
			min: [-0.3, 0, 0],
			max: [0.3, 2, 0],
		},
		// 上半分を前（+z）へ 90 度倒す。
		maleCrouch: {
			t: [
				[0, 0, 0],
				[0, 1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[Math.SQRT1_2, 0, 0, Math.SQRT1_2],
			],
			min: [-0.3, 0, 0],
			max: [0.3, 1, 1],
		},
	},
} satisfies { version: 1 } & PoseTable;

const posesGroup = (userData: unknown) => {
	const group = new THREE.Group();
	group.userData = userData as Record<string, unknown>;
	return group;
};

/** 体の前（+z）の遠くから、体の高さ y の点へ向けた線。 */
const rayAt = (object: THREE.Object3D, local: THREE.Vector3) => {
	object.updateMatrixWorld(true);
	const target = object.localToWorld(local.clone());
	return new THREE.Raycaster(
		target.clone().add(new THREE.Vector3(0, 0, 5)),
		new THREE.Vector3(0, 0, -1),
	);
};

describe("placeholderBodyKit - 仮のカプセル（素材が無いとき）", () => {
	it("足もとが原点で、頭は体の高さ 1.6 m。ポーズは変えられない", () => {
		const body = placeholderBodyKit.create(null, 0xff0000);
		const box = new THREE.Box3().setFromObject(body.object);
		expect(box.min.y).toBeCloseTo(0, 6);
		expect(box.max.y).toBeCloseTo(BODY_HEIGHT, 6);
		expect(placeholderBodyKit.posable).toBe(false);
		body.dispose();
	});

	it("前からのタップは u = 0、体の高さの真ん中で v = 0.5", () => {
		const body = placeholderBodyKit.create(new THREE.Texture(), 0xffffff);
		body.object.position.set(1, 0.6, 2);
		const uv = body.pickUv(rayAt(body.object, new THREE.Vector3(0, 0.8, 0)));
		expect(uv?.u).toBeCloseTo(0, 6);
		expect(uv?.v).toBeCloseTo(0.5, 6);
		body.dispose();
	});
});

describe("createModelBodyKit - 素材の体（スキンつき）", () => {
	it("表が壊れている・スキンつきのメッシュが無い・表の骨が体に無いときは作らない（仮のカプセルのまま）", () => {
		expect(createModelBodyKit(tinyBody(), posesGroup({}))).toBeNull();
		expect(
			createModelBodyKit(
				new THREE.Group(),
				posesGroup({ [POSE_EXTRAS_KEY]: table }),
			),
		).toBeNull();
		expect(
			createModelBodyKit(
				tinyBody(),
				posesGroup({
					[POSE_EXTRAS_KEY]: {
						...table,
						joints: ["mixamorig:Hips", "mixamorig:Head"],
					},
				}),
			),
		).toBeNull();
	});

	it("体の高さ 1.6 m にそろえ、足もとを原点に置く。ポーズは変えられる", () => {
		const kit = createModelBodyKit(
			tinyBody(),
			posesGroup({ [POSE_EXTRAS_KEY]: table }),
		);
		if (kit === null) throw new Error("作れない");
		expect(kit.posable).toBe(true);
		const body = kit.create(new THREE.Texture(), 0xffffff);
		const uv = body.pickUv(rayAt(body.object, new THREE.Vector3(0.1, 0.4, 0)));
		// 板の下から 0.4 m（体の高さ 1.6 m の 1/4）の点。
		expect(uv?.v).toBeCloseTo(0.25, 6);
		body.dispose();
	});

	it("ポーズを変えても、体の同じ部分のタップは同じ (u, v)（基準姿勢の位置から求める）", () => {
		const kit = createModelBodyKit(
			tinyBody(),
			posesGroup({ [POSE_EXTRAS_KEY]: table }),
		);
		if (kit === null) throw new Error("作れない");
		const body = kit.create(new THREE.Texture(), 0xffffff);
		// 立ち姿で、下半分（Hips に付く部分）の点をタップする。
		const standing = body.pickUv(
			rayAt(body.object, new THREE.Vector3(0.1, 0.4, 0)),
		);
		body.setPose("maleCrouch");
		body.snap();
		// しゃがむ姿勢でも、下半分は動かないので、同じ点に当たる。
		const crouching = body.pickUv(
			rayAt(body.object, new THREE.Vector3(0.1, 0.4, 0)),
		);
		expect(crouching?.u).toBeCloseTo(standing?.u ?? Number.NaN, 6);
		expect(crouching?.v).toBeCloseTo(standing?.v ?? Number.NaN, 6);
		body.dispose();
	});

	it("ポーズを変えると、補正（足もと・水平の中心）はすぐには飛ばず、update で寄せる", () => {
		const kit = createModelBodyKit(
			tinyBody(),
			posesGroup({ [POSE_EXTRAS_KEY]: table }),
		);
		if (kit === null) throw new Error("作れない");
		const body = kit.create(new THREE.Texture(), 0xffffff);
		const before = new THREE.Box3().setFromObject(body.object, true).min.z;
		body.setPose("maleCrouch");
		body.update(0.01);
		const early = body.offset();
		body.update(1);
		const settled = body.offset();
		// maleCrouch は外接箱の中心が z = 0.5 前にあるので、後ろ（-z）へ寄せる。
		expect(settled.z).toBeLessThan(early.z);
		expect(early.z).toBeLessThan(0);
		expect(Number.isFinite(before)).toBe(true);
		body.dispose();
	});

	it("量子化の戻しが逆バインド行列に入っていても、基準姿勢の位置から (u, v) を求める（実際の素材の形）", () => {
		const kit = createModelBodyKit(
			tinyBody(1 / 512),
			posesGroup({ [POSE_EXTRAS_KEY]: table }),
		);
		if (kit === null) throw new Error("作れない");
		const body = kit.create(new THREE.Texture(), 0xffffff);
		const box = new THREE.Box3().setFromObject(body.object, true);
		expect(box.max.y).toBeCloseTo(BODY_HEIGHT, 4);
		const uv = body.pickUv(rayAt(body.object, new THREE.Vector3(0.1, 0.4, 0)));
		expect(uv?.v).toBeCloseTo(0.25, 6);
		body.dispose();
	});
});
