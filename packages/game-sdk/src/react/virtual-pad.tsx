/**
 * 基盤共通の仮想パッド（ADR 0018 / 0020）。
 *
 * VirtualPadProvider が入力源をサブツリーに供給し、VirtualPad が画面上のスティックを
 * 方向入力に変換する。ゲームは useVirtualPad で (x, y) だけを受け取り、入力元を知らない。
 *
 * 入力源は名前付きで複数持てる（ADR 0020）。名前を省略すると既定の入力源を使うので、
 * 1本だけ使う既存ゲームは useVirtualPad() / <VirtualPad /> のまま変わらない。
 * 2本使うゲームは useVirtualPad("move") と useVirtualPad("look") のように名前で引き、
 * <VirtualPad name="look" /> で書き込み先を揃える。入力源そのもの（VirtualPadSource）は
 * 変えず、名前ごとに1つずつインスタンス化するだけである。
 *
 * 状態の計算は pad-state.ts（純粋関数）。最初に触った指だけが動かし、離した・取り消した・キャプチャを
 * 失った・画面が隠れた・ウィンドウがフォーカスを失った・パッドが消えた、のどれでも向きを 0 に戻す
 * （触っていないのに動き続けないように）。つまみは指に付いていき、離すと PAD_RETURN_MS で中心へ戻る。
 */

import {
	type PointerEvent,
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useRef,
} from "react";
import {
	IDLE_PAD,
	type PadEvent,
	type PadState,
	padReducer,
} from "../input/pad-state";
import type { Direction } from "../input/port";
import { VirtualPadSource } from "../input/virtual-pad";
import { useInput } from "./use-input";

/** 名前を省略したときの入力源の名前。 */
const DEFAULT_PAD = "default";

/** 離したとき、つまみが中心へ戻るまでの時間（ミリ秒）。 */
export const PAD_RETURN_MS = 100;

/** つまみの大きさ（パッドの直径に対する割合）。 */
const KNOB_RATIO = 0.4;

/** 名前ごとの入力源。初めて引かれた名前の入力源をその場で作る。 */
type VirtualPadSources = Map<string, VirtualPadSource>;

const VirtualPadContext = createContext<VirtualPadSources | null>(null);

/**
 * VirtualPad の入力源をサブツリーに供給する。
 *
 * 使う名前を事前に宣言しなくてよい（基盤のホストはゲームがどの名前を使うかを知らない）。
 */
export function VirtualPadProvider({ children }: { children: ReactNode }) {
	const ref = useRef<VirtualPadSources | null>(null);
	let sources = ref.current;
	if (sources === null) {
		sources = new Map();
		ref.current = sources;
	}
	return (
		<VirtualPadContext.Provider value={sources}>
			{children}
		</VirtualPadContext.Provider>
	);
}

/**
 * 名前で入力源を引く。同じ Provider の中なら、同じ名前は常に同じ入力源を指す。
 * 名前を省略すると既定の入力源を返す。
 */
export function useVirtualPadSource(
	name: string = DEFAULT_PAD,
): VirtualPadSource {
	const sources = useContext(VirtualPadContext);
	if (sources === null) {
		throw new Error(
			"VirtualPad は VirtualPadProvider の内側で使用してください",
		);
	}
	let source = sources.get(name);
	if (source === undefined) {
		source = new VirtualPadSource();
		sources.set(name, source);
	}
	return source;
}

/**
 * 画面上の仮想スティック。ポインタ操作を方向入力に変換する。
 * name で書き込み先の入力源を選ぶ。省略すると既定の入力源に書き込む。
 * deadZone（0〜1）より小さな傾きは、向き 0 にする（省略時は 0。これまでどおり）。
 */
export function VirtualPad({
	size = 120,
	name,
	deadZone = 0,
}: {
	size?: number;
	name?: string;
	deadZone?: number;
}) {
	const source = useVirtualPadSource(name);
	const radius = size / 2;
	const knobSize = size * KNOB_RATIO;
	const stateRef = useRef<PadState>(IDLE_PAD);
	const knobRef = useRef<HTMLDivElement | null>(null);

	/** 状態を進め、入力源とつまみの見た目に反映する。 */
	function dispatch(event: PadEvent): void {
		const next = padReducer(stateRef.current, event, deadZone);
		stateRef.current = next;
		source.set(next.vector);
		const knob = knobRef.current;
		if (knob !== null) {
			const travel = radius - knobSize / 2;
			// 触っている間は指にすぐ付いていき、離したら短い時間で中心へ戻す。
			knob.style.transition =
				next.pointerId === null
					? `transform ${PAD_RETURN_MS}ms ease-out`
					: "none";
			knob.style.transform = `translate(${next.knob.x * travel}px, ${next.knob.y * travel}px)`;
		}
	}

	function offset(event: PointerEvent<HTMLDivElement>) {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: event.clientX - (rect.left + rect.width / 2),
			y: event.clientY - (rect.top + rect.height / 2),
		};
	}

	// 画面が隠れた・ウィンドウがフォーカスを失った・パッドが消えたときは、向きを 0 に戻す
	// （離した知らせが届かないまま、最後の向きが残らないように）。
	// biome-ignore lint/correctness/useExhaustiveDependencies: dispatch は最新の source と deadZone を読む
	useEffect(() => {
		const reset = () => dispatch({ type: "reset" });
		const onVisibility = () => {
			if (document.visibilityState === "hidden") reset();
		};
		window.addEventListener("blur", reset);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("blur", reset);
			document.removeEventListener("visibilitychange", onVisibility);
			reset();
		};
	}, [source]);

	return (
		<div
			aria-label={name === undefined ? "仮想パッド" : `仮想パッド（${name}）`}
			onPointerDown={(event) => {
				if (stateRef.current.pointerId === null) {
					event.currentTarget.setPointerCapture(event.pointerId);
				}
				dispatch({
					type: "down",
					pointerId: event.pointerId,
					radius,
					...offset(event),
				});
			}}
			onPointerMove={(event) =>
				dispatch({
					type: "move",
					pointerId: event.pointerId,
					radius,
					...offset(event),
				})
			}
			onPointerUp={(event) =>
				dispatch({ type: "up", pointerId: event.pointerId })
			}
			onPointerCancel={(event) =>
				dispatch({ type: "cancel", pointerId: event.pointerId })
			}
			onLostPointerCapture={(event) =>
				dispatch({ type: "lost", pointerId: event.pointerId })
			}
			style={{
				position: "relative",
				width: size,
				height: size,
				borderRadius: "50%",
				touchAction: "none",
				userSelect: "none",
			}}
		>
			<div
				ref={knobRef}
				aria-hidden="true"
				style={{
					position: "absolute",
					left: radius - knobSize / 2,
					top: radius - knobSize / 2,
					width: knobSize,
					height: knobSize,
					borderRadius: "50%",
					background: "currentColor",
					opacity: 0.35,
					pointerEvents: "none",
				}}
			/>
		</div>
	);
}

/**
 * 現在の方向入力 (x, y) を返す。入力元（VirtualPad）を知らずに使える。
 * name で入力源を選ぶ（例: "move" / "look"）。省略すると既定の入力源を読む。
 */
export function useVirtualPad(name?: string): Direction {
	return useInput(useVirtualPadSource(name));
}
