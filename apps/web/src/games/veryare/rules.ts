/**
 * veryare のクライアント側の規則（純粋関数）。
 *
 * フェーズの進行と勝敗はサーバー（server/src/rondo_server/games/veryare/）が決める。
 * ここはサーバーの通知を検証して読み、画面の表示と入力の扱いに必要な規則だけを持つ。
 * 空間の広さはサーバーの game.gleam と揃えた仮の値で、issue-29 で実際のステージに合わせる。
 */

import type {
	VeryareEdge,
	VeryareHiderState,
	VeryareHidersNotice,
	VeryareOniNotice,
	VeryarePose,
	VeryareShootEvent,
} from "@rondo/contracts";
import { VERYARE_MODEL_POSES } from "@rondo/contracts";
import { parsePaint } from "./paint";

export type Phase =
	| "oni-selection"
	| "preparation"
	| "painting"
	| "exploration"
	| "reveal"
	| "ended";
export type Outcome = "oni-wins" | "hiders-win" | "not-enough-players";
export type Space = "waiting-room" | "stage";
export type Role = "oni" | "hider" | "undecided";
/** 鬼希望エリアの状態（ADR 0024）。waiting 赤・待機 / ready 緑・開始 / counting 青・鬼希望。 */
export type AreaState = "waiting" | "ready" | "counting";

/** サーバーのフェーズ通知（room.gleam の phase_payload）。 */
export interface PhaseNotice {
	readonly phase: Phase;
	/**
	 * 通知を作った時点からの、フェーズの残り（ミリ秒 / ADR 0046）。フェーズの開始のときはフェーズの長さ、
	 * 途中参加・復帰の送り直しでは、その時点の残り。長さを持たないフェーズ（鬼選出・終了）は null。
	 */
	readonly durationMs: number | null;
	readonly oni: string | null;
	readonly outcome: Outcome | null;
	/** 鬼希望エリアの状態。鬼選出中だけ持つ。 */
	readonly area: AreaState | null;
}

export interface Point {
	readonly x: number;
	readonly z: number;
}

/**
 * 待機ルームの半径（m）。円柱形で、床は直径 7 m（ADR 0044。ADR 0024 の 2 m を置き換える）。
 * サーバーの game.gleam の waiting_room_radius と同じ値（共有の見本 veryare-movement.json で確かめる）。
 */
export const WAITING_ROOM_RADIUS = 3.5;
/** 鬼希望エリア（待機ルーム中央の円）の半径（m）。 */
export const ONI_AREA_RADIUS = 0.6;

