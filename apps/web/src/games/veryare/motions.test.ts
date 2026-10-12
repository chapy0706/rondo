import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MOTION_EXTRAS_KEY, parseMotionSet } from "./motions";

const clip = (name: string, duration = 1) =>
	new THREE.AnimationClip(name, duration, [
		new THREE.QuaternionKeyframeTrack(
			"mixamorigHips.quaternion",
			[0, duration],
			[0, 0, 0, 1, 0, 0, 0, 1],
		),
	]);

const group = (userData: unknown, clips: THREE.AnimationClip[]) => {
	const g = new THREE.Group();
	g.userData = userData as Record<string, unknown>;
	g.animations = clips;
	return g;
};

const info = {
	[MOTION_EXTRAS_KEY]: {
		version: 1,
		clips: {
			idle: { duration: 8.333, stride: 0, speed: 0 },
			walk: { duration: 0.967, stride: 1.62, speed: 1.676 },
			run: { duration: 0.567, stride: 2.647, speed: 4.672 },
		},
	},
};

describe("parseMotionSet - 動きの素材（character-motions / issue-57）", () => {
	it("待機・歩く・走るの動きと、標準の速さ（素材の座標）を読む", () => {
		const set = parseMotionSet(
			group(info, [clip("idle", 8.333), clip("walk"), clip("run")]),
		);
		expect(set?.clips.idle.name).toBe("idle");
		expect(set?.clips.walk.name).toBe("walk");
		expect(set?.clips.run.name).toBe("run");
		expect(set?.speeds).toEqual({ walk: 1.676, run: 4.672 });
	});

	it("動きが足りない・extras の形が違う・速さが 0 以下なら null（静止した姿勢のまま）", () => {
		expect(
			parseMotionSet(group(info, [clip("idle"), clip("walk")])),
		).toBeNull();
		expect(
			parseMotionSet(group({}, [clip("idle"), clip("walk"), clip("run")])),
		).toBeNull();
		const slow = {
			[MOTION_EXTRAS_KEY]: {
				...info[MOTION_EXTRAS_KEY],
				clips: {
					...info[MOTION_EXTRAS_KEY].clips,
					walk: { duration: 1, stride: 0, speed: 0 },
				},
			},
		};
		expect(
			parseMotionSet(group(slow, [clip("idle"), clip("walk"), clip("run")])),
		).toBeNull();
	});
});
