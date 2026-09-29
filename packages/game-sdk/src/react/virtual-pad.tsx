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

/** 名前を省略したときの入力源の名前。 */
const DEFAULT_PAD = "default";

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
 */
export function VirtualPad({
	size = 120,
	name,
}: {
	size?: number;
	name?: string;
}) {
	const source = useVirtualPadSource(name);
	const radius = size / 2;

	function moveFrom(event: PointerEvent<HTMLDivElement>): void {
		const rect = event.currentTarget.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		source.move(event.clientX - centerX, event.clientY - centerY, radius);
	}

	return (
		<div
			aria-label={name === undefined ? "仮想パッド" : `仮想パッド（${name}）`}
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

/**
 * 現在の方向入力 (x, y) を返す。入力元（VirtualPad）を知らずに使える。
 * name で入力源を選ぶ（例: "move" / "look"）。省略すると既定の入力源を読む。
 */
export function useVirtualPad(name?: string): Direction {
	return useInput(useVirtualPadSource(name));
}
