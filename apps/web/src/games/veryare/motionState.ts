/**
 * 体の動きの状態（issue-57）。待機・歩く・走る・ポーズの切り替えと、再生の速さ、進んだ距離からの
 * 速さ。three を使わない純粋な関数で、時間は dt（秒）で受け取る。
 *
 * - 待機・歩く・走るは、速さから決める。ばたつかないよう、上がるときと下がるときのしきい値を変える
 * - ポーズ（選んだポーズの静止した姿勢）は、止まって STILL_BEFORE_POSE_SECONDS たってから移る。
 *   止まっているときにポーズを選び直したら、すぐ移る。動き出したら、歩く・走るに戻る。ポーズを選んで
 *   いない人は、止まっていれば待機の動き
 * - 静止の指定（fixed。ペイントフェーズ・確定のあと）は、動いていても、選んだポーズ（なければ idle）
 * - 再生の速さは、実際の速さ ÷ 標準の速さ（足が地面を滑らないように）。範囲で抑える。待機は 1 倍
 */

import type { VeryareModelPose } from "@rondo/contracts";

export type Gait = "idle" | "walk" | "run";

/** 待機 → 歩く（m/秒。以上で歩く）。 */
export const IDLE_TO_WALK = 0.3;
/** 歩く → 待機（m/秒。未満で待機）。 */
export const WALK_TO_IDLE = 0.15;
/** 歩く → 走る（m/秒。以上で走る。歩く・走るの標準の速さの中間）。 */
export const WALK_TO_RUN = 2.8;
/** 走る → 歩く（m/秒。未満で歩く）。 */
export const RUN_TO_WALK = 2.4;
/** 再生の速さの範囲（標準の速さとの比）。 */
export const WALK_RATE = { min: 0.5, max: 1.8 } as const;
export const RUN_RATE = { min: 0.75, max: 1.2 } as const;
/** 動きを切り替えるとき、混ぜる時間（秒）。 */
export const MOTION_FADE_SECONDS = 0.2;
/** 速さを、進んだ距離からならす時間（秒。95% を追う時間）。 */
export const SPEED_SMOOTH_SECONDS = 0.15;
/** 止まってから、選んだポーズへ移るまでの時間（秒）。 */
export const STILL_BEFORE_POSE_SECONDS = 0.3;

/** いまの状態 previous と速さ speed から、次の待機・歩く・走る。 */
export function nextGait(previous: Gait, speed: number): Gait {
	switch (previous) {
		case "idle":
			if (speed >= WALK_TO_RUN) return "run";
			return speed >= IDLE_TO_WALK ? "walk" : "idle";
		case "walk":
			if (speed >= WALK_TO_RUN) return "run";
			return speed < WALK_TO_IDLE ? "idle" : "walk";
		case "run":
			if (speed < WALK_TO_IDLE) return "idle";
			return speed < RUN_TO_WALK ? "walk" : "run";
	}
}

/** 再生の速さ。native は歩く・走るの標準の速さ（m/秒）。 */
export function playbackRate(
	gait: Gait,
	speed: number,
	native: { readonly walk: number; readonly run: number },
): number {
	if (gait === "idle") return 1;
	const range = gait === "walk" ? WALK_RATE : RUN_RATE;
	const base = gait === "walk" ? native.walk : native.run;
	if (base <= 0) return 1;
	return Math.min(range.max, Math.max(range.min, speed / base));
}

/** いまの速さ previous を、dt 秒で distance 進んだ速さへ寄せる（指数の追従。行き過ぎない）。 */
export function smoothSpeed(
	previous: number,
	distance: number,
	dtSeconds: number,
): number {
	if (dtSeconds <= 0) return previous;
	const target = distance / dtSeconds;
	return (
		target +
		(previous - target) * Math.exp(-dtSeconds / (SPEED_SMOOTH_SECONDS / 3))
	);
}

/** 体に当てる動き。 */
export type BodyAction =
	| { readonly kind: Gait }
	| { readonly kind: "pose"; readonly pose: VeryareModelPose };

export interface MotionState {
	readonly gait: Gait;
	/** 止まっている時間（秒）。動いている間は 0。 */
	readonly stillSeconds: number;
	/** 前の一歩で選ばれていたポーズ（選び直しを見分ける）。 */
	readonly chosen: VeryareModelPose | null;
}

export const INITIAL_MOTION: MotionState = {
	gait: "idle",
	stillSeconds: 0,
	chosen: null,
};

/**
 * 一歩進める。speed はならした速さ、chosen は選んだポーズ（選んでいなければ null）、fixed は静止の
 * 指定（ペイントフェーズ・確定のあと）。
 */
export function stepMotion(
	state: MotionState,
	input: {
		readonly speed: number;
		readonly dt: number;
		readonly chosen: VeryareModelPose | null;
		readonly fixed: boolean;
	},
): { readonly state: MotionState; readonly action: BodyAction } {
	const { speed, dt, chosen, fixed } = input;
	if (fixed) {
		return {
			state: { gait: "idle", stillSeconds: STILL_BEFORE_POSE_SECONDS, chosen },
			action: { kind: "pose", pose: chosen ?? "idle" },
		};
	}
	const gait = nextGait(state.gait, speed);
	if (gait !== "idle") {
		return { state: { gait, stillSeconds: 0, chosen }, action: { kind: gait } };
	}
	let still = state.stillSeconds + Math.max(0, dt);
	// 止まっているときに選び直したら、待たずに移る。
	if (chosen !== null && chosen !== state.chosen) {
		still = Math.max(still, STILL_BEFORE_POSE_SECONDS);
	}
	const action: BodyAction =
		chosen !== null && still >= STILL_BEFORE_POSE_SECONDS
			? { kind: "pose", pose: chosen }
			: { kind: "idle" };
	return { state: { gait, stillSeconds: still, chosen }, action };
}

/**
 * 開発中だけ Console に出す、体の動きの1行（issue-57。動きが止まる不具合を、目視で見つけるため）。
 * status は体の動きごとの時間・重み（body.ts の motionStatus）。重みの付いた動きだけを出す。
 */
export function motionLogMessage(
	label: string,
	info: {
		readonly action: BodyAction;
		readonly speed: number;
		readonly rate: number;
		readonly status: readonly {
			readonly name: string;
			readonly time: number;
			readonly weight: number;
		}[];
	},
): string {
	const state =
		info.action.kind === "pose" ? `pose:${info.action.pose}` : info.action.kind;
	const weighted = info.status.filter((s) => s.weight > 0);
	const parts =
		weighted.length === 0
			? "動きなし（静止した姿勢）"
			: weighted
					.map(
						(s) =>
							`${s.name} 時間 ${s.time.toFixed(2)} 重み ${s.weight.toFixed(2)}`,
					)
					.join("、");
	return `[veryare-motion] ${label}: ${state}（速さ ${info.speed.toFixed(2)} m/秒・再生 ${info.rate.toFixed(2)} 倍）・${parts}`;
}
