"use client";

/**
 * chess（内部名 minichess / 5×5 チェス）本体（ソロゲーム / ADR 0004 / issue-38）。
 *
 * 規則・進行・CPU は rules.ts / game.ts / cpu.ts の純粋関数に委ね、ここは描画・タップ・
 * CPU の手番の待ち時間だけを受け持つ。サーバーは使わない。勝敗が決まったら結果を表示し、
 * 「おわる」で useSoloGame の reportResult を呼ぶ（スコアは勝ち 1・引き分け 0.5・負け 0）。
 */

import { useSoloGame } from "@rondo/game-sdk";
import { useEffect, useMemo, useReducer } from "react";
import { type MoveChooser, simpleCpu } from "./cpu";
import {
	type GameState,
	type Outcome,
	PLAYER,
	askHint,
	cpuMove,
	movesFrom,
	outcome,
	startGame,
	tapSquare,
} from "./game";
import { minichessManifest } from "./manifest";
import { type Move, type Piece, SIZE, type Square } from "./rules";

/** CPU が指すまでの間（ミリ秒）。指した手が見えるように少し待つ。 */
const CPU_DELAY_MS = 500;

const SYMBOLS: Readonly<Record<Piece["type"], string>> = {
	K: "♚",
	Q: "♛",
	R: "♜",
	B: "♝",
	N: "♞",
	P: "♟",
};

const NAMES: Readonly<Record<Piece["type"], string>> = {
	K: "キング",
	Q: "クイーン",
	R: "ルーク",
	B: "ビショップ",
	N: "ナイト",
	P: "ポーン",
};

type Action =
	| { readonly type: "tap"; readonly square: Square }
	| { readonly type: "hint" }
	| { readonly type: "cpu" }
	| { readonly type: "restart" };

function reducer(chooser: MoveChooser) {
	return (state: GameState, action: Action): GameState => {
		switch (action.type) {
			case "tap":
				return tapSquare(state, action.square);
			case "hint":
				return askHint(state, chooser);
			case "cpu":
				return cpuMove(state, chooser);
			case "restart":
				return startGame();
		}
	};
}

function squareName(sq: Square): string {
	return `${"abcde"[sq.file]}${sq.rank + 1}`;
}

function isAt(sq: Square, move: Move | null, end: "from" | "to"): boolean {
	return (
		move !== null && move[end].file === sq.file && move[end].rank === sq.rank
	);
}

function headline(result: Outcome, cpuThinking: boolean): string {
	switch (result.kind) {
		case "win":
			return "チェックメイト。あなたの勝ち";
		case "lose":
			return "チェックメイト。あなたの負け";
		case "draw":
			return result.reason === "stalemate"
				? "ステイルメイト。引き分け"
				: "50手ルールで引き分け";
		case "playing":
			if (cpuThinking) return "CPU の番";
			return result.check ? "王手！ あなたの番" : "あなたの番（白）";
	}
}

