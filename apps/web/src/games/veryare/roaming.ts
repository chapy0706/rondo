/**
 * 動ける隠れ側の規則（ADR 0053）の、画面の側の規則。three と React を使わない純粋な関数。
 *
 * - ルーム情報（room-info）の roaming: true で、このルームの規則を知る。無ければ従来の規則
 * - 動ける規則では、まだ隠れている隠れ側が、ペイントと探索の間も動ける（歩く速さは ROAMING_HIDER_SPEED）
 * - 動く隠れ側の通知（roaming）は、隠れ側ごとに時刻つきで持ち（track.ts）、送る間隔の約 1.5 倍だけ
 *   遅らせた時刻の位置を補間して描く（待機ルームのメンバーと同じ / members.ts）。自分の分は捨てる
 * - 見た目の通知（look）は、探索の開始に届いた隠れ側の状態の、その人の見た目を置き換える
 * - 自分の見た目（ペイントとポーズ）は、変わったら、LOOK_SEND_INTERVAL_MS より短くない間で送る
 */

import type {
	PlayerId,
	VeryareHiderState,
	VeryareLookNotice,
	VeryareModelPose,
	VeryareRoamingHider,
	VeryareStroke,
} from "@rondo/contracts";
import { VERYARE_ROAMING } from "@rondo/contracts";
import { devUrlParams, urlNumber } from "./camera";
import { WALK_SPEED } from "./motion";
import { parsePaint } from "./paint";
import { parseModelPose } from "./poses";
import type { Phase, Role } from "./rules";
import { type TrackSample, pushSample, sampleTrack } from "./track";

/**
 * 動ける規則の、ペイントと探索の間の隠れ側の歩く速さ（m/秒）。鬼（WALK_SPEED 4.5 m/秒）より遅い。
 * 実際に遊んで調整する前提の初期値（開発用の合図があれば URL で変えられる / roamingSettings）。
 */
export const ROAMING_HIDER_SPEED = 3.0;

/** URL で変えられる、隠れ側の歩く速さの範囲（m/秒）。 */
const HIDER_SPEED_RANGE = { min: 0.5, max: 6 } as const;

/**
 * 動ける規則の隠れ側の歩く速さ（m/秒）。開発用の合図（dev、または URL の ?roof=1）があるときだけ、URL の
 * ?hiderSpeed=2.5 で変える（カメラの定数と同じ仕組み / camera.ts）。無い・範囲の外なら ROAMING_HIDER_SPEED。
 * 襖が開く距離は、サーバーが判定するので、ここでは変えない（game.gleam の auto_door_reach）。
 */
export function roamingHiderSpeed(dev: boolean, search: string): number {
	const params = devUrlParams(dev, search);
	if (params === null) return ROAMING_HIDER_SPEED;
	return (
		urlNumber(
			params,
			"hiderSpeed",
			HIDER_SPEED_RANGE.min,
			HIDER_SPEED_RANGE.max,
		) ?? ROAMING_HIDER_SPEED
	);
}

/** サーバーが動く隠れ側の通知を送る間隔（ミリ秒。room.gleam の roaming_interval_ms）。 */
export const ROAMING_INTERVAL_MS = 120;

/** 補間の遅れ（ミリ秒）。送る間隔の 1.5 倍の定数。 */
export const ROAMING_DELAY_MS = ROAMING_INTERVAL_MS * 1.5;

/** 置き直しの決まり（止まっていた後に動き出したとき / track.ts）。 */
export const ROAMING_RESEAT = {
	gapMs: ROAMING_INTERVAL_MS * 2,
	reseatMs: ROAMING_INTERVAL_MS,
} as const;

/**
 * 自分の見た目を送る間（ミリ秒）。サーバーの間（VERYARE_ROAMING.lookIntervalMs）より少し長くし、届く
 * 間隔の揺れで捨てられないようにする。
 */
export const LOOK_SEND_INTERVAL_MS = VERYARE_ROAMING.lookIntervalMs + 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * ルーム情報（unknown）が、動ける規則のルームを告げているか。roaming: true なら true、載っていなければ false
 * （従来の規則）。ルーム情報でなければ null。
 */
