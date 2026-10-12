import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createModelBodyKit, placeholderBodyKit } from "./body";
import { POSE_EXTRAS_KEY, type PoseTable } from "./bodyPose";
import { BODY_HEIGHT } from "./bodySize";
import type { MotionSet } from "./motions";

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

// --- 動き（issue-57） -------------------------------------------------------------------

/** 偽の動き: 待機は Spine を少し傾けたまま、歩く・走るは Spine を回し、大きさと位置も変える。 */
function fakeMotions(): MotionSet {
	const turn = (deg: number) => {
		const q = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(1, 0, 0),
			(deg * Math.PI) / 180,
		);
		return [q.x, q.y, q.z, q.w];
	};
	const walk = new THREE.AnimationClip("walk", 1, [
		new THREE.QuaternionKeyframeTrack(
			"mixamorigSpine.quaternion",
			[0, 0.5, 1],
			[...turn(0), ...turn(60), ...turn(0)],
		),
		new THREE.VectorKeyframeTrack(
			"mixamorigSpine.scale",
			[0, 1],
			[1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
		),
		new THREE.VectorKeyframeTrack(
			"mixamorigSpine.position",
			[0, 1],
			[0, 1.3, 0, 0, 1.3, 0],
		),
	]);
	const idle = new THREE.AnimationClip("idle", 1, [
		new THREE.QuaternionKeyframeTrack(
			"mixamorigSpine.quaternion",
			[0, 1],
			[...turn(5), ...turn(5)],
		),
	]);
	const run = walk.clone();
	run.name = "run";
	return { clips: { idle, walk, run }, speeds: { walk: 1.676, run: 4.672 } };
}

const spineOf = (body: { object: THREE.Object3D }) => {
	let spine: THREE.Object3D | null = null;
	body.object.traverse((node) => {
		if (node.name === "mixamorigSpine") spine = node;
	});
	if (spine === null) throw new Error("Spine が無い");
	return spine as THREE.Object3D;
};

const angleOf = (node: THREE.Object3D) =>
	(2 * Math.acos(Math.min(1, Math.abs(node.quaternion.w))) * 180) / Math.PI;

describe("体の動き（issue-57。AnimationMixer。偽の骨と偽の動き）", () => {
	const kitWith = (motions: MotionSet | null) => {
		const kit = createModelBodyKit(
			tinyBody(),
			posesGroup({ [POSE_EXTRAS_KEY]: table }),
			motions,
		);
		if (kit === null) throw new Error("作れない");
		return kit;
	};

	it("動きの素材があれば、歩く動きが骨に当たる。標準の速さは体の倍率を掛けた値", () => {
		const kit = kitWith(fakeMotions());
		expect(kit.motionSpeeds?.walk).toBeCloseTo(1.676 * (BODY_HEIGHT / 2), 9);
		const body = kit.create(new THREE.Texture(), 0xffffff);
		body.setAction({ kind: "walk" }, 1);
		body.snap();
		body.update(0.5);
		expect(angleOf(spineOf(body))).toBeCloseTo(60, 3);
		body.dispose();
	});

	it("再生の速さで、動きの進み方が変わる（2 倍なら、半分の時間で同じ姿勢）", () => {
		const kit = kitWith(fakeMotions());
		const body = kit.create(new THREE.Texture(), 0xffffff);
		body.setAction({ kind: "walk" }, 2);
		body.snap();
		body.update(0.25);
		expect(angleOf(spineOf(body))).toBeCloseTo(60, 3);
		body.dispose();
	});

	it("歩くからポーズへ 0.2 秒で混ぜる。混ぜ終わると、前の動きの位置・回転・大きさが残らない", () => {
		const kit = kitWith(fakeMotions());
		const body = kit.create(new THREE.Texture(), 0xffffff);
		body.setAction({ kind: "walk" }, 1);
		body.snap();
		body.update(0.5);
		body.setAction({ kind: "pose", pose: "maleCrouch" }, 1);
		body.update(0.1);
		const mid = angleOf(spineOf(body));
		// 混ぜている途中（歩くの 60° と、ポーズの 90° の間）。
		expect(mid).toBeGreaterThan(60);
		expect(mid).toBeLessThan(90);
		body.update(0.3);
		const spine = spineOf(body);
		expect(angleOf(spine)).toBeCloseTo(90, 3);
		expect(spine.scale.x).toBeCloseTo(1, 6);
		expect(spine.position.y).toBeCloseTo(1, 6);
		body.dispose();
	});

	it("動きの素材が無ければ、歩く・走るでも、静止した姿勢（idle）のまま。ポーズは静止した姿勢で当てる", () => {
		const kit = kitWith(null);
		expect(kit.motionSpeeds).toBeNull();
		const body = kit.create(new THREE.Texture(), 0xffffff);
		body.setAction({ kind: "run" }, 1);
		body.update(0.5);
		expect(angleOf(spineOf(body))).toBeCloseTo(0, 6);
		body.setAction({ kind: "pose", pose: "maleCrouch" }, 1);
		body.update(0.5);
		expect(angleOf(spineOf(body))).toBeCloseTo(90, 3);
		body.dispose();
	});

	it("仮のカプセルは、動きを付けない（何を設定しても、そのまま）", () => {
		expect(placeholderBodyKit.motionSpeeds).toBeNull();
		const body = placeholderBodyKit.create(null, 0xffffff);
		const before = body.object.children.map((c) => c.position.clone());
		body.setAction({ kind: "run" }, 1.2);
		body.update(0.5);
		expect(body.object.children.map((c) => c.position)).toEqual(before);
		body.dispose();
	});
});
