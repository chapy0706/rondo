/**
 * 動きが途中で止まる不具合の回帰テスト（issue-57）。本物の three の AnimationMixer で、待機・歩く・走るに
 * 似せた長さの動きと、1コマのポーズを使い、種を固定した乱数で、状態を数分ぶん切り替え続ける。
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createModelBodyKit } from "./body";
import { POSE_EXTRAS_KEY, type PoseTable } from "./bodyPose";
import type { BodyAction } from "./motionState";
import type { MotionSet } from "./motions";

/** 骨2本（Hips と Spine）と、縦長の板のスキンつきメッシュ。 */
function tinyBody(): THREE.Group {
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

const table: PoseTable = {
	standingHeight: 2,
	bindMin: [-0.3, 0, 0],
	bindMax: [0.3, 2, 0],
	joints: ["mixamorig:Hips", "mixamorig:Spine"],
	poses: { idle: entry(0), maleCrouch: entry(1.2), femaleDance: entry(-0.6) },
};

/** 待機・歩く・走るに似せた動き（長さ 8.333・0.967・0.567 秒。Spine が周期的に揺れる）。 */
function motions(): MotionSet {
	const clip = (name: string, duration: number, amplitude: number) => {
		const times: number[] = [];
		const values: number[] = [];
		const keys = 30;
		for (let i = 0; i <= keys; i++) {
			const t = (duration * i) / keys;
			const angle = amplitude * Math.sin((2 * Math.PI * i) / keys);
			times.push(t);
			values.push(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2));
		}
		return new THREE.AnimationClip(name, -1, [
			new THREE.QuaternionKeyframeTrack(
				"mixamorigSpine.quaternion",
				times,
				values,
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
function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ACTIONS: BodyAction[] = [
	{ kind: "idle" },
	{ kind: "walk" },
	{ kind: "run" },
	{ kind: "pose", pose: "maleCrouch" },
	{ kind: "pose", pose: "femaleDance" },
	{ kind: "pose", pose: "idle" },
];

describe("動きを数分ぶん切り替え続けても、止まらない（回帰テスト / 本物の AnimationMixer）", () => {
	it.each([1, 7, 42])(
		"種 %i: 重みの合計は 1 に近く、NaN が無く、重みの付いた動きの時間と骨の回転が進み続ける",
		(seed) => {
			const kit = createModelBodyKit(
				tinyBody(),
				Object.assign(new THREE.Group(), {
					userData: { [POSE_EXTRAS_KEY]: { version: 1, ...table } },
				}),
				motions(),
			);
			if (kit === null) throw new Error("作れない");
			const body = kit.create(new THREE.Texture(), 0xffffff);
			let spine: THREE.Object3D | null = null;
			body.object.traverse((node) => {
				if (node.name === "mixamorigSpine") spine = node;
			});
			if (spine === null) throw new Error("Spine が無い");
			const next = random(seed);
			const dt = 1 / 60;
			let action: BodyAction = { kind: "idle" };
			let rate = 1;
			let stillSince = 0;
			let lastAngle = Number.NaN;
			let previous = new Map<string, number>();
			const problems: string[] = [];
			// 3 分（60 fps）。切り替えは 0.05〜2 秒ごと（混ぜの途中の切り替えも起きる）。
			let until = 0;
			for (let frame = 0; frame < 60 * 180 && problems.length < 5; frame++) {
				const time = frame * dt;
				if (time >= until) {
					action = ACTIONS[Math.floor(next() * ACTIONS.length)] as BodyAction;
					rate =
						action.kind === "walk"
							? 0.5 + next() * 1.3
							: action.kind === "run"
								? 0.75 + next() * 0.45
								: 1;
					until = time + 0.05 + next() * 1.95;
				}
				body.setAction(action, rate);
				body.update(dt);
				const status = body.motionStatus();
				const weights = status.reduce((sum, s) => sum + s.weight, 0);
				const where = `種 ${seed}・${time.toFixed(2)} 秒・${action.kind}`;
				if (!Number.isFinite(weights) || Math.abs(weights - 1) > 0.02) {
					problems.push(`${where}: 重みの合計 ${weights}`);
				}
				for (const s of status) {
					if (!Number.isFinite(s.time) || !Number.isFinite(s.weight)) {
						problems.push(`${where}: ${s.name} の時間・重みが数でない`);
					}
					const before = previous.get(s.name);
					if (s.weight > 0.01 && before !== undefined && s.time === before) {
						problems.push(`${where}: ${s.name} の時間が進まない（${s.time}）`);
					}
				}
				previous = new Map(status.map((s) => [s.name, s.time]));
				const angle =
					2 *
					Math.asin(
						Math.max(-1, Math.min(1, (spine as THREE.Object3D).quaternion.x)),
					);
				if (!Number.isFinite(angle))
					problems.push(`${where}: 骨の回転が数でない`);
				// 待機・歩く・走るを 0.5 秒以上続けているのに、骨の回転が 0.5 秒変わらなければ、止まっている。
				if (action.kind !== "pose") {
					if (Math.abs(angle - lastAngle) > 1e-7) stillSince = time;
					if (time - stillSince > 0.5 && action.kind !== "idle") {
						problems.push(`${where}: 骨の回転が 0.5 秒変わらない`);
					}
				} else {
					stillSince = time;
				}
				lastAngle = angle;
			}
			expect(problems).toEqual([]);
			body.dispose();
		},
	);
});
