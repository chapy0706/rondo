import type { Direction } from "./port";

/**
 * 仮想パッドの状態（ADR 0018）。DOM を知らない純粋な計算で、React 層（virtual-pad.tsx）が
 * ポインタのイベントを流し込む。
 *
 * - パッドは、最初に触った指（pointerId）だけが動かす。ほかの指は、その指が離れるまで無視する
 * - 離した・取り消した・キャプチャを失った・全部を戻す（画面が隠れた、フォーカスを失った、パッドが
 *   消えた）は、向きを 0 に、つまみを中心に戻す（触っていないのに動き続けないように）
 * - デッドゾーン（0〜1）より小さな傾きは、向き 0。外側は、端まで 0〜1 に伸ばし直す。つまみ（見た目）は、
 *   デッドゾーンに関わらず指に付いていく
 */

export interface PadState {
	/** 触っている指。触っていなければ null。 */
	readonly pointerId: number | null;
	/** ゲームへ渡す向き（-1〜1）。 */
	readonly vector: Direction;
	/** つまみの位置（半径を 1 とした、-1〜1）。 */
	readonly knob: Direction;
}

export type PadEvent =
	| {
			readonly type: "down" | "move";
			readonly pointerId: number;
			/** パッドの中心からのずれ（px）。 */
			readonly x: number;
			readonly y: number;
			readonly radius: number;
	  }
	| { readonly type: "up" | "cancel" | "lost"; readonly pointerId: number }
	| { readonly type: "reset" };

const ZERO: Direction = { x: 0, y: 0 };

export const IDLE_PAD: PadState = { pointerId: null, vector: ZERO, knob: ZERO };

function clampUnit(value: number): number {
	return Math.max(-1, Math.min(1, value));
}

/** つまみの位置から、デッドゾーンを当てた向き。deadZone が 0 なら、そのまま。 */
function applyDeadZone(knob: Direction, deadZone: number): Direction {
	if (deadZone <= 0) return knob;
	const magnitude = Math.hypot(knob.x, knob.y);
	if (magnitude <= deadZone) return ZERO;
	const length = Math.min(magnitude, 1);
	const scale = (length - deadZone) / (1 - deadZone) / magnitude;
	return { x: knob.x * scale, y: knob.y * scale };
}

export function padReducer(
	state: PadState,
	event: PadEvent,
	deadZone = 0,
): PadState {
	switch (event.type) {
		case "down":
		case "move": {
			if (event.type === "down" && state.pointerId !== null) {
				if (state.pointerId !== event.pointerId) return state;
			}
			if (event.type === "move" && state.pointerId !== event.pointerId) {
				return state;
			}
			const knob =
				event.radius > 0
					? {
							x: clampUnit(event.x / event.radius),
							y: clampUnit(event.y / event.radius),
						}
					: ZERO;
			return {
				pointerId: event.pointerId,
				knob,
				vector: applyDeadZone(knob, deadZone),
			};
		}
		case "up":
		case "cancel":
		case "lost":
			return state.pointerId === event.pointerId ? IDLE_PAD : state;
		case "reset":
			return IDLE_PAD;
	}
}