const PHASES: readonly Phase[] = [
	"oni-selection",
	"preparation",
	"painting",
	"exploration",
	"reveal",
	"ended",
];
const AREA_STATES: readonly AreaState[] = ["waiting", "ready", "counting"];
const OUTCOMES: readonly Outcome[] = [
	"oni-wins",
	"hiders-win",
	"not-enough-players",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPhase(value: unknown): value is Phase {
	return PHASES.includes(value as Phase);
}

function isOutcome(value: unknown): value is Outcome {
	return OUTCOMES.includes(value as Outcome);
}

function isAreaState(value: unknown): value is AreaState {
	return AREA_STATES.includes(value as AreaState);
}

/** フェーズ通知を検証して読む。形が違えば null（境界での unknown 検証）。 */
export function parsePhaseNotice(payload: unknown): PhaseNotice | null {
	if (!isRecord(payload) || payload.type !== "phase") return null;
	const { phase, durationMs, oni, outcome } = payload;
	// area が無い通知（エリアの色を持たない形）は、エリアなしとして読む。
	const area = payload.area ?? null;
	if (!isPhase(phase)) return null;
	if (durationMs !== null && typeof durationMs !== "number") return null;
	if (oni !== null && typeof oni !== "string") return null;
	if (outcome !== null && !isOutcome(outcome)) return null;
	if (area !== null && !isAreaState(area)) return null;
	return { phase, durationMs, oni, outcome, area };
}

const POSES: readonly VeryarePose[] = ["standing", "crouching", "lying"];

/** 一括配信のポーズ（CPU・鬼の3種類と、素材のポーズの識別子 / issue-56）。 */
const HIDER_POSES: ReadonlySet<string> = new Set<string>([
	...POSES,
	...VERYARE_MODEL_POSES,
]);

function isHiderState(value: unknown): value is VeryareHiderState {
	if (!isRecord(value)) return false;
	const { playerId, x, z, facing, pose, paint } = value;
	if (typeof playerId !== "string") return false;
	if (typeof x !== "number" || typeof z !== "number") return false;
	if (facing !== null && typeof facing !== "number") return false;
	// ポーズは文字列か null。一覧に無い文字列は、読むときに null にする（既定の立ち姿 / issue-56）。
	if (pose !== null && typeof pose !== "string") return false;
	// ペイントは全面1色（隠れ CPU）か、人間のストローク（issue-25）。上限まで検証する。
	return paint === null || parsePaint(paint) !== null;
}

/**
 * 探索開始時の一括配信（まだ隠れている隠れ側全員の状態 / ADR 0025 / 0035）を検証して読む。
 * 人間の隠れ側の向き・ポーズは、まだ null で届く。ペイントは、確定したストロークか null（issue-25）。
 */
export function parseHidersNotice(
	payload: unknown,
): VeryareHidersNotice | null {
	if (!isRecord(payload) || payload.type !== "hiders") return null;
	const { hiders } = payload;
	if (!Array.isArray(hiders) || !hiders.every(isHiderState)) return null;
	return {
		type: "hiders",
		hiders: hiders.map((hider) => ({
			...hider,
			pose:
				hider.pose !== null && HIDER_POSES.has(hider.pose) ? hider.pose : null,
		})),
	};
}

function isCell(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.x === "number" &&
		typeof value.z === "number"
	);
}

/** 境 {a, b}（issue-29b / ADR 0042）。襖は、隣り合う2マスの境で指す。 */
function isEdge(value: unknown): value is VeryareEdge {
	return isRecord(value) && isCell(value.a) && isCell(value.b);
}

/** 探索中の鬼の状態（issue-28 / issue-34）を検証して読む。 */
export function parseOniNotice(payload: unknown): VeryareOniNotice | null {
	if (!isRecord(payload) || payload.type !== "oni") return null;
	const { playerId, x, z, facing, pose, openDoors } = payload;
	if (typeof playerId !== "string") return null;
	if (typeof x !== "number" || typeof z !== "number") return null;
	if (typeof facing !== "number") return null;
	if (!POSES.includes(pose as VeryarePose)) return null;
	if (!Array.isArray(openDoors) || !openDoors.every(isEdge)) return null;
	return {
		type: "oni",
		playerId,
		x,
		z,
		facing,
		pose: pose as VeryarePose,
		openDoors,
	};
}

/** まだ隠れている隠れ側の一覧（issue-28）を検証して読む。 */
export function parseHidingNotice(
	payload: unknown,
): { readonly playerIds: readonly string[] } | null {
	if (!isRecord(payload) || payload.type !== "hiding") return null;
	const { playerIds } = payload;
	if (
		!Array.isArray(playerIds) ||
		!playerIds.every((id) => typeof id === "string")
	) {
		return null;
	}
	return { playerIds };
}

/**
 * 観戦者か。隠れ側で、まだ隠れている一覧から外れた人（見つかった・被りで失格）。
 * 一覧がまだ届いていないときと、答え合わせ・終了の後は観戦にしない。
 */
export function isSpectator(
	phase: Phase,
	role: Role,
	hiding: readonly string[] | null,
	you: string | null,
): boolean {
	if (role !== "hider" || hiding === null || you === null) return false;
	if (phase !== "painting" && phase !== "exploration") return false;
	return !hiding.includes(you);
}

