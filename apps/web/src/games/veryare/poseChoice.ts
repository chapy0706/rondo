/**
 * 選んだポーズの持ち方（issue-59 / ADR 0044）。three を使わない純粋な関数。
 *
 * 待機ポーズ（待機ルームで選ぶ、同期する飾りの状態）と、ゲームの隠れ側のポーズ（ペイントの確定で
 * 送る）は、別の変数に持つ。待機で見えたポーズが、そのまま隠れ側のポーズとして鬼に知られないよう、
 * ステージに移ったら、ゲーム用の選んだポーズは null に戻し、待機のポーズを引き継がない。
 */

import type {
	VeryareModelPose,
	VeryareWaitingPoseEvent,
} from "@rondo/contracts";
import type { Phase, Role, Space } from "./rules";

export interface PoseChoice {
	/** 待機ルームで選んだポーズ（選んでいなければ null）。 */
	readonly waiting: VeryareModelPose | null;
	/** ゲームの隠れ側として選んだポーズ（選んでいなければ null）。 */
	readonly game: VeryareModelPose | null;
}

export const NO_POSE_CHOICE: PoseChoice = { waiting: null, game: null };

/** 待機ポーズの変更をあける間（ミリ秒）。サーバーの waiting_pose_interval_ms と同じ。 */
export const WAITING_POSE_INTERVAL_MS = 300;

export function chooseWaitingPose(
	choice: PoseChoice,
	pose: VeryareModelPose,
): PoseChoice {
	return { ...choice, waiting: pose };
}

export function chooseGamePose(
	choice: PoseChoice,
	pose: VeryareModelPose,
): PoseChoice {
	return { ...choice, game: pose };
}

/**
 * 空間に入ったとき。ステージでは、待機のポーズを捨て、ゲーム用も null から始める。待機ルームでは、
 * 待機のポーズを保ち、ゲーム用は null。
 */
export function enterSpace(choice: PoseChoice, space: Space): PoseChoice {
	return space === "stage"
		? NO_POSE_CHOICE
		: { waiting: choice.waiting, game: null };
}

/** 自分の体に当てるポーズ。待機ルームでは待機のポーズ、ステージではゲーム用。 */
export function avatarPoseOf(
	choice: PoseChoice,
	space: Space,
): VeryareModelPose | null {
	return space === "waiting-room" ? choice.waiting : choice.game;
}

/**
 * 自分の体を、選んだポーズ（なければ idle）の静止した姿勢に固定するか（issue-57）。隠れ側は、ペイント
 * フェーズに入ったら固定する（確定のあとも。動かないのが、隠れる遊びの前提のため）。鬼は固定しない。
 */
export function avatarPoseFixed(
	phase: Phase,
	role: Role,
	roaming = false,
): boolean {
	// 動ける隠れ側の規則（ADR 0053）では、ペイントと探索の間も歩く・走る（止まると選んだポーズ）。
	if (roaming && (phase === "painting" || phase === "exploration")) {
		return false;
	}
	return (
		role === "hider" &&
		(phase === "painting" ||
			phase === "exploration" ||
			phase === "reveal" ||
			phase === "ended")
	);
}

/**
 * 待機ルームのポーズボタンを押せるか。鬼選出の間、待機ルームで、素材の体のとき。押したら
 * WAITING_POSE_INTERVAL_MS だけ押せない（サーバーの間と、そろえる）。
 */
export function canChangeWaitingPose(options: {
	readonly phase: Phase;
	readonly space: Space;
	readonly posable: boolean;
	readonly now: number;
	readonly lastPressedAt: number | null;
}): boolean {
	const { phase, space, posable, now, lastPressedAt } = options;
	return (
		phase === "oni-selection" &&
		space === "waiting-room" &&
		posable &&
		(lastPressedAt === null || now - lastPressedAt >= WAITING_POSE_INTERVAL_MS)
	);
}

/** 待機ポーズの変更の電文（契約の VeryareWaitingPoseEvent）。 */
export function waitingPoseEvent(
	pose: VeryareModelPose,
): VeryareWaitingPoseEvent {
	return { type: "waiting-pose", pose };
}
