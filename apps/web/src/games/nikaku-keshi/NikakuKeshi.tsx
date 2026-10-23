"use client";

/**
 * link（内部名 nikaku-keshi / 二角消去）本体（ソロゲーム / ADR 0004 / issue-37）。
 *
 * 規則と進行は board.ts / game.ts の純粋関数に委ね、ここは描画・タップ・タイマーだけを
 * 受け持つ。サーバーは使わない。全部消したらクリア表示（時間・シャッフル回数・お助け回数）
 * を出し、「おわる」で useSoloGame の reportResult を呼ぶ（スコアはクリアまでの秒数）。
 *
 * 画面いっぱいの枠（GameFrame）の中で、上から時間の行・盤・ボタンの行を並べ、スクロールなしで収める。
 * 牌の大きさは、枠の中身の幅と高さから決める（platform/layout/fitBoard.ts）。シャッフルの案内・
 * 止まったときの案内・クリアの表示は、盤の上に重ねて出す（盤の下の高さを、ボタン 1 行に保つ）。
 */

import { useSoloGame } from "@rondo/game-sdk";
import { useEffect, useReducer, useState } from "react";
import { fitCell } from "../../platform/layout/fitBoard";
import { useBoxSize } from "../../platform/layout/useBoxSize";
import { type Board, COLS, type Cell, ROWS, createBoard } from "./board";
import {
	type GameState,
	askHint,
	autoStep,
	canShuffle,
	hintLabel,
	manualShuffle,
	startGame,
	tap,
} from "./game";
import { nikakuKeshiManifest } from "./manifest";
import { faceOf } from "./tiles";

/** 「答えを見る」で1組ずつ消す間隔（ミリ秒）。 */
const AUTO_INTERVAL_MS = 500;

/** 牌の高さ ÷ 幅（4:5）。 */
const TILE_ASPECT = 1.25;
/** 牌どうしの隙間（px。gap-1）。 */
const TILE_GAP = 4;
/** 牌の幅の上限（px）。大きな画面で、盤が大きくなりすぎないように。 */
const TILE_MAX = 64;
/** 盤の上下の並び（px）: 上の余白 8 + 時間の行 20 + 隙間 12 + 隙間 12 + ボタンの行 44 + 下の余白 12。 */
const RESERVED_HEIGHT = 8 + 20 + 12 + 12 + 44 + 12;
/** 左右の余白（px。px-4 の両側）。 */
const SIDE_PADDING = 32;

type Action =
	| { readonly type: "tap"; readonly cell: Cell }
	| { readonly type: "hint" }
	| { readonly type: "shuffle" }
	| { readonly type: "auto-step" }
	| { readonly type: "restart"; readonly board: Board };

function reducer(state: GameState, action: Action): GameState {
	switch (action.type) {
		case "tap":
			return tap(state, action.cell);
		case "hint":
			return askHint(state);
		case "shuffle":
			return manualShuffle(state, Math.random);
		case "auto-step":
			return autoStep(state, Math.random);
		case "restart":
			return startGame(action.board);
	}
}

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export default function NikakuKeshi() {
	// 乱数で配置するので、サーバー描画との食い違いを避けてマウント後に作る。
	const [board, setBoard] = useState<Board | null>(null);
	useEffect(() => {
		setBoard(createBoard(Math.random));
	}, []);

	if (board === null) {
		return <p className="text-fg-muted text-sm">牌を並べています…</p>;
	}
	return <Play initial={board} />;
}