/** 画面の視点。self は自分の TPS 視点、oni は鬼を中央に固定した周回カメラ（ADR 0034）。 */
/**
 * カメラの中心。self は自分、oni は鬼（ADR 0034）、hider は答え合わせで選んだ隠れ側の隠れ場所
 * （issue-32 / ADR 0036）。
 */
export type View = "self" | "oni" | { readonly hider: string };

/**
 * 視点を決める。探索中に鬼の状態が届いていれば、観戦者と、鬼 TPS 視点を選んだ隠れ側は
 * 鬼 TPS 視点になる。鬼自身は常に自分の視点。答え合わせの間に、自分以外の隠れ場所を選んで
 * いれば（revealTarget）、その隠れ側を中心にした視点（issue-32）。
 */
export function viewOf(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly spectator: boolean;
	readonly choseOni: boolean;
	readonly oniKnown: boolean;
	readonly revealTarget?: string | null;
	readonly you?: string | null;
}): View {
	const { phase, role, spectator, choseOni, oniKnown } = options;
	const target = options.revealTarget ?? null;
	if (phase === "reveal" && target !== null && target !== options.you) {
		return { hider: target };
	}
	if (phase !== "exploration" || role !== "hider" || !oniKnown) return "self";
	return spectator || choseOni ? "oni" : "self";
}

/** 入室後の案内（探索時間）を検証して読む。 */
export function parseRoomInfo(
	payload: unknown,
): { readonly explorationSeconds: number } | null {
	if (!isRecord(payload) || payload.type !== "room-info") return null;
	const { explorationSeconds } = payload;
	if (typeof explorationSeconds !== "number") return null;
	return { explorationSeconds };
}

/** 鬼希望エリアの見た目（色と文言）。 */
export function areaLook(area: AreaState): {
	readonly color: "red" | "green" | "blue";
	readonly label: string;
} {
	switch (area) {
		case "waiting":
			return { color: "red", label: "待機" };
		case "ready":
			return { color: "green", label: "開始" };
		case "counting":
			return { color: "blue", label: "鬼希望" };
	}
}

/** 自分の役割。鬼が決まる前、または自分の ID が分からない間は未定。 */
export function roleOf(oni: string | null, you: string | null): Role {
	if (oni === null || you === null) return "undecided";
	return oni === you ? "oni" : "hider";
}

/**
 * 自分がいる空間（ADR 0024）。鬼選出中は全員が待機ルーム。鬼が決まると隠れ側は
 * ステージへ移り、鬼は探索開始まで待機ルームに残る。
 */
export function spaceOf(phase: Phase, role: Role): Space {
	if (role === "undecided") return "waiting-room";
	switch (phase) {
		case "oni-selection":
			return "waiting-room";
		case "preparation":
		case "painting":
			return role === "oni" ? "waiting-room" : "stage";
		case "exploration":
		case "reveal":
		case "ended":
			return "stage";
	}
}

/**
 * 移動入力を受け付けるか（サーバー側でも同じく無視される）。準備移動の後（ペイント・探索）は
 * 隠れ側は動けない。答え合わせ・終了後は誰も動けない。
 */
export function canMove(phase: Phase, role: Role): boolean {
	switch (phase) {
		case "reveal":
		case "ended":
			return false;
		case "painting":
		case "exploration":
			return role !== "hider";
		case "oni-selection":
		case "preparation":
			return true;
	}
}

/** 鬼の待機中ペイント（ローカルのみ）ができるか。準備・ペイント中の鬼だけ。 */
export function canPaintWhileWaiting(phase: Phase, role: Role): boolean {
	return role === "oni" && (phase === "preparation" || phase === "painting");
}

/** 待機ルームに入ったときの初期位置。鬼希望エリアの外に立つ。ステージは、ステージの通知の玄関。 */
export const WAITING_ROOM_SPAWN: Point = { x: 0, z: 2.0 };

