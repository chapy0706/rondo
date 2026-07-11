"use client";

/**
 * テトリス本体（ソロゲーム / ADR 0004）。
 *
 * 盤面規則は engine.ts の純粋関数に委ね、ここは描画・ゲームループ・入力・結果返却
 * だけを受け持つ。入力は基盤共通の VirtualPad（ADR 0018）から方向 (x, y) を読み、
 * 左右移動・回転・ソフトドロップに割り当てる。終了時に useSoloGame でスコアを基盤へ
 * 返す。リアルタイム接続は一切受け取らない。
 */

import { VirtualPad, useSoloGame, useVirtualPad } from "@rondo/game-sdk";
import { useEffect, useRef, useState } from "react";
import {
	type Cell,
	type GameState,
	HEIGHT,
	type PieceType,
	WIDTH,
	createGame,
	gravityInterval,
	moveLeft,
	moveRight,
	renderBoard,
	rotate,
	step,
} from "./engine";
import { tetrisManifest } from "./manifest";

/** 1 セルの描画サイズ（px）。CSS で画面幅に合わせて縮める。 */
const CELL = 28;
const CANVAS_WIDTH = WIDTH * CELL;
const CANVAS_HEIGHT = HEIGHT * CELL;

/** 空セルの色。 */
const EMPTY_COLOR = "#1e293b";

/** ピース種別ごとの色。 */
const COLORS: Record<PieceType, string> = {
	I: "#22d3ee",
	O: "#facc15",
	T: "#c084fc",
	S: "#4ade80",
	Z: "#f87171",
	J: "#60a5fa",
	L: "#fb923c",
};

/** 方向入力の閾値。これを越えたら「その向きに入れた」とみなす。 */
const THRESHOLD = 0.5;
/** 横移動の初動待ち（ms）と連続移動間隔（ms）。 */
const DAS_MS = 160;
const ARR_MS = 50;
/** ソフトドロップの落下間隔（ms）。 */
const SOFT_DROP_MS = 45;

function drawBoard(
	ctx: CanvasRenderingContext2D,
	board: readonly (readonly Cell[])[],
): void {
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const cell = board[y]?.[x] ?? null;
			ctx.fillStyle = cell ? COLORS[cell] : EMPTY_COLOR;
			ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
		}
	}
}

export default function Tetris() {
	const { reportResult } = useSoloGame(tetrisManifest);
	const direction = useVirtualPad();

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const stateRef = useRef<GameState>(createGame());
	const directionRef = useRef(direction);
	directionRef.current = direction;
	const reportRef = useRef(reportResult);
	reportRef.current = reportResult;

	const [stats, setStats] = useState({ score: 0, lines: 0, level: 1 });

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d") ?? null;
		if (ctx === null) return;

		let raf = 0;
		let last = performance.now();
		let gravityAcc = 0;
		let dasDir = 0;
		let dasTimer = 0;
		let softTimer = 0;
		let prevUp = false;
		let reported = false;
		let shown = { score: 0, lines: 0, level: 1 };

		const moveHorizontally = (dir: number) => {
			stateRef.current =
				dir < 0 ? moveLeft(stateRef.current) : moveRight(stateRef.current);
		};

		const frame = (now: number) => {
			const dt = now - last;
			last = now;

			const input = directionRef.current;
			const xDir = input.x < -THRESHOLD ? -1 : input.x > THRESHOLD ? 1 : 0;
			const down = input.y > THRESHOLD;
			const up = input.y < -THRESHOLD;

			// 横移動（初動 + 一定間隔のリピート）。
			if (xDir !== 0) {
				if (xDir !== dasDir) {
					dasDir = xDir;
					dasTimer = DAS_MS;
					moveHorizontally(xDir);
				} else {
					dasTimer -= dt;
					if (dasTimer <= 0) {
						dasTimer += ARR_MS;
						moveHorizontally(xDir);
					}
				}
			} else {
				dasDir = 0;
			}

			// 回転は入れた瞬間だけ（押しっぱなしで回り続けない）。
			if (up && !prevUp) stateRef.current = rotate(stateRef.current);
			prevUp = up;

			// ソフトドロップ。
			if (down) {
				softTimer -= dt;
				if (softTimer <= 0) {
					softTimer += SOFT_DROP_MS;
					stateRef.current = step(stateRef.current);
					gravityAcc = 0;
				}
			} else {
				softTimer = 0;
			}

			// 自動落下。
			gravityAcc += dt;
			const interval = gravityInterval(stateRef.current.level);
			while (gravityAcc >= interval && !stateRef.current.gameOver) {
				stateRef.current = step(stateRef.current);
				gravityAcc -= interval;
			}

			drawBoard(ctx, renderBoard(stateRef.current));

			const s = stateRef.current;
			if (
				s.score !== shown.score ||
				s.lines !== shown.lines ||
				s.level !== shown.level
			) {
				shown = { score: s.score, lines: s.lines, level: s.level };
				setStats(shown);
			}

			if (s.gameOver) {
				if (!reported) {
					reported = true;
					reportRef.current({
						score: s.score,
						details: { lines: s.lines, level: s.level },
					});
				}
				return;
			}
			raf = requestAnimationFrame(frame);
		};

		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<div className="flex flex-col items-center gap-5">
			<div className="flex w-full max-w-[min(90vw,320px)] justify-between text-slate-300 text-sm">
				<span>スコア {stats.score}</span>
				<span>ライン {stats.lines}</span>
				<span>レベル {stats.level}</span>
			</div>

			<canvas
				ref={canvasRef}
				width={CANVAS_WIDTH}
				height={CANVAS_HEIGHT}
				className="w-full max-w-[min(90vw,320px)] rounded-lg"
			/>

			<p className="text-slate-500 text-xs">
				パッド: 左右で移動・上で回転・下でソフトドロップ
			</p>
			<div className="rounded-full bg-slate-800 ring-1 ring-slate-700 ring-inset">
				<VirtualPad size={140} />
			</div>
		</div>
	);
}