export function roamingOfRoomInfo(payload: unknown): boolean | null {
	if (!isRecord(payload) || payload.type !== "room-info") return null;
	return payload.roaming === true;
}

/** ルーム情報（unknown）が、増え鬼のルームを告げているか（ADR 0053）。読み方は roamingOfRoomInfo と同じ。 */
export function spreadingOfRoomInfo(payload: unknown): boolean | null {
	if (!isRecord(payload) || payload.type !== "room-info") return null;
	return payload.spreading === true;
}

/** 動く隠れ側の通知（unknown）を検証する。形が違えば null。 */
export function parseRoamingNotice(
	payload: unknown,
): readonly VeryareRoamingHider[] | null {
	if (!isRecord(payload) || payload.type !== "roaming") return null;
	return parseRoamingHiders(payload.hiders);
}

/**
 * 動く隠れ側の並び（unknown）を検証する。動く隠れ側の通知の hiders と、増え鬼の鬼の通知の others
 * （途中から鬼になった人）が使う。形が違えば null。
 */
export function parseRoamingHiders(
	value: unknown,
): readonly VeryareRoamingHider[] | null {
	if (!Array.isArray(value)) return null;
	const hiders: VeryareRoamingHider[] = [];
	for (const entry of value as unknown[]) {
		if (!isRecord(entry)) return null;
		const { playerId, x, z, facing } = entry;
		if (typeof playerId !== "string") return null;
		if (!isFiniteNumber(x) || !isFiniteNumber(z)) return null;
		if (facing !== null && !isFiniteNumber(facing)) return null;
		hiders.push({ playerId, x, z, facing });
	}
	return hiders;
}

/** 見た目の通知（unknown）を検証する。ポーズは素材のポーズだけ、ペイントは人間のペイントだけ。 */
export function parseLookNotice(payload: unknown): VeryareLookNotice | null {
	if (!isRecord(payload) || payload.type !== "look") return null;
	const { playerId, pose, paint } = payload;
	if (typeof playerId !== "string") return null;
	const chosen = pose === null ? null : parseModelPose(pose);
	if (pose !== null && chosen === null) return null;
	const parsed = paint === null ? null : parsePaint(paint);
	if (paint !== null && parsed?.kind !== "strokes") return null;
	return {
		type: "look",
		playerId,
		pose: chosen,
		paint: parsed?.kind === "strokes" ? parsed : null,
	};
}

/** 動いている隠れ側（ほかの人）の、届いた通知。 */
export type RoamingTracks = ReadonlyMap<PlayerId, readonly TrackSample[]>;

export const NO_ROAMING: RoamingTracks = new Map();

/**
 * 届いた通知を足す。自分を除く。一覧に載らなくなった人（見つかった人）は、最後の位置のまま残す（もう
 * 動かない。消すと、探索の開始の位置へ戻って見えるため）。探索・答え合わせの間でなければ、遅れて届いた
 * 通知として捨てる（current をそのまま返す）。
 */
export function applyRoamingNotice(
	current: RoamingTracks,
	hiders: readonly VeryareRoamingHider[],
	context: {
		readonly self: PlayerId | null;
		readonly at: number;
		readonly phase: Phase;
	},
): RoamingTracks {
	if (context.phase !== "exploration" && context.phase !== "reveal") {
		return current;
	}
	const next = new Map<PlayerId, readonly TrackSample[]>(current);
	for (const hider of hiders) {
		if (hider.playerId === context.self) continue;
		const previous = current.get(hider.playerId) ?? [];
		const facing = hider.facing ?? previous.at(-1)?.facing ?? 0;
		next.set(
			hider.playerId,
			pushSample(
				previous,
				{ at: context.at, x: hider.x, z: hider.z, facing },
				ROAMING_RESEAT,
			),
		);
	}
	return next;
}

/**
 * 増え鬼（ADR 0053）の、途中から鬼になった人の通知を足す（鬼の通知の others）。自分を除く。一覧に
 * 載らなくなった人（離脱）は消す。探索・答え合わせの間でなければ捨てる。
 */
