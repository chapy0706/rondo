/**
 * 隠れ側のポーズ（issue-56）。three を使わない純粋な関数。
 *
 * - 一覧（識別子・表示名）と、CPU・鬼のポーズの値の対応は、共有の見本
 *   （packages/contracts/src/fixtures/veryare-poses.json）から読む。識別子の型は契約の
 *   VERYARE_MODEL_POSES（見本と一致することは、契約のテストが確かめる）
 * - ポーズボタンが選ぶ対象（RANDOM_POSE_POOL）は、識別子の一覧とは別に持つ（あとから「寝る」などを
 *   外せるように）。初期は 23 すべて
 */

import { VERYARE_MODEL_POSES, type VeryareModelPose } from "@rondo/contracts";
import posesFixture from "../../../../../packages/contracts/src/fixtures/veryare-poses.json";
import type { Phase, Role } from "./rules";

/** ポーズが届かない人・未知の値のときの、既定の立ち姿。 */
export const DEFAULT_POSE: VeryareModelPose = "idle";

/** ポーズボタンがランダムに選ぶ対象。 */
export const RANDOM_POSE_POOL: readonly VeryareModelPose[] = [
	...VERYARE_MODEL_POSES,
];

const MODEL_POSES: ReadonlySet<string> = new Set(VERYARE_MODEL_POSES);

const LABELS: ReadonlyMap<string, string> = new Map(
	posesFixture.poses.map((pose) => [pose.id, pose.label]),
);

const CPU_POSES: Readonly<Record<string, string>> = posesFixture.cpu;

/** 素材のポーズの識別子だけを受け付ける（CPU の値・未知の値は null）。 */
export function parseModelPose(value: unknown): VeryareModelPose | null {
	return typeof value === "string" && MODEL_POSES.has(value)
		? (value as VeryareModelPose)
		: null;
}

/**
 * 届いたポーズの値を、素材のポーズにする。素材の識別子はそのまま、CPU・鬼の値（standing など）は
 * 見本の対応で、それ以外は既定の立ち姿。
 */
export function modelPoseOf(value: unknown): VeryareModelPose {
	const direct = parseModelPose(value);
	if (direct !== null) return direct;
	if (typeof value === "string" && Object.hasOwn(CPU_POSES, value)) {
		return parseModelPose(CPU_POSES[value]) ?? DEFAULT_POSE;
	}
	return DEFAULT_POSE;
}

/** 表示名（日本語）。 */
export function poseLabel(pose: VeryareModelPose): string {
	return LABELS.get(pose) ?? pose;
}

/**
 * ポーズボタン: いまのポーズ current と違うポーズを、pool から random（0 以上 1 未満）で選ぶ。
 * current が pool に無ければ、pool のすべてから選ぶ。pool が current だけなら、current のまま。
 */
export function pickNextPose(
	current: VeryareModelPose,
	pool: readonly VeryareModelPose[],
	random: () => number,
): VeryareModelPose {
	const choices = pool.filter((pose) => pose !== current);
	if (choices.length === 0) return current;
	const index = Math.min(
		choices.length - 1,
		Math.max(0, Math.floor(random() * choices.length)),
	);
	return choices[index] as VeryareModelPose;
}

/** ポーズを選んだとき、表示名を出しておく時間（ミリ秒 / issue-57）。 */
export const POSE_NOTICE_MS = 1000;

/**
 * ポーズボタンを使えるか（issue-57）。準備移動とペイントフェーズの隠れ側（観戦でない）で、確定の
 * 電文を送る前まで。待機ルーム（役割が決まる前）と、探索の開始以降は使えない。
 */
export function canChangePose(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly spectator: boolean;
	readonly submitted: boolean;
	/** 動ける隠れ側の規則（ADR 0053）。探索の間も、何度でも選び直せる。 */
	readonly roaming?: boolean;
}): boolean {
	const { phase, role, spectator, submitted } = options;
	if (options.roaming === true) {
		return (
			(phase === "preparation" ||
				phase === "painting" ||
				phase === "exploration") &&
			role === "hider" &&
			!spectator
		);
	}
	return (
		(phase === "preparation" || phase === "painting") &&
		role === "hider" &&
		!spectator &&
		!submitted
	);
}

/** 選んだポーズの表示名を出すか（押した時刻 pressedAt から POSE_NOTICE_MS の間）。 */
export function poseNoticeVisible(
	pressedAt: number | null,
	now: number,
): boolean {
	return pressedAt !== null && now - pressedAt < POSE_NOTICE_MS;
}
