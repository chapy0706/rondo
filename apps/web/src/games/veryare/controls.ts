/**
 * 画面に出す操作部品（移動パッド・視点パッド・ボタン）を決める純粋関数。three と React を使わない。
 *
 * 出し分けの条件を、ここ1つにまとめる（Veryare.tsx は、この結果だけで部品を出す。画面の属性
 * data-controls にも、同じ一覧を出す）。条件に使う値（フェーズ・鬼・エリア・まだ隠れている人）は、
 * 届いた通知を、画面の購読と同じ読み方で畳んだもの（viewOf・applyNotice）。
 *
 * フェーズの通知が届いていない間は、移動パッドを黙って隠したままにせず、「接続中」（pending）を出す。
 * 届いたら、すぐ、その時機の部品を出す（CPU ありのルームの途中参加で、フェーズが届かず移動パッドが
 * 出なかった不具合の見つけやすさのため）。
 */

import { canChangePose } from "./poses";
import {
	type PhaseNotice,
	canMove,
	canPaintWhileWaiting,
	canShoot,
	isSpectator,
	parseHidingNotice,
	parsePhaseNotice,
	roleOf,
	spaceOf,
} from "./rules";

/** 操作部品（data-controls の値）。並びは、この順。 */
export type Control =
	/** フェーズの通知を待っている（「接続中」の表示）。 */
	| "pending"
	| "move"
	| "look"
	/** 鬼希望エリアの表示（鬼選出の間）。 */
	| "area"
	| "open-door"
	| "shoot"
	/** 待機ルームのポーズボタン。 */
	| "waiting-pose"
	/** 準備移動のポーズボタン（ペイントフェーズでは、ペイントの板の中）。 */
	| "game-pose"
	/** ペイントの板（隠れ側）。 */
	| "paint"
	/** 待つ間の色の塗り替え（鬼）。 */
	| "waiting-paint";

const ORDER: readonly Control[] = [
	"pending",
	"move",
	"look",
	"area",
	"open-door",
	"shoot",
	"waiting-pose",
	"game-pose",
	"paint",
	"waiting-paint",
];

/** 届いた通知から読んだ、操作部品の条件に使う値。 */
export interface ControlsView {
	readonly notice: PhaseNotice | null;
	readonly hiding: readonly string[] | null;
}

export const NO_NOTICES: ControlsView = { notice: null, hiding: null };

/** 中身（フェーズ・長さ・鬼・結果・エリア）が同じフェーズの通知か。復帰の送り直しを見分ける。 */
export function sameNotice(
	a: PhaseNotice | null,
	b: PhaseNotice | null,
): boolean {
	if (a === null || b === null) return false;
	return (
		a.phase === b.phase &&
		a.durationMs === b.durationMs &&
		a.oni === b.oni &&
		a.outcome === b.outcome &&
		a.area === b.area
	);
}

/** 通知を1つ畳む。同じ中身のフェーズの通知は、前のものを保つ（送り直しで、残り時間を始め直さない）。 */
export function applyNotice(
	view: ControlsView,
	payload: unknown,
): ControlsView {
	const notice = parsePhaseNotice(payload);
	if (notice !== null) {
		return sameNotice(view.notice, notice) ? view : { ...view, notice };
	}
	const hiding = parseHidingNotice(payload);
	if (hiding !== null) return { ...view, hiding: hiding.playerIds };
	return view;
}

/** 通知の並びを、届いた順に畳む。 */
export function viewOf(payloads: readonly unknown[]): ControlsView {
	return payloads.reduce<ControlsView>(applyNotice, NO_NOTICES);
}

/** 画面の側の値（通知の外）。 */
export interface ControlsContext {
	readonly you: string | null;
	/** 素材の体に差し替えたか（ポーズボタンを出すか）。 */
	readonly posable: boolean;
	/** ペイントとポーズの確定を送ったか。 */
	readonly paintSubmitted: boolean;
	/** 開けられる閉じた襖のそばにいるか（doorToOpen が襖を返したか）。 */
	readonly nearDoor: boolean;
}

function derived(view: ControlsView, you: string | null) {
	const notice = view.notice;
	if (notice === null) return null;
	const role = roleOf(notice.oni, you);
	const phase = notice.phase;
	return {
		phase,
		role,
		space: spaceOf(phase, role),
		spectator: isSpectator(phase, role, view.hiding, you),
		area: phase === "oni-selection" ? notice.area : null,
	};
}

/** 動けるか（移動パッドを出し、手元で動かすか）。フェーズの通知が届いていなければ動かない。 */
export function canMoveNow(view: ControlsView, you: string | null): boolean {
	const now = derived(view, you);
	return now !== null && canMove(now.phase, now.role) && !now.spectator;
}

/** 出す操作部品（ORDER の順）。 */
export function controlsFor(
	view: ControlsView,
	context: ControlsContext,
): readonly Control[] {
	const now = derived(view, context.you);
	if (now === null) return ["pending", "look"];
	const { phase, role, space, spectator, area } = now;
	const movable = canMoveNow(view, context.you);
	const shown = new Set<Control>(["look"]);
	if (movable) shown.add("move");
	if (area !== null) shown.add("area");
	if (movable && context.nearDoor) shown.add("open-door");
	if (canShoot(phase, role, spectator)) shown.add("shoot");
	if (
		phase === "oni-selection" &&
		space === "waiting-room" &&
		context.posable
	) {
		shown.add("waiting-pose");
	}
	if (
		phase === "preparation" &&
		context.posable &&
		canChangePose({
			phase,
			role,
			spectator,
			submitted: context.paintSubmitted,
		})
	) {
		shown.add("game-pose");
	}
	if (phase === "painting" && role === "hider" && !spectator)
		shown.add("paint");
	if (canPaintWhileWaiting(phase, role)) shown.add("waiting-paint");
	return ORDER.filter((control) => shown.has(control));
}