export default function Minichess() {
	const { reportResult } = useSoloGame(minichessManifest);
	// CPU とお助けは同じ選び方を使う（issue-38）。
	const chooser = useMemo(() => simpleCpu(Math.random), []);
	const [state, dispatch] = useReducer(
		useMemo(() => reducer(chooser), [chooser]),
		undefined,
		startGame,
	);
	const result = outcome(state);
	const cpuThinking =
		result.kind === "playing" && state.position.turn !== PLAYER;

	// CPU の番になったら、少し待ってから指す。
	useEffect(() => {
		if (!cpuThinking) return;
		const timer = setTimeout(() => dispatch({ type: "cpu" }), CPU_DELAY_MS);
		return () => clearTimeout(timer);
	}, [cpuThinking]);

	const targets = movesFrom(state);
	const ranks = Array.from({ length: SIZE }, (_, i) => SIZE - 1 - i);
	const files = Array.from({ length: SIZE }, (_, i) => i);

	return (
		<div className="flex w-full flex-col gap-3">
			<div className="flex items-center justify-between text-sm">
				<output
					className={`font-semibold ${
						result.kind === "playing" && result.check && !cpuThinking
							? "text-accent"
							: "text-fg"
					}`}
				>
					{headline(result, cpuThinking)}
				</output>
				<span className="text-fg-muted">お助け {state.hintsUsed} 回</span>
			</div>

			<div className="grid grid-cols-5 overflow-hidden rounded-lg ring-1 ring-line">
				{ranks.flatMap((rank) =>
					files.map((file) => {
						const sq = { file, rank };
						const piece = state.position.board[rank]?.[file] ?? null;
						const dark = (file + rank) % 2 === 0;
						const selected =
							state.selected !== null &&
							state.selected.file === file &&
							state.selected.rank === rank;
						const target = targets.find(
							(m) => m.to.file === file && m.to.rank === rank,
						);
						const hinted =
							isAt(sq, state.hint, "from") || isAt(sq, state.hint, "to");
						const last =
							isAt(sq, state.lastMove, "from") ||
							isAt(sq, state.lastMove, "to");
						const label = `${squareName(sq)}${
							piece === null
								? ""
								: ` ${piece.color === "w" ? "白" : "黒"}の${NAMES[piece.type]}`
						}`;
						return (
							<button
								key={squareName(sq)}
								type="button"
								aria-label={label}
								aria-pressed={selected}
								onClick={() => dispatch({ type: "tap", square: sq })}
								className={`relative flex aspect-square items-center justify-center text-4xl leading-none ${
									dark ? "bg-amber-700/70" : "bg-amber-100"
								} ${
									selected
										? "ring-4 ring-accent ring-inset"
										: hinted
											? "ring-4 ring-sub ring-inset"
											: last
												? "ring-2 ring-amber-400 ring-inset"
												: ""
								}`}
							>
								{piece !== null ? (
									<span
										className={
											piece.color === "w"
												? "text-white [text-shadow:0_0_2px_#000,0_1px_2px_#000]"
												: "text-slate-950"
										}
									>
										{SYMBOLS[piece.type]}
									</span>
								) : null}
								{target !== undefined ? (
									<span
										aria-hidden="true"
										className={`absolute rounded-full bg-accent/60 ${
											target.captured !== null
												? "inset-1 bg-transparent ring-4 ring-accent/70"
												: "size-1/4"
										}`}
									/>
								) : null}
							</button>
						);
					}),
				)}
			</div>

			{result.kind === "playing" ? (
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						disabled={cpuThinking}
						onClick={() => dispatch({ type: "hint" })}
						className="min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset disabled:opacity-50"
					>
						お助け
					</button>
					<button
						type="button"
						onClick={() => dispatch({ type: "restart" })}
						className="min-h-11 rounded-xl bg-surface px-3 text-fg text-sm ring-1 ring-line ring-inset"
					>
						やり直す
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 text-center">
					<p className="font-bold text-fg text-xl">
						{result.kind === "win"
							? "勝ち！"
							: result.kind === "lose"
								? "負け"
								: "引き分け"}
					</p>
					<p className="text-fg-muted text-sm">
						お助けを使った回数: {state.hintsUsed} 回
					</p>
					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={() => dispatch({ type: "restart" })}
							className="min-h-11 rounded-xl bg-surface px-3 text-fg text-sm ring-1 ring-line ring-inset"
						>
							やり直す
						</button>
						<button
							type="button"
							onClick={() =>
								reportResult({
									score:
										result.kind === "win"
											? 1
											: result.kind === "draw"
												? 0.5
												: 0,
									details: {
										result:
											result.kind === "win"
												? "勝ち"
												: result.kind === "lose"
													? "負け"
													: "引き分け",
										hints: state.hintsUsed,
									},
								})
							}
							className="min-h-11 rounded-xl bg-accent px-3 font-semibold text-accent-fg"
						>
							おわる
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
