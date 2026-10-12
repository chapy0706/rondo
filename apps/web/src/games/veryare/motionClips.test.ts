import { describe, expect, it } from "vitest";
import type { PoseTable } from "./bodyPose";
import { poseClip } from "./motionClips";

const table: PoseTable = {
	standingHeight: 2,
	bindMin: [-0.3, 0, 0],
	bindMax: [0.3, 2, 0],
	joints: ["mixamorig:Hips", "mixamorig:Spine"],
	poses: {
		idle: {
			t: [
				[0, 1, 0],
				[0, 0.1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[0, 0, 0, 1],
			],
			min: [-0.3, 0, 0],
			max: [0.3, 2, 0],
		},
		maleCrouch: {
			t: [
				[0, 0.5, 0],
				[0, 0.1, 0],
			],
			r: [
				[0, 0, 0, 1],
				[Math.SQRT1_2, 0, 0, Math.SQRT1_2],
			],
			s: [
				[1, 1, 1],
				[1.1, 1.1, 1.1],
			],
			min: [-0.3, 0, 0],
			max: [0.3, 1, 1],
		},
	},
};

const nodeNames = new Map([
	["mixamorig:Hips", "mixamorigHips"],
	["mixamorig:Spine", "mixamorigSpine"],
]);

describe("poseClip - ポーズを「1コマだけの動き」にする（issue-57）", () => {
	it("全ての骨の、位置・回転・大きさの3つを入れる（前の動きの姿勢が残らないように）", () => {
		const clip = poseClip(table, "maleCrouch", nodeNames);
		expect(clip.name).toBe("pose:maleCrouch");
		expect(clip.tracks.map((t) => t.name).sort()).toEqual(
			[
				"mixamorigHips.position",
				"mixamorigHips.quaternion",
				"mixamorigHips.scale",
				"mixamorigSpine.position",
				"mixamorigSpine.quaternion",
				"mixamorigSpine.scale",
			].sort(),
		);
		const spine = clip.tracks.find(
			(t) => t.name === "mixamorigSpine.quaternion",
		);
		// 動きの値は Float32 で持つ。
		expect(Array.from(spine?.values ?? [])).toEqual(
			[Math.SQRT1_2, 0, 0, Math.SQRT1_2].map(Math.fround),
		);
		const scale = clip.tracks.find((t) => t.name === "mixamorigSpine.scale");
		expect(Array.from(scale?.values ?? [])).toEqual(
			[1.1, 1.1, 1.1].map(Math.fround),
		);
	});

	it("大きさが表に無いポーズは、大きさ 1 を入れる。表に無いポーズは idle", () => {
		const clip = poseClip(table, "walking", nodeNames);
		expect(clip.name).toBe("pose:walking");
		const hips = clip.tracks.find((t) => t.name === "mixamorigHips.position");
		expect(Array.from(hips?.values ?? [])).toEqual([0, 1, 0]);
		const scale = clip.tracks.find((t) => t.name === "mixamorigHips.scale");
		expect(Array.from(scale?.values ?? [])).toEqual([1, 1, 1]);
	});

	it("1コマだけ（時刻 0）で、長さは 1 秒（繰り返しても同じ姿勢）", () => {
		const clip = poseClip(table, "idle", nodeNames);
		for (const track of clip.tracks)
			expect(Array.from(track.times)).toEqual([0]);
		expect(clip.duration).toBe(1);
	});
});
