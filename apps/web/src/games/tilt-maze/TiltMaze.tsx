"use client";

/**
 * rolling 本体（内部名 tilt-maze / リアルタイムゲーム / ADR 0004）。
 *
 * 始める前にモード選択を出す（issue-36）。1人モードで本編へ進み、対戦モードは準備中の
 * お知らせを出して、閉じるとモード選択に戻る（通信・ルーム作成・画面遷移はしない）。
 *
 * 盤面規則と物理は engine.ts の純粋関数に委ね、ここは描画・ループ・入力・通知だけを
 * 受け持つ。入力は共通 VirtualPad（ADR 0018）の方向を球への加速度として使う。物理は
 * クライアントで回すが、ゴール到達は send でサーバーへ通知するだけで、順位はサーバー
 * 受信順が確定する（ADR 0014）。全3面クリアで finished を送り、結果発表（issue-14）は
 * 基盤が受け取る。球の軌跡を描き、その回の結果として残す。
 */

import {
	type GamePayload,
	VirtualPad,
	useRealtimeGame,
	useVirtualPad,
} from "@rondo/game-sdk";
import { useEffect, useRef, useState } from "react";
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
import { MODES, type ModeId, chooseMode } from "./modes";
import { TEXT } from "./text";

const WALL_COLOR = "#0f172a";
const FLOOR_COLOR = "#1e293b";
const GOAL_COLOR = "#4ade80";
const BALL_COLOR = "#facc15";
const TRAIL_COLOR = "rgba(250, 204, 21, 0.35)";

/** 1 フレームの最大 dt（秒）。タブ復帰時の大ジャンプで壁をすり抜けないよう抑える。 */
const MAX_DT = 0.05;
/** 軌跡として保持する点の上限。 */
const MAX_TRAIL = 1200;

type Point = readonly [number, number];

/** 各面のゴール到達を通知する（サーバーの権威判定 / issue-13 に届く）。 */
interface GoalEvent extends GamePayload {
	readonly type: "goal";
	readonly level: number;
}

/** 全面クリアの合図。基盤（サーバー / Mock）が結果発表へ繋ぐ。 */
interface FinishedEvent extends GamePayload {
	readonly type: "finished";
}

function drawMaze(
	ctx: CanvasRenderingContext2D,
	level: Level,
	ball: Ball,
	trail: readonly Point[],
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

	// 球が通った軌跡（その回の結果 / ADR 0019 は揮発）。
	if (trail.length > 1) {
		ctx.strokeStyle = TRAIL_COLOR;
		ctx.lineWidth = BALL_R;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.beginPath();
		const [firstX, firstY] = trail[0] ?? [0, 0];
		ctx.moveTo(firstX, firstY);
		for (let i = 1; i < trail.length; i++) {
			const [x, y] = trail[i] ?? [firstX, firstY];
			ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	ctx.fillStyle = BALL_COLOR;
	ctx.beginPath();
	ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
	ctx.fill();
}

export default function TiltMaze() {
	const [started, setStarted] = useState(false);
	return started ? <Run /> : <ModeSelect onStart={() => setStarted(true)} />;
}

/** 始める前のモード選択。利用できないモードは、お知らせを出してここに戻る。 */
function ModeSelect({ onStart }: { onStart: () => void }) {
	const [notice, setNotice] = useState<string | null>(null);

	const choose = (id: ModeId) => {
		const choice = chooseMode(id);
		if (choice.kind === "play") onStart();
		else setNotice(choice.message);
	};

	return (
		<div className="flex w-full flex-col items-center gap-4">
			<p className="text-fg-muted text-sm">{TEXT.chooseMode}</p>
			<div className="flex w-full flex-col gap-3">
				{MODES.map((mode) => (
					<button
						key={mode.id}
						type="button"
						onClick={() => choose(mode.id)}
						className={`flex min-h-14 w-full flex-col items-center justify-center rounded-2xl px-6 py-3 transition-transform active:scale-[0.98] ${
							mode.available
								? "bg-accent text-accent-fg"
								: "bg-surface text-fg ring-1 ring-line ring-inset"
						}`}
					>
						<span className="font-semibold text-lg">{mode.label}</span>
						<span
							className={`text-xs ${mode.available ? "opacity-80" : "text-fg-muted"}`}
						>
							{mode.note}
						</span>
					</button>
				))}
			</div>

			{notice !== null ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-6">
					<dialog
						open
						aria-labelledby="rolling-notice"
						className="relative m-0 flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-surface p-6 text-center ring-1 ring-line ring-inset"
					>
						<p id="rolling-notice" className="text-fg">
							{notice}
						</p>
						<button
							type="button"
							onClick={() => setNotice(null)}
							className="min-h-11 w-full rounded-xl bg-accent px-4 font-semibold text-accent-fg"
						>
							{TEXT.close}
						</button>
					</dialog>
				</div>
			) : null}
		</div>
	);
}

/** 本編。1人モードを選んでから始まる。 */
function Run() {
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

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d") ?? null;
		if (canvas === null || ctx === null) return;

		let raf = 0;
		let last = performance.now();
		let drawnLevel = -1;
		let trail: Point[] = [];

		const frame = (now: number) => {
			const dt = Math.min((now - last) / 1000, MAX_DT);
			last = now;

			const run = runRef.current;
			if (!run.cleared) {
				const level = levelAt(run.levelIndex);
				const ball = stepBall(level, run.ball, directionRef.current, dt);
				trail.push([ball.x, ball.y]);
				if (trail.length > MAX_TRAIL) trail.shift();

				if (atGoal(level, ball)) {
					const completed = run.levelIndex + 1;
					// 各面のゴールをサーバーへ通知する（順位はサーバーが決める / ADR 0014）。
					const goal: GoalEvent = { type: "goal", level: completed };
					sendRef.current(goal);
					if (completed >= TOTAL_LEVELS) {
						runRef.current = { ...run, ball, cleared: true };
						setCleared(true);
						// 全面クリア。基盤が結果発表へ繋ぐ（issue-14）。
						const finished: FinishedEvent = { type: "finished" };
						sendRef.current(finished);
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
				trail = [];
			}
			drawMaze(ctx, level, current.ball, trail);

			raf = requestAnimationFrame(frame);
		};

		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<div className="flex flex-col items-center gap-5">
			<p className="text-slate-300 text-sm">
				{TEXT.stage(Math.min(levelIndex + 1, TOTAL_LEVELS), TOTAL_LEVELS)}
			</p>

			<canvas
				ref={canvasRef}
				className="w-full max-w-[min(90vw,360px)] rounded-lg"
			/>

			{cleared ? (
				<p className="text-slate-400 text-sm">{TEXT.cleared(TOTAL_LEVELS)}</p>
			) : (
				<>
					<p className="text-slate-500 text-xs">{TEXT.padHint}</p>
					<div className="rounded-full bg-slate-800 ring-1 ring-slate-700 ring-inset">
						<VirtualPad size={140} />
					</div>
				</>
			)}
		</div>
	);
}