function Play({ initial }: { initial: Board }) {
	const { reportResult } = useSoloGame(nikakuKeshiManifest);
	const [state, dispatch] = useReducer(reducer, initial, startGame);
	const [startedAt, setStartedAt] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const [finishedAt, setFinishedAt] = useState<number | null>(null);

	// 経過時間の表示。
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, []);

	// クリアした瞬間の時刻を残す。
	useEffect(() => {
		if (state.mode === "cleared" && finishedAt === null) {
			setFinishedAt(Date.now());
		}
	}, [state.mode, finishedAt]);

	// 「答えを見る」の間は、0.5 秒ごとに1歩ずつ進める。
	useEffect(() => {
		if (state.mode !== "auto") return;
		const timer = setInterval(
			() => dispatch({ type: "auto-step" }),
			AUTO_INTERVAL_MS,
		);
		return () => clearInterval(timer);
	}, [state.mode]);

	const seconds = Math.floor(((finishedAt ?? now) - startedAt) / 1000);

	const restart = () => {
		dispatch({ type: "restart", board: createBoard(Math.random) });
		setStartedAt(Date.now());
		setNow(Date.now());
		setFinishedAt(null);
	};

	const isMarked = (cell: Cell, pair: readonly Cell[] | null) =>
		pair?.some((p) => p.x === cell.x && p.y === cell.y) ?? false;

	// 牌の大きさ（枠の中身の大きさから。測る前は 0 で、盤を描かない）。
	const [boxRef, box] = useBoxSize<HTMLDivElement>();
	const tile =
		box === null
			? 0
			: fitCell({
					width: box.width - SIDE_PADDING,
					height: box.height,
					reserved: RESERVED_HEIGHT,
					cols: COLS,
					rows: ROWS,
					aspect: TILE_ASPECT,
					gap: TILE_GAP,
					max: TILE_MAX,
				});
	const topSize = Math.round(tile * 0.5);
	const bottomSize = Math.round(tile * 0.4);

	return (
		<div
			ref={boxRef}
			className="flex min-h-0 w-full flex-1 flex-col items-center gap-3 px-4 pt-2 pb-3"
		>
			<div className="flex h-5 w-full max-w-sm items-center justify-between text-sm">
				<span className="font-semibold text-fg">{formatTime(seconds)}</span>
				<span className="text-fg-muted">
					シャッフル {state.shuffles} 回 ・お助け {state.hintsUsed} 回
				</span>
			</div>

			<div className="relative">
				<div
					className="grid"
					style={{
						gridTemplateColumns: `repeat(${COLS}, ${tile}px)`,
						gap: TILE_GAP,
					}}
					data-testid="nikaku-board"
				>
					{state.board.flatMap((row, y) =>
						row.map((tileValue, x) => {
							const cell = { x, y };
							const key = `${x}-${y}`;
							if (tileValue === null) {
								return (
									<div key={key} aria-hidden="true" className="aspect-[4/5]" />
								);
							}
							const face = faceOf(tileValue);
							const selected =
								state.selected !== null && isMarked(cell, [state.selected]);
							const hinted = isMarked(cell, state.highlight);
							return (
								<button
									key={key}
									type="button"
									aria-label={face.label}
									aria-pressed={selected}
									onClick={() => dispatch({ type: "tap", cell })}
									className={`flex aspect-[4/5] flex-col items-center justify-center rounded-md bg-amber-50 font-bold leading-none shadow-[0_3px_0_0] shadow-amber-200 ${face.color} ${
										selected
											? "ring-4 ring-accent"
											: hinted
												? "ring-4 ring-sub"
												: "ring-1 ring-amber-200"
									}`}
								>
									<span style={{ fontSize: topSize }}>{face.top}</span>
									{face.bottom !== undefined ? (
										<span style={{ fontSize: bottomSize }}>{face.bottom}</span>
									) : null}
								</button>
							);
						}),
					)}
				</div>

				{state.mode === "playing" && canShuffle(state) ? (
					<div className="absolute inset-0 flex items-center justify-center p-3">
						<button
							type="button"
							onClick={() => dispatch({ type: "shuffle" })}
							className="min-h-12 w-full rounded-xl bg-accent px-3 font-semibold text-accent-fg shadow-lg"
						>
							消せるペアがありません。シャッフルする
						</button>
					</div>
				) : null}

				{state.mode === "halted" ? (
					<div className="absolute inset-0 flex items-center justify-center p-3">
						<div className="flex w-full flex-col gap-2 rounded-2xl bg-surface p-4 text-center shadow-lg">
							<p className="text-fg text-sm">{state.haltReason}</p>
							<button
								type="button"
								onClick={restart}
								className="min-h-11 rounded-xl bg-accent px-3 font-semibold text-accent-fg"
							>
								やり直す
							</button>
						</div>
					</div>
				) : null}

				{state.mode === "cleared" ? (
					<div className="absolute inset-0 flex items-center justify-center p-3">
						<div className="flex w-full flex-col gap-3 rounded-2xl bg-surface p-4 text-center shadow-lg">
							<p className="font-bold text-fg text-xl">クリア！</p>
							<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-left text-sm">
								<dt className="text-fg-muted">クリアまでの時間</dt>
								<dd className="text-fg">{formatTime(seconds)}</dd>
								<dt className="text-fg-muted">シャッフル</dt>
								<dd className="text-fg">{state.shuffles} 回</dd>
								<dt className="text-fg-muted">お助け</dt>
								<dd className="text-fg">{state.hintsUsed} 回</dd>
							</dl>
							<div className="grid grid-cols-2 gap-2">
								<button
									type="button"
									onClick={restart}
									className="min-h-11 rounded-xl bg-surface px-3 text-fg text-sm ring-1 ring-line ring-inset"
								>
									やり直す
								</button>
								<button
									type="button"
									onClick={() =>
										reportResult({
											score: seconds,
											details: {
												time: formatTime(seconds),
												shuffles: state.shuffles,
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
					</div>
				) : null}
			</div>

			{state.mode === "playing" ? (
				<div
					className="grid w-full max-w-sm grid-cols-2 gap-2"
					data-testid="nikaku-actions"
				>
					<button
						type="button"
						onClick={() => dispatch({ type: "hint" })}
						className="min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
					>
						{hintLabel(state)}
					</button>
					<button
						type="button"
						onClick={restart}
						className="min-h-11 rounded-xl bg-surface px-3 text-fg text-sm ring-1 ring-line ring-inset"
					>
						やり直す
					</button>
				</div>
			) : null}

			{state.mode === "auto" ? (
				<p className="text-center text-fg-muted text-sm">
					答えを見ています（1組ずつ自動で消します）
				</p>
			) : null}
		</div>
	);
}
