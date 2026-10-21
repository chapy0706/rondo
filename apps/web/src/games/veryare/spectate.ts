/**
 * 観戦の画面（issue-67）の純粋な関数。three と React を使わない。
 *
 * - 観戦者か: 観戦ルームの参加者は CPU だけで、観戦者の自分は参加者の一覧に載らない（サーバーの観戦
 *   ルームの作り）。入った時点の一覧で決める（電文は変えない）
 * - 全員の体: 観戦用の通知（spectate）の actors を、人ごとに時刻つきで持ち（track.ts）、送る間隔の約
 *   1.5 倍だけ遅らせた時刻の位置を補間して描く（待機ルームのメンバーと同じ仕組み / members.ts）
 * - 動き: 待機・歩く・走るは、補間した位置の変化から、体の登録所（motionRegistry.ts）が決める
 *   （issue-57）。ポーズ walking は、ポーズではなく歩く動き。隠れ場所のポーズは、止まってから移る
 * - 追う相手: 鬼が先で、隠れ CPU は参加者の一覧の順に「隠れ 1」「隠れ 2」…。試合が替わっても、選んだ
 *   相手がいれば保ち、いなければ鬼
 */

import type {
	PlayerId,
	PlayerInfo,
	VeryareCpuPose,
	VeryareModelPose,
	VeryareSpectateActor,
	VeryareSpectateLook,
	VeryareSpectateNotice,
	VeryareSpectatePose,
} from "@rondo/contracts";
import { VERYARE_CPU_POSES } from "@rondo/contracts";
import { modelPoseOf } from "./poses";
import { type Outcome, type Phase, yawOfFacing } from "./rules";
import { type TrackSample, pushSample, sampleTrack } from "./track";

/** サーバーが観戦用の通知を確かめる間隔（ミリ秒。room.gleam の spectate_interval_ms）。 */
export const SPECTATE_INTERVAL_MS = 100;

/** 補間の遅れ（ミリ秒）。送る間隔の 1.5 倍の定数。 */
export const SPECTATE_DELAY_MS = SPECTATE_INTERVAL_MS * 1.5;

/**
 * 置き直しの決まり。送る間隔の 2 倍を超えて空いた（止まっていた）ら、前の位置を、新しい通知の送る
 * 間隔ぶん前に置き直す（鬼・メンバーの補間と同じ扱い）。
 */
export const SPECTATE_RESEAT = {
	gapMs: SPECTATE_INTERVAL_MS * 2,
	reseatMs: SPECTATE_INTERVAL_MS,
} as const;

/** 結果を見せてから、次の試合が始まるまで（ミリ秒。room.gleam の spectate_next_game_ms）。 */
export const NEXT_GAME_MS = 10_000;

/** 追う相手のラベル（画面の文言）。 */
export const ONI_LABEL = "鬼";
export function hiderLabel(n: number): string {
	return `隠れ ${n}`;
}

/** 観戦者か。自分がルームにいて、参加者の一覧に載っていなければ、観戦者。 */
export function isSpectating(
	you: PlayerId | null,
	players: readonly PlayerInfo[],
): boolean {
	if (you === null || players.length === 0) return false;
	return !players.some((p) => p.playerId === you);
}

// --- 通知の読み取り ------------------------------------------------------------------

const ACTOR_POSES: readonly string[] = [...VERYARE_CPU_POSES, "walking"];
const LOOK_POSES: readonly string[] = VERYARE_CPU_POSES;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseActor(value: unknown): VeryareSpectateActor | null {
	if (!isRecord(value)) return null;
	const { playerId, x, z, facing, pose } = value;
	if (typeof playerId !== "string") return null;
	if (!isFiniteNumber(x) || !isFiniteNumber(z) || !isFiniteNumber(facing)) {
		return null;
	}
	if (typeof pose !== "string" || !ACTOR_POSES.includes(pose)) return null;
	return { playerId, x, z, facing, pose: pose as VeryareSpectatePose };
}

