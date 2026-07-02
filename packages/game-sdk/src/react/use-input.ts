import { useSyncExternalStore } from "react";
import type { Direction, InputPort } from "../input/port";

/**
 * InputPort の方向入力を購読し、リアクティブな (x, y) を返す。
 * 入力元（VirtualPad など）を知らずに使える。
 */
export function useInput(port: InputPort): Direction {
	return useSyncExternalStore(
		(onChange) => port.subscribe(onChange),
		() => port.read(),
		() => port.read(),
	);
}
