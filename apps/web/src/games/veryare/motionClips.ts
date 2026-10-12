/**
 * ポーズの「1コマだけの動き」（issue-57）。ポーズの表（bodyPose.ts）の1つのポーズを、three の
 * AnimationClip にする。待機・歩く・走ると同じ混ぜ方（AnimationMixer のフェード）で、静止した姿勢へ
 * 移るため。全ての骨の位置・回転・大きさを入れる（歩く・走るの動きが動かした骨の姿勢が残らないように）。
 */

import type { VeryareModelPose } from "@rondo/contracts";
import * as THREE from "three";
import type { PoseTable } from "./bodyPose";

/**
 * ポーズ pose の動き。nodeNames は、骨の元の名前（mixamorig:Hips）→ three のノードの名前
 * （GLTFLoader が ":" を除いた mixamorigHips）。表に無いポーズは idle の姿勢。長さは 1 秒（時刻 0 の
 * 1コマだけなので、繰り返しても同じ姿勢）。
 */
export function poseClip(
	table: PoseTable,
	pose: VeryareModelPose,
	nodeNames: ReadonlyMap<string, string>,
): THREE.AnimationClip {
	const entry = table.poses[pose] ?? table.poses.idle;
	const tracks: THREE.KeyframeTrack[] = [];
	table.joints.forEach((joint, i) => {
		const node = nodeNames.get(joint);
		if (node === undefined || entry === undefined) return;
		const t = entry.t[i] ?? [0, 0, 0];
		const r = entry.r[i] ?? [0, 0, 0, 1];
		const s = entry.s?.[i] ?? [1, 1, 1];
		tracks.push(
			new THREE.VectorKeyframeTrack(`${node}.position`, [0], [...t]),
			new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, [0], [...r]),
			new THREE.VectorKeyframeTrack(`${node}.scale`, [0], [...s]),
		);
	});
	return new THREE.AnimationClip(`pose:${pose}`, 1, tracks);
}