function parseLook(value: unknown): VeryareSpectateLook | null {
	if (!isRecord(value)) return null;
	const { playerId, pose, paint } = value;
	if (typeof playerId !== "string") return null;
	if (typeof pose !== "string" || !LOOK_POSES.includes(pose)) return null;
	if (!isRecord(paint) || paint.kind !== "uniform") return null;
	if (typeof paint.color !== "string" || !/^#[0-9a-f]{6}$/i.test(paint.color)) {
		return null;
	}
	return {
		playerId,
		pose: pose as VeryareCpuPose,
		paint: { kind: "uniform", color: paint.color },
	};
}

/** 観戦用の通知（unknown）を検証する。形が違えば null。 */
export function parseSpectateNotice(
	payload: unknown,
): VeryareSpectateNotice | null {
	if (!isRecord(payload) || payload.type !== "spectate") return null;
	if (!Array.isArray(payload.actors)) return null;
	const actors: VeryareSpectateActor[] = [];
	for (const entry of payload.actors as unknown[]) {
		const actor = parseActor(entry);
		if (actor === null) return null;
		actors.push(actor);
	}
	if (payload.looks === undefined) return { type: "spectate", actors };
	if (!Array.isArray(payload.looks)) return null;
	const looks: VeryareSpectateLook[] = [];
	for (const entry of payload.looks as unknown[]) {
		const look = parseLook(entry);
		if (look === null) return null;
		looks.push(look);
	}
	return { type: "spectate", actors, looks };
}

// --- 全員の体 ------------------------------------------------------------------------

export interface SpectateEntry {
	readonly track: readonly TrackSample[];
	readonly pose: VeryareSpectatePose;
}

/** 観戦の画面が持つ、全員の体（通知の順）と、隠れ CPU の見た目。 */
export interface SpectateView {
	readonly actors: ReadonlyMap<PlayerId, SpectateEntry>;
	readonly looks: ReadonlyMap<PlayerId, VeryareSpectateLook>;
}

export const EMPTY_SPECTATE: SpectateView = {
	actors: new Map(),
	looks: new Map(),
};

/**
 * 届いた通知を足す。通知に無い人は消す。looks のある通知（試合の最初の 1 通と、入室・復帰）では、
 * 見た目を置き換え、前の位置から補間しない（次の試合で、前の試合の隠れ場所から玄関へ滑らない）。
 */
export function applySpectateNotice(
	current: SpectateView,
	notice: VeryareSpectateNotice,
	at: number,
): SpectateView {
	const fresh = notice.looks !== undefined;
	const actors = new Map<PlayerId, SpectateEntry>();
	for (const actor of notice.actors) {
		const previous = fresh ? undefined : current.actors.get(actor.playerId);
		actors.set(actor.playerId, {
			track: pushSample(
				previous?.track ?? [],
				{ at, x: actor.x, z: actor.z, facing: actor.facing },
				SPECTATE_RESEAT,
			),
			pose: actor.pose,
		});
	}
	const looks =
		notice.looks === undefined
			? current.looks
			: new Map(notice.looks.map((look) => [look.playerId, look]));
	return { actors, looks };
}

/** 描く 1 人。位置と向きは補間済み。color は looks の色（鬼など、無ければ null）。 */
export interface SampledActor {
	readonly id: PlayerId;
	readonly x: number;
	readonly z: number;
	readonly facing: number;
	readonly pose: VeryareSpectatePose;
	readonly color: string | null;
}

/** 時刻 time（遅らせる前の今）の全員。 */
export function sampleSpectate(
	view: SpectateView,
	time: number,
): SampledActor[] {
	const out: SampledActor[] = [];
	for (const [id, entry] of view.actors) {
		const at = sampleTrack(entry.track, time - SPECTATE_DELAY_MS);
		if (at === null) continue;
		out.push({
			id,
			...at,
			pose: entry.pose,
			color: view.looks.get(id)?.paint.color ?? null,
		});
	}
	return out;
}

/**
 * 体に渡す、選んだポーズ。walking は、ポーズではなく歩く動き（null。速さから歩く・走るを決める）。
 * 隠れ場所のポーズは、素材のポーズに対応づける（止まってから、そのポーズへ移る / motionState.ts）。
 */
export function actorChosenPose(
	pose: VeryareSpectatePose,
): VeryareModelPose | null {
	return pose === "walking" ? null : modelPoseOf(pose);
}

// --- 追う相手 ------------------------------------------------------------------------

