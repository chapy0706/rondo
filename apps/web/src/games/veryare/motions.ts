/**
 * 動きの素材（character-motions / issue-57）を読む。素材の配信の動きの glb（tools/character_motions.mjs
 * で作る。体のメッシュは持たず、骨の名前のノードと、動き idle・walk・run だけ）を、three の GLTFLoader が
 * 読んだシーンから取り出し、境で検証する。動きはシーンの animations（infrastructure/assets が写す）、
 * 標準の速さは scene の extras（userData）の rondoMotions。
 */

import type * as THREE from "three";
import { z } from "zod";

/** scene の extras（userData）の中の名前。 */
export const MOTION_EXTRAS_KEY = "rondoMotions";

const clipInfo = z.object({
	duration: z.number().finite().positive(),
	stride: z.number().finite().nonnegative(),
	speed: z.number().finite().nonnegative(),
});

const schema = z.object({
	[MOTION_EXTRAS_KEY]: z.object({
		version: z.literal(1),
		clips: z.object({ idle: clipInfo, walk: clipInfo, run: clipInfo }),
	}),
});

export interface MotionSet {
	readonly clips: {
		readonly idle: THREE.AnimationClip;
		readonly walk: THREE.AnimationClip;
		readonly run: THREE.AnimationClip;
	};
	/** 歩く・走るの標準の速さ（素材の scene の座標。m/秒。体の大きさの倍率は、使う側で掛ける）。 */
	readonly speeds: { readonly walk: number; readonly run: number };
}

/** 動きの素材のシーンを検証して読む。動きが足りない、形が違う、速さが 0 以下なら null。 */
export function parseMotionSet(scene: THREE.Object3D): MotionSet | null {
	const result = schema.safeParse(scene.userData);
	if (!result.success) return null;
	const info = result.data[MOTION_EXTRAS_KEY].clips;
	if (info.walk.speed <= 0 || info.run.speed <= 0) return null;
	const byName = new Map(scene.animations.map((clip) => [clip.name, clip]));
	const idle = byName.get("idle");
	const walk = byName.get("walk");
	const run = byName.get("run");
	if (idle === undefined || walk === undefined || run === undefined)
		return null;
	return {
		clips: { idle, walk, run },
		speeds: { walk: info.walk.speed, run: info.run.speed },
	};
}
