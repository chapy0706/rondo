/**
 * 待機ルームのほかのメンバー（issue-59 / ADR 0044）。three を使わない純粋な関数。
 *
 * - サーバーは、鬼選出の間だけ、待機ルームにいる人間の参加者の位置・向き・待機ポーズを、変わった
 *   ときだけ 150 ms の間隔で送る（members）。届いた通知を、メンバーごとに時刻つきで持ち（track.ts）、
 *   送る間隔の約 1.5 倍だけ遅らせた時刻の位置を補間して描く
 * - 自分の分は捨てる（自分は手元の位置で描く）。一覧に載らなくなった人（出ていった人）は消す。止まった
 *   人は送られてこないが、最後の位置を保つ（更新が無いことを理由に消さない）
 * - クライアントのフェーズが鬼選出でなければ、遅れて届いた通知を捨てる。ステージに移ったら、他の
 *   メンバーを消す
 * - 動き（待機・歩く・走る・ポーズ）は、補間した位置のフレーム間の変化から速さを求め、issue-57 の
 *   切り替え（motionState.ts）で決める
 */

import type { PlayerId, VeryareWaitingMember } from "@rondo/contracts";
import type { VeryareModelPose } from "@rondo/contracts";
import {
	type BodyAction,
	INITIAL_MOTION,
	type MotionState,
	smoothSpeed,
	stepMotion,
} from "./motionState";
import { parseModelPose } from "./poses";
import type { Phase } from "./rules";
import { type TrackSample, pushSample, sampleTrack } from "./track";

/** サーバーがメンバーの通知を送る間隔（ミリ秒。room.gleam の members_interval_ms）。 */
export const MEMBERS_INTERVAL_MS = 150;

/** 補間の遅れ（ミリ秒）。送る間隔の 1.5 倍の定数。 */
export const MEMBER_DELAY_MS = MEMBERS_INTERVAL_MS * 1.5;

/**
 * 置き直しの決まり。送る間隔の 2 倍を超えて空いた（止まっていた）ら、前の位置を、新しい通知の
 * 送る間隔ぶん前に置き直す（鬼の補間と同じ扱い）。
 */
export const MEMBER_RESEAT = {
	gapMs: MEMBERS_INTERVAL_MS * 2,
	reseatMs: MEMBERS_INTERVAL_MS,
} as const;

/** 描く他のメンバーの上限（定員 5 人から自分を除いた数）。 */
export const MAX_VISIBLE_MEMBERS = 4;

/** メンバー1人の、届いた通知と待機ポーズ。 */
export interface MemberEntry {
	readonly track: readonly TrackSample[];
	readonly pose: VeryareModelPose | null;
}

/** 他のメンバー（通知の順）。 */
export type Members = ReadonlyMap<PlayerId, MemberEntry>;

export const NO_MEMBERS: Members = new Map();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * メンバーの通知（unknown）を検証する。形が違えば null。ポーズは素材のポーズの識別子だけを受け付け、
 * それ以外の値は拒む（サーバーは一覧の識別子だけを送る）。
 */
export function parseMembersNotice(
	payload: unknown,
): readonly VeryareWaitingMember[] | null {
	if (!isRecord(payload) || payload.type !== "members") return null;
	if (!Array.isArray(payload.members)) return null;
	const members: VeryareWaitingMember[] = [];
	for (const entry of payload.members as unknown[]) {
		if (!isRecord(entry)) return null;
		const { playerId, x, z, facing, pose } = entry;
		if (typeof playerId !== "string") return null;
		if (!isFiniteNumber(x) || !isFiniteNumber(z)) return null;
		if (facing !== null && !isFiniteNumber(facing)) return null;
		const chosen = pose === null ? null : parseModelPose(pose);
		if (pose !== null && chosen === null) return null;
		members.push({ playerId, x, z, facing, pose: chosen });
	}
	return members;
}