export function applyOtherOnis(
	current: RoamingTracks,
	others: readonly VeryareRoamingHider[],
	context: {
		readonly self: PlayerId | null;
		readonly at: number;
		readonly phase: Phase;
	},
): RoamingTracks {
	const listed = applyRoamingNotice(current, others, context);
	if (listed === current) return current;
	const ids = new Set(others.map((oni) => oni.playerId));
	return new Map([...listed].filter(([id]) => ids.has(id)));
}

/** 探索・答え合わせの外では、持っている通知を捨てる（次の対戦に持ち越さない）。 */
export function roamingInPhase(
	current: RoamingTracks,
	phase: Phase,
): RoamingTracks {
	return phase === "exploration" || phase === "reveal" ? current : NO_ROAMING;
}

/** 時刻 time（遅らせる前の今）の、その隠れ側の位置と向き。通知が無ければ null。 */
export function sampleRoaming(
	current: RoamingTracks,
	id: PlayerId,
	time: number,
): { readonly x: number; readonly z: number; readonly facing: number } | null {
	const track = current.get(id);
	return track === undefined
		? null
		: sampleTrack(track, time - ROAMING_DELAY_MS);
}

/**
 * 描く隠れ側に、動く隠れ側の補間した位置と向きを当て、動く体として描かせる。動く隠れ側の通知が届いて
 * いない人（隠れ CPU・まだ届く前）は、そのまま（置いたまま動かない体）。
 */
export function placeRoaming<
	T extends {
		readonly id: string;
		readonly x: number;
		readonly z: number;
		readonly facing: number | null;
	},
>(hiders: readonly T[], tracks: RoamingTracks, time: number): T[] {
	return hiders.map((hider) => {
		const at = sampleRoaming(tracks, hider.id, time);
		return at === null ? hider : { ...hider, ...at, moving: true };
	});
}

/** 見た目の通知で、隠れ側の状態の、その人の見た目（ポーズとペイント）を置き換える。 */
export function applyLook(
	hiders: readonly VeryareHiderState[] | null,
	look: VeryareLookNotice,
): readonly VeryareHiderState[] | null {
	if (hiders === null) return null;
	return hiders.map((hider) =>
		hider.playerId === look.playerId
			? { ...hider, pose: look.pose, paint: look.paint }
			: hider,
	);
}

/** 動ける規則で、隠れ側が動けて塗れるフェーズか（ペイントと探索）。 */
export function roamingPhase(phase: Phase): boolean {
	return phase === "painting" || phase === "exploration";
}

/** 歩く速さ（m/秒）。動ける規則の、ペイントと探索の間の隠れ側だけ hiderSpeed、ほかは WALK_SPEED。 */
export function walkSpeedOf(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly roaming: boolean;
	readonly hiderSpeed?: number;
}): number {
	const { phase, role, roaming } = options;
	return roaming && role === "hider" && roamingPhase(phase)
		? (options.hiderSpeed ?? ROAMING_HIDER_SPEED)
		: WALK_SPEED;
}

/** 最後に送った自分の見た目。 */
export interface SentLook {
	readonly strokes: readonly VeryareStroke[];
	readonly pose: VeryareModelPose | null;
	readonly at: number;
}

/**
 * 自分の見た目を、いま送るか。send はすぐ送る、wait は waitMs 後に見直す、none は送る物が無い。
 * 送った物（sent）と同じなら送らない。前に送ってから LOOK_SEND_INTERVAL_MS たっていなければ待つ。
 * 塗っていなくて、ポーズも選んでいなければ（両方 null の電文はサーバーが捨てる）送らない。
 */
export function lookDue(input: {
	readonly sent: SentLook | null;
	readonly strokes: readonly VeryareStroke[];
	readonly pose: VeryareModelPose | null;
	readonly now: number;
}):
	| { readonly kind: "send" }
	| { readonly kind: "wait"; readonly waitMs: number }
	| { readonly kind: "none" } {
	const { sent, strokes, pose, now } = input;
	if (strokes.length === 0 && pose === null) return { kind: "none" };
	if (sent !== null && sent.strokes === strokes && sent.pose === pose) {
		return { kind: "none" };
	}
	if (sent === null) return { kind: "send" };
	const waited = now - sent.at;
	return waited >= LOOK_SEND_INTERVAL_MS
		? { kind: "send" }
		: { kind: "wait", waitMs: LOOK_SEND_INTERVAL_MS - waited };
}