/** サーバーへの移動の報告（room.gleam の move_decoder が受ける形）。 */
export interface MoveReport {
	readonly type: "move";
	readonly x: number;
	readonly z: number;
	/**
	 * 向き（サーバーの向き）。体の向き（bodyFacing.ts。進む向きへ回る / issue-57）。ほかの人の画面の鬼と
	 * 待機ルームのメンバーの体の向きに使う。
	 */
	readonly facing?: number;
}

export function moveReport(position: Point, facing?: number): MoveReport {
	return facing === undefined
		? { type: "move", x: position.x, z: position.z }
		: { type: "move", x: position.x, z: position.z, facing };
}

/**
 * カメラの向き（yaw。0 で -z を向き、正で左へ回る）を、サーバーの向き（facing。x 軸から
 * z 軸の向きへ回るラジアン）にする。yaw の正面は (-sin yaw, -cos yaw)。
 */
export function facingOfYaw(yaw: number): number {
	return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

/** サーバーの向き（facing）を、カメラの向き（yaw）にする。facingOfYaw の逆。 */
export function yawOfFacing(facing: number): number {
	return Math.atan2(-Math.cos(facing), -Math.sin(facing));
}

/** 待機ルーム（半径2mの円）に丸める（サーバーの game.move と同じ）。ステージは移動の規則（stage.ts）。 */
export function clampToWaitingRoom(point: Point): Point {
	const distance = Math.hypot(point.x, point.z);
	if (distance <= WAITING_ROOM_RADIUS) return point;
	const scale = WAITING_ROOM_RADIUS / distance;
	return { x: point.x * scale, z: point.z * scale };
}

/**
 * 方向入力で進もうとする位置（壁や円の範囲は、stage.ts の mirrorMove が決める）。
 * 入力の y は下が正（VirtualPad の約束）で、上に倒すとカメラの向いている方へ進む。
 * yaw は Y 軸まわりの回転（0 で -z 方向を向く）。
 */
export function walkTarget(
	position: Point,
	input: { readonly x: number; readonly y: number },
	yaw: number,
	speed: number,
	dtSeconds: number,
): Point {
	const forward = -input.y;
	const right = input.x;
	const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * speed;
	const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * speed;
	return { x: position.x + dx * dtSeconds, z: position.z + dz * dtSeconds };
}

// --- 射撃（issue-27 / ADR 0022） ------------------------------------------------

/**
 * 撃つ間隔（ミリ秒）。サーバーの既定（3 秒）と同じ。外れでも撃てば始まる。
 * 画面はこの間、撃つボタンを無効にして見せるだけで、有効な申告かどうかはサーバーが決める。
 */
export const SHOT_RELOAD_MS = 3000;

/** 撃つボタンを出すか。探索フェーズの鬼で、観戦中でないときだけ。 */
export function canShoot(
	phase: Phase,
	role: Role,
	spectator: boolean,
): boolean {
	return phase === "exploration" && role === "oni" && !spectator;
}

/** 撃ってからの残りの間隔（ミリ秒）。撃っていなければ 0。 */
export function reloadRemainingMs(
	lastShotAt: number | null,
	now: number,
): number {
	if (lastShotAt === null) return 0;
	return Math.max(0, SHOT_RELOAD_MS - (now - lastShotAt));
}

/** 射撃の申告（契約の VeryareShootEvent）。照準に何も重なっていなければ target は null。 */
export function shootEvent(target: string | null): VeryareShootEvent {
	return { type: "shoot", target };
}

/**
 * 撃った相手が見つかったか。撃った後に、まだ隠れている一覧から、その相手が外れたとき。
 * 命中の知らせは専用の電文を作らず、既存の一覧の更新で分かる（issue-27）。
 */
export function foundByShot(
	target: string | null,
	hidingBefore: readonly string[] | null,
	hidingNow: readonly string[],
): boolean {
	if (target === null || hidingBefore === null) return false;
	return hidingBefore.includes(target) && !hidingNow.includes(target);
}