/**
 * 届いた通知を足す。自分を除き、通知の順に最大 MAX_VISIBLE_MEMBERS 人。一覧に無い人は消す。
 * クライアントのフェーズが鬼選出でなければ、遅れて届いた通知として捨てる（current をそのまま返す）。
 */
export function applyMembersNotice(
	current: Members,
	members: readonly VeryareWaitingMember[],
	context: {
		readonly self: PlayerId | null;
		readonly at: number;
		readonly phase: Phase;
	},
): Members {
	if (context.phase !== "oni-selection") return current;
	const next = new Map<PlayerId, MemberEntry>();
	for (const member of members) {
		if (member.playerId === context.self) continue;
		if (next.size >= MAX_VISIBLE_MEMBERS) break;
		const previous = current.get(member.playerId);
		const facing = member.facing ?? previous?.track.at(-1)?.facing ?? 0;
		next.set(member.playerId, {
			track: pushSample(
				previous?.track ?? [],
				{ at: context.at, x: member.x, z: member.z, facing },
				MEMBER_RESEAT,
			),
			pose: member.pose,
		});
	}
	return next;
}

/** フェーズに合わせる。鬼選出でなければ（ステージに移ったら）、他のメンバーを消す。 */
export function membersInPhase(current: Members, phase: Phase): Members {
	return phase === "oni-selection" ? current : NO_MEMBERS;
}

/** 画面の属性（data-visible-members・data-member-poses）に出す、見えている他のメンバー。 */
export function membersSummary(current: Members): {
	readonly count: number;
	readonly poses: string;
} {
	return {
		count: current.size,
		poses: [...current.values()].map((entry) => entry.pose ?? "-").join(","),
	};
}

/** 描くメンバー1人。位置と向きは補間済み。 */
export interface SampledMember {
	readonly id: PlayerId;
	readonly name: string;
	readonly x: number;
	readonly z: number;
	readonly facing: number;
	readonly pose: VeryareModelPose | null;
}

/** 時刻 time（遅らせる前の今）のメンバー。名前は参加者の一覧（names）から引き、無ければ空。 */
export function sampleMembers(
	current: Members,
	time: number,
	names: ReadonlyMap<PlayerId, string>,
): SampledMember[] {
	const out: SampledMember[] = [];
	for (const [id, entry] of current) {
		const at = sampleTrack(entry.track, time - MEMBER_DELAY_MS);
		if (at === null) continue;
		out.push({ id, name: names.get(id) ?? "", ...at, pose: entry.pose });
	}
	return out;
}

/** メンバー1人の動きの状態（前のフレームの位置・ならした速さ・issue-57 の状態）。 */
export interface MemberMotion {
	readonly last: { readonly x: number; readonly z: number } | null;
	readonly speed: number;
	readonly motion: MotionState;
}

export const INITIAL_MEMBER_MOTION: MemberMotion = {
	last: null,
	speed: 0,
	motion: INITIAL_MOTION,
};

/**
 * 1 フレーム進める。補間した位置 here の、前のフレームからの変化で速さをならし（smoothSpeed）、
 * 待機・歩く・走る・ポーズを決める（stepMotion。止まっていて待機ポーズがあれば、そのポーズ）。
 */
export function stepMemberMotion(
	state: MemberMotion,
	here: { readonly x: number; readonly z: number },
	dt: number,
	pose: VeryareModelPose | null,
): { readonly state: MemberMotion; readonly action: BodyAction } {
	const moved =
		state.last === null
			? 0
			: Math.hypot(here.x - state.last.x, here.z - state.last.z);
	const speed = state.last === null ? 0 : smoothSpeed(state.speed, moved, dt);
	const step = stepMotion(state.motion, {
		speed,
		dt,
		chosen: pose,
		fixed: false,
	});
	return {
		state: { last: { x: here.x, z: here.z }, speed, motion: step.state },
		action: step.action,
	};
}
