/**
 * veryare のクライアント側の規則（純粋関数）。
 *
 * フェーズの進行と勝敗はサーバー（server/src/rondo_server/games/veryare/）が決める。
 * ここはサーバーの通知を検証して読み、画面の表示と入力の扱いに必要な規則だけを持つ。
 * 空間の広さはサーバーの game.gleam と揃えた仮の値で、issue-29 で実際のステージに合わせる。
 */

export type Phase =
	| "oni-selection"
	| "preparation"
	| "painting"
	| "exploration"
	| "ended";
export type Outcome = "oni-wins" | "hiders-win" | "not-enough-players";
export type Space = "waiting-room" | "stage";
export type Role = "oni" | "hider" | "undecided";

/** サーバーのフェーズ通知（room.gleam の phase_payload）。 */
export interface PhaseNotice {
	readonly phase: Phase;
	readonly durationMs: number | null;
	readonly oni: string | null;
	readonly outcome: Outcome | null;
}

export interface Point {
	readonly x: number;
	readonly z: number;
}

/** 待機ルームの半幅（m）。約3.6m四方（8畳）。 */
export const WAITING_ROOM_HALF = 1.8;
/** 鬼希望エリア（待機ルーム中央の円）の半径（m）。 */
export const ONI_AREA_RADIUS = 0.6;
/** ステージの半幅（m）。issue-29 までの仮の広さ。 */
export const STAGE_HALF = 5;

const PHASES: readonly Phase[] = [
	"oni-selection",
	"preparation",
	"painting",
	"exploration",
	"ended",
];
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

/** フェーズ通知を検証して読む。形が違えば null（境界での unknown 検証）。 */
export function parsePhaseNotice(payload: unknown): PhaseNotice | null {
	if (!isRecord(payload) || payload.type !== "phase") return null;
	const { phase, durationMs, oni, outcome } = payload;
	if (!isPhase(phase)) return null;
	if (durationMs !== null && typeof durationMs !== "number") return null;
	if (oni !== null && typeof oni !== "string") return null;
	if (outcome !== null && !isOutcome(outcome)) return null;
	return { phase, durationMs, oni, outcome };
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
		case "ended":
			return "stage";
	}
}

/** 移動入力を受け付けるか。探索中の隠れ側と、終了後は動けない（サーバー側でも無視される）。 */
export function canMove(phase: Phase, role: Role): boolean {
	if (phase === "ended") return false;
	if (phase === "exploration") return role !== "hider";
	return true;
}

/** 鬼の待機中ペイント（ローカルのみ）ができるか。準備・ペイント中の鬼だけ。 */
export function canPaintWhileWaiting(phase: Phase, role: Role): boolean {
	return role === "oni" && (phase === "preparation" || phase === "painting");
}

export function halfWidthOf(space: Space): number {
	return space === "waiting-room" ? WAITING_ROOM_HALF : STAGE_HALF;
}

/** 空間に入ったときの初期位置。待機ルームでは鬼希望エリアの外に立つ。 */
export function spawnOf(space: Space): Point {
	return space === "waiting-room" ? { x: 0, z: 1.3 } : { x: 0, z: 3 };
}

/** サーバーへの移動の報告（room.gleam の move_decoder が受ける形）。 */
export interface MoveReport {
	readonly type: "move";
	readonly x: number;
	readonly z: number;
}

export function moveReport(position: Point): MoveReport {
	return { type: "move", x: position.x, z: position.z };
}

function clamp(value: number, half: number): number {
	return Math.min(half, Math.max(-half, value));
}

/**
 * 方向入力で位置を進める。入力の y は下が正（VirtualPad の約束）で、上に倒すと
 * カメラの向いている方へ進む。yaw は Y 軸まわりの回転（0 で -z 方向を向く）。
 */
export function stepPosition(
	position: Point,
	input: { readonly x: number; readonly y: number },
	yaw: number,
	speed: number,
	dtSeconds: number,
	half: number,
): Point {
	const forward = -input.y;
	const right = input.x;
	const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * speed;
	const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * speed;
	return {
		x: clamp(position.x + dx * dtSeconds, half),
		z: clamp(position.z + dz * dtSeconds, half),
	};
}
