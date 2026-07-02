/**
 * 基盤共通の仮想パッド（ADR 0018）。
 *
 * VirtualPadProvider が入力源をサブツリーに供給し、VirtualPad が画面上のスティックを
 * 方向入力に変換する。ゲームは useVirtualPad で (x, y) だけを受け取り、入力元を知らない。
 */

import {
	type PointerEvent,
	type ReactNode,
	createContext,
	useContext,
	useRef,
} from "react";
import type { Direction } from "../input/port";
import { VirtualPadSource } from "../input/virtual-pad";
import { useInput } from "./use-input";

const VirtualPadContext = createContext<VirtualPadSource | null>(null);

/** VirtualPad の入力源をサブツリーに供給する。 */
export function VirtualPadProvider({ children }: { children: ReactNode }) {
	const ref = useRef<VirtualPadSource | null>(null);
	let source = ref.current;
	if (source === null) {
		source = new VirtualPadSource();
		ref.current = source;
	}
	return (
		<VirtualPadContext.Provider value={source}>
			{children}
		</VirtualPadContext.Provider>
	);
}

function useVirtualPadSource(): VirtualPadSource {
	const source = useContext(VirtualPadContext);
	if (source === null) {
		throw new Error(
			"VirtualPad は VirtualPadProvider の内側で使用してください",
		);
	}
	return source;
}

/** 画面上の仮想スティック。ポインタ操作を方向入力に変換する。 */
export function VirtualPad({ size = 120 }: { size?: number }) {
	const source = useVirtualPadSource();
	const radius = size / 2;

	function moveFrom(event: PointerEvent<HTMLDivElement>): void {
		const rect = event.currentTarget.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		source.move(event.clientX - centerX, event.clientY - centerY, radius);
	}

	return (
		<div
			aria-label="仮想パッド"
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				moveFrom(event);
			}}
			onPointerMove={(event) => {
				if (event.buttons > 0) moveFrom(event);
			}}
			onPointerUp={() => source.release()}
			onPointerCancel={() => source.release()}
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				touchAction: "none",
				userSelect: "none",
			}}
		/>
	);
}

/** 現在の方向入力 (x, y) を返す。入力元（VirtualPad）を知らずに使える。 */
export function useVirtualPad(): Direction {
	return useInput(useVirtualPadSource());
}