export interface FollowChoice {
	readonly id: PlayerId;
	readonly label: string;
}

/**
 * 追う相手の選択肢（下の横の選択と、体の上のラベル）。鬼が先で、隠れ CPU は参加者の一覧の順に
 * 「隠れ 1」「隠れ 2」…（鬼を除いた順）。鬼が分からなければ、全員を「隠れ」の番号で並べる。
 */
export function followChoices(
	players: readonly PlayerInfo[],
	oni: PlayerId | null,
): FollowChoice[] {
	const hiders = players
		.filter((p) => p.playerId !== oni)
		.map((p, i) => ({ id: p.playerId, label: hiderLabel(i + 1) }));
	const hasOni = oni !== null && players.some((p) => p.playerId === oni);
	return hasOni ? [{ id: oni, label: ONI_LABEL }, ...hiders] : hiders;
}

/** 試合が替わったとき（と、選択肢が変わったとき）の追う相手。いれば保ち、いなければ鬼（先頭）。 */
export function carryFollow(
	previous: PlayerId | null,
	choices: readonly FollowChoice[],
): PlayerId | null {
	if (previous !== null && choices.some((c) => c.id === previous)) {
		return previous;
	}
	return choices[0]?.id ?? null;
}

/**
 * カメラが追う体。選んだ相手がステージにいれば、その人。まだいなければ（準備移動の間の鬼）、ステージに
 * いる最初の人。誰もいなければ null。
 */
export function cameraTarget(
	follow: PlayerId | null,
	visible: readonly PlayerId[],
): PlayerId | null {
	if (follow !== null && visible.includes(follow)) return follow;
	return visible[0] ?? null;
}

/** カメラの向きを、相手の背後へ寄せる時間の目安（秒。95% を追う時間）。 */
export const FOLLOW_YAW_SECONDS = 0.8;

/**
 * カメラの向き（yaw）を、追う相手の向き facing の背後（yawOfFacing）へ、dt 秒ぶん寄せる。近い回り方で、
 * 指数で寄せる（行き過ぎない）。
 */
export function followYaw(yaw: number, facing: number, dt: number): number {
	if (dt <= 0) return yaw;
	const target = yawOfFacing(facing);
	const diff = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
	const keep = Math.exp(-dt / (FOLLOW_YAW_SECONDS / 3));
	return yaw + diff * (1 - keep);
}

/** 結果を受け取った時刻 endedAt から、次の試合までの残り秒数（切り上げ。0 未満にしない）。 */
export function nextGameSeconds(endedAt: number, now: number): number {
	const left = NEXT_GAME_MS - Math.max(0, now - endedAt);
	return Math.max(0, Math.ceil(left / 1000));
}

// --- 状態の行 ------------------------------------------------------------------------

const PHASE_LABELS: Readonly<Record<Phase, string>> = {
	"oni-selection": "鬼選出",
	preparation: "準備移動",
	painting: "ペイント",
	exploration: "探索",
	reveal: "答え合わせ",
	ended: "結果",
};

const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
	"oni-wins": "鬼の勝ち",
	"hiders-win": "隠れる側の勝ち",
	"not-enough-players": "不成立",
};

/**
 * 状態の行（フェーズと残り時間）。答え合わせと結果には勝敗を添え、結果のときは、残り時間の代わりに
 * 次の試合までの残りを出す。
 */
export function spectateStatus(input: {
	readonly phase: Phase | null;
	readonly remainingSeconds: number | null;
	readonly outcome: Outcome | null;
	readonly nextGameSeconds: number | null;
}): string {
	const { phase, remainingSeconds, outcome, nextGameSeconds } = input;
	if (phase === null) return "試合の始まりを待っています";
	const parts = [PHASE_LABELS[phase]];
	if ((phase === "reveal" || phase === "ended") && outcome !== null) {
		parts.push(OUTCOME_LABELS[outcome]);
	}
	if (phase === "ended") {
		if (nextGameSeconds !== null) {
			parts.push(
				nextGameSeconds > 0
					? `次の試合まで あと ${nextGameSeconds} 秒`
					: "まもなく次の試合",
			);
		}
	} else if (remainingSeconds !== null) {
		parts.push(`残り ${remainingSeconds}秒`);
	}
	return parts.join(" ・");
}
