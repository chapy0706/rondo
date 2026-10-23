"use client";

/**
 * 要素の中身の大きさ（幅と高さ。px）を測る。大きさが変わるたびに測り直す（ResizeObserver）。
 * 測る前（サーバーの描画・最初の描画）は null。盤のマスの大きさ（fitBoard.ts）に渡す。
 */

import { type RefObject, useEffect, useRef, useState } from "react";

export interface BoxSize {
	readonly width: number;
	readonly height: number;
}

export function useBoxSize<T extends HTMLElement>(): [
	RefObject<T | null>,
	BoxSize | null,
] {
	const ref = useRef<T | null>(null);
	const [size, setSize] = useState<BoxSize | null>(null);
	useEffect(() => {
		const element = ref.current;
		if (element === null) return;
		const measure = () => {
			const width = element.clientWidth;
			const height = element.clientHeight;
			setSize((current) =>
				current !== null && current.width === width && current.height === height
					? current
					: { width, height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, size];
}
