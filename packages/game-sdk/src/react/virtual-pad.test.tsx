import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Direction } from "../input/port";
import type { VirtualPadSource } from "../input/virtual-pad";
import {
	VirtualPad,
	VirtualPadProvider,
	useVirtualPad,
	useVirtualPadSource,
} from "./virtual-pad";

/**
 * サーバー描画は1回きりなので、木の前にある Drive が入力源を動かし、
 * 後ろにある Read がフックで読む。描画は木の順に進むため、動かした値が読める。
 */
function Drive({
	name,
	x,
	y,
}: {
	name?: string;
	x: number;
	y: number;
}) {
	useVirtualPadSource(name).move(x * 10, y * 10, 10);
	return null;
}

function Read({
	name,
	into,
}: {
	name?: string;
	into: (direction: Direction) => void;
}) {
	const direction = name === undefined ? useVirtualPad() : useVirtualPad(name);
	into(direction);
	return null;
}

function render(children: ReactNode): void {
	renderToStaticMarkup(<VirtualPadProvider>{children}</VirtualPadProvider>);
}

describe("既存ゲームの回帰: 引数なしの useVirtualPad()", () => {
	it("入力がなければ中立を返す", () => {
		let read: Direction | undefined;
		render(
			<Read
				into={(d) => {
					read = d;
				}}
			/>,
		);
		expect(read).toEqual({ x: 0, y: 0 });
	});

	it("名前なしの VirtualPad と同じ入力源を読む（テトリス・Tilt Maze の使い方）", () => {
		let fromHook: VirtualPadSource | undefined;
		let fromDefault: VirtualPadSource | undefined;
		function Probe() {
			fromHook = useVirtualPadSource();
			fromDefault = useVirtualPadSource(undefined);
			return <VirtualPad size={140} />;
		}
		render(<Probe />);
		expect(fromHook).toBeDefined();
		expect(fromHook).toBe(fromDefault);
	});

	it("既定の入力源を動かすと、引数なしの useVirtualPad() に反映される", () => {
		let read: Direction | undefined;
		render(
			<>
				<Drive x={-1} y={0.5} />
				<Read
					into={(d) => {
						read = d;
					}}
				/>
			</>,
		);
		expect(read).toEqual({ x: -1, y: 0.5 });
	});

	it("名前付きの入力源を動かしても、引数なしの useVirtualPad() は変わらない", () => {
		let read: Direction | undefined;
		render(
			<>
				<Drive name="move" x={1} y={0} />
				<Drive name="look" x={0} y={-1} />
				<Read
					into={(d) => {
						read = d;
					}}
				/>
			</>,
		);
		expect(read).toEqual({ x: 0, y: 0 });
	});

	it("VirtualPad は Provider の外では使えない（従来どおり）", () => {
		expect(() => renderToStaticMarkup(<VirtualPad />)).toThrow(
			"VirtualPadProvider",
		);
	});
});

describe("2本入力: useVirtualPad(name)", () => {
	it('"move" と "look" がそれぞれ独立した方向入力を返す', () => {
		let move: Direction | undefined;
		let look: Direction | undefined;
		render(
			<>
				<Drive name="move" x={1} y={0} />
				<Drive name="look" x={0} y={-0.5} />
				<Read
					name="move"
					into={(d) => {
						move = d;
					}}
				/>
				<Read
					name="look"
					into={(d) => {
						look = d;
					}}
				/>
			</>,
		);
		expect(move).toEqual({ x: 1, y: 0 });
		expect(look).toEqual({ x: 0, y: -0.5 });
	});

	it("既定の入力源を動かしても、名前付きの入力源は変わらない", () => {
		let move: Direction | undefined;
		render(
			<>
				<Drive x={1} y={1} />
				<Read
					name="move"
					into={(d) => {
						move = d;
					}}
				/>
			</>,
		);
		expect(move).toEqual({ x: 0, y: 0 });
	});

	it("同じ名前は同じ入力源を指し、名前ごとに別の入力源になる", () => {
		const seen: VirtualPadSource[] = [];
		function Probe() {
			seen.push(
				useVirtualPadSource("look"),
				useVirtualPadSource("look"),
				useVirtualPadSource("move"),
				useVirtualPadSource(),
			);
			return null;
		}
		render(<Probe />);
		const [look1, look2, move, fallback] = seen;
		expect(look1).toBe(look2);
		expect(move).not.toBe(look1);
		expect(fallback).not.toBe(move);
		expect(fallback).not.toBe(look1);
	});

	it("Provider ごとに入力源は別になる", () => {
		const seen: VirtualPadSource[] = [];
		function Probe() {
			seen.push(useVirtualPadSource("look"));
			return null;
		}
		render(<Probe />);
		render(<Probe />);
		expect(seen[0]).not.toBe(seen[1]);
	});
});
