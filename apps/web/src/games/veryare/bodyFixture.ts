/**
 * テストだけが使う、偽の体と動き（issue-57）。画面のコードからは読み込まない（本番の配るファイルに
 * 入らない）。
 *
 * - 体: 骨2本（Hips と Spine）のスキンつきメッシュと、ポーズの表（idle・maleCrouch・femaleDance）
 * - 動き: 素材と同じ構造（scene の extras の rondoMotions と、名前 idle・walk・run の動き。骨ごとの
 *   四元数のトラックと Hips の位置のトラック。長さは素材と同じ 8.333・0.967・0.567 秒）
 */
import * as THREE from "three";
import { type BodyKit, createModelBodyKit } from "./body";
import { POSE_EXTRAS_KEY, type PoseTable } from "./bodyPose";
import { MOTION_EXTRAS_KEY, type MotionSet, parseMotionSet } from "./motions";

/** 骨2本（Hips と Spine）と、縦長の板のスキンつきメッシュ。 */
export function tinyBody(): THREE.Group {
	const hips = new THREE.Bone();
	hips.name = "mixamorigHips";
	hips.userData.name = "mixamorig:Hips";
	const spine = new THREE.Bone();
	spine.name = "mixamorigSpine";
	spine.userData.name = "mixamorig:Spine";
	spine.position.set(0, 1, 0);
	hips.add(spine);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute([-0.3, 0, 0, 0.3, 0, 0, 0, 2, 0], 3),
	);
	geometry.setIndex([0, 1, 2]);
	geometry.setAttribute(
		"skinIndex",
		new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4),
	);
	geometry.setAttribute(
		"skinWeight",
		new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
	);
	const mesh = new THREE.SkinnedMesh(
		geometry,
		new THREE.MeshStandardMaterial(),
	);
	const root = new THREE.Group();
	root.add(hips, mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton([hips, spine]));
	return root;
}

const entry = (angle: number) => ({
	t: [
		[0, 0, 0],
		[0, 1, 0],
	] as [number, number, number][],
	r: [
		[0, 0, 0, 1],
		[Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)],
	] as [number, number, number, number][],
	min: [-0.3, 0, 0] as [number, number, number],
	max: [0.3, 2, 0] as [number, number, number],
});

export const table: PoseTable = {
	standingHeight: 2,
	bindMin: [-0.3, 0, 0],
	bindMax: [0.3, 2, 0],
	joints: ["mixamorig:Hips", "mixamorig:Spine"],
	poses: { idle: entry(0), maleCrouch: entry(1.2), femaleDance: entry(-0.6) },
};

/**
 * 待機・歩く・走るに似せた動き（長さ 8.333・0.967・0.567 秒）。Spine と Hips が、位相を 1/4 周ずらして
 * 周期的に揺れる（素材の動きと同じく、どの瞬間にも、どこかの骨が動いている。1本だけだと、揺れの山で
 * 0.5 秒ほど止まって見える）。
 */
export function motions(): MotionSet {
	const swing = (duration: number, amplitude: number, phase: number) => {
		const times: number[] = [];
		const values: number[] = [];
		const keys = 30;
		for (let i = 0; i <= keys; i++) {
			const t = (duration * i) / keys;
			const angle = amplitude * Math.sin((2 * Math.PI * i) / keys + phase);
			times.push(t);
			values.push(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2));
		}
		return { times, values };
	};
	const clip = (name: string, duration: number, amplitude: number) => {
		const spine = swing(duration, amplitude, 0);
		const hips = swing(duration, amplitude / 2, Math.PI / 2);
		return new THREE.AnimationClip(name, -1, [
			new THREE.QuaternionKeyframeTrack(
				"mixamorigSpine.quaternion",
				spine.times,
				spine.values,
			),
			new THREE.QuaternionKeyframeTrack(
				"mixamorigHips.quaternion",
				hips.times,
				hips.values,
			),
			new THREE.VectorKeyframeTrack(
				"mixamorigHips.position",
				[0, duration],
				[0, 0, 0, 0, 0.02, 0],
			),
		]);
	};
	return {
		clips: {
			idle: clip("idle", 8.333, 0.05),
			walk: clip("walk", 0.967, 0.6),
			run: clip("run", 0.567, 0.9),
		},
		speeds: { walk: 1.676, run: 4.672 },
	};
}

/** 種を固定した乱数（mulberry32）。 */
export function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 素材と同じ構造の、動きの素材の scene（parseMotionSet が読む形）。 */
export function motionScene(): THREE.Group {
	const set = motions();
	const scene = new THREE.Group();
	scene.animations = [set.clips.idle, set.clips.walk, set.clips.run];
	const info = (clip: THREE.AnimationClip, speed: number) => ({
		duration: clip.duration,
		stride: speed * clip.duration,
		speed,
	});
	scene.userData = {
		[MOTION_EXTRAS_KEY]: {
			version: 1,
			clips: {
				idle: info(set.clips.idle, 0),
				walk: info(set.clips.walk, set.speeds.walk),
				run: info(set.clips.run, set.speeds.run),
			},
		},
	};
	return scene;
}

/** ポーズの表の scene。 */
export function poseScene(): THREE.Group {
	return Object.assign(new THREE.Group(), {
		userData: { [POSE_EXTRAS_KEY]: { version: 1, ...table } },
	});
}

/** 偽の素材の体を作る口（動きの素材は、素材と同じ構造の scene を境の検証で読んだもの）。 */
export function fixtureBodyKit(): BodyKit {
	const kit = createModelBodyKit(
		tinyBody(),
		poseScene(),
		parseMotionSet(motionScene()),
	);
	if (kit === null) throw new Error("偽の体が作れない");
	return kit;
}
