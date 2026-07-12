"use client";

/**
 * Tilt Maze 本体（リアルタイムゲーム / ADR 0004）。
 *
 * 盤面規則と物理は engine.ts の純粋関数に委ね、ここは描画・ループ・入力・通知だけを
 * 受け持つ。入力は共通 VirtualPad（ADR 0018）の方向を球への加速度として使う。物理は
 * クライアントで回すが、ゴール到達は useRealtimeGame().send でサーバーへ通知するだけで、
 * 順位はサーバー受信順が確定する（ADR 0014）。クライアントは決定権を持たない。
 */

import {
	type GamePayload,
	VirtualPad,
	useRealtimeGame,
	useVirtualPad,
} from "@rondo/game-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	BALL_R,
	type Ball,
	CELL,
	type Level,
	TOTAL_LEVELS,
	atGoal,
	createRun,
	levelAt,
	startBall,
	stepBall,
} from "./engine";
import { tiltMazeManifest } from "./manifest";

const WALL_COLOR = "#0f172a";
const FLOOR_COLOR = "#1e293b";
const GOAL_COLOR = "#4ade80";
const BALL_COLOR = "#facc15";

/** 1 フレームの最大 dt（秒）。タブ復帰時の大ジャンプで壁をすり抜けないよう抑える。 */
const MAX_DT = 0.05;

/** ゴール到達の通知ペイロード。何面のゴールかを載せる（順位判定はサーバー / ADR 0014）。 */
interface GoalEvent extends GamePayload {
	readonly type: "goal";
	readonly level: number;
}

function drawMaze(
	ctx: CanvasRenderingContext2D,
	level: Level,
	ball: Ball,
): void {
	ctx.fillStyle = WALL_COLOR;
	ctx.fillRect(0, 0, level.widthPx, level.heightPx);

	for (let gy = 0; gy < level.gridRows; gy++) {
		const row = level.grid[gy] ?? [];
		for (let gx = 0; gx < level.gridCols; gx++) {
			if (!row[gx]) {
				ctx.fillStyle = FLOOR_COLOR;
				ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
			}
		}
	}

	ctx.fillStyle = GOAL_COLOR;
	ctx.fillRect(level.goalCell.gx * CELL, level.goalCell.gy * CELL, CELL, CELL);

	ctx.fillStyle = BALL_COLOR;
	ctx.beginPath();
	ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
	ctx.fill();
}

export default function TiltMaze() {
	const { send } = useRealtimeGame(tiltMazeManifest);
	const direction = useVirtualPad();

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const runRef = useRef(createRun());
	const directionRef = useRef(direction);
	directionRef.current = direction;
	const sendRef = useRef(send);
	sendRef.current = send;

	const [levelIndex, setLevelIndex] = useState(0);
	const [cleared, setCleared] = useState(false);

	const reset = useCallback(() => {
		runRef.current = createRun();
		setLevelIndex(0);
		setCleared(false);
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d") ?? null;
		if (canvas === null || ctx === null) return;

		let raf = 0;
		let last = performance.now();
		let drawnLevel = -1;

		const frame = (now: number) => {
			const dt = Math.min((now - last) / 1000, MAX_DT);
			last = now;

			const run = runRef.current;
			if (!run.cleared) {
				const level = levelAt(run.levelIndex);
				const ball = stepBall(level, run.ball, directionRef.current, dt);

				if (atGoal(level, ball)) {
					const completed = run.levelIndex + 1;
					// ゴール到達をサーバーへ通知する（順位はサーバーが決める / ADR 0014）。
					const event: GoalEvent = { type: "goal", level: completed };
					sendRef.current(event);
					if (completed >= TOTAL_LEVELS) {
						runRef.current = { ...run, ball, cleared: true };
						setCleared(true);
					} else {
						runRef.current = {
							levelIndex: completed,
							ball: startBall(levelAt(completed)),
							cleared: false,
						};
						setLevelIndex(completed);
					}
				} else {
					runRef.current = { ...run, ball };
				}
			}

			const current = runRef.current;
			const level = levelAt(current.levelIndex);
			if (drawnLevel !== current.levelIndex) {
				canvas.width = level.widthPx;
				canvas.height = level.heightPx;
				drawnLevel = current.levelIndex;
			}
			drawMaze(ctx, level, current.ball);

			raf = requestAnimationFrame(frame);
		};

		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<div className="flex flex-col items-center gap-5">
			<p className="text-slate-300 text-sm">
				面 {Math.min(levelIndex + 1, TOTAL_LEVELS)} / {TOTAL_LEVELS}
			</p>

			<canvas
				ref={canvasRef}
				className="w-full max-w-[min(90vw,360px)] rounded-lg"
			/>

			{cleared && (
				<div className="flex flex-col items-center gap-3 rounded-2xl bg-slate-800 p-5">
					<p className="font-bold text-lg text-white">10 面クリア！</p>
					<p className="text-slate-400 text-sm">
						順位はサーバーが受信順で確定する（ADR 0014）。
					</p>
					<button
						type="button"
						onClick={reset}
						className="rounded-xl bg-indigo-600 px-4 py-2 font-semibold text-white"
					>
						もう一度
					</button>
				</div>
			)}

			<p className="text-slate-500 text-xs">パッドを倒した向きに球が転がる</p>
			<div className="rounded-full bg-slate-800 ring-1 ring-slate-700 ring-inset">
				<VirtualPad size={140} />
			</div>
		</div>
	);
}
