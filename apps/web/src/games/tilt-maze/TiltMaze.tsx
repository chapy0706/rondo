"use client";

/**
 * rolling 本体（内部名 tilt-maze / リアルタイムゲーム / ADR 0004）。
 *
 * 始める前にモード選択を出す（issue-36）。1人モードで迷路の大きさ（小・中・大）を選び、
 * 毎回新しい seed で作った迷路を1つ遊ぶ（issue-39）。対戦モードは準備中のお知らせを出して、
 * 閉じるとモード選択に戻る（通信・ルーム作成・画面遷移はしない）。
 *
 * 迷路・物理・お助けは engine.ts / maze.ts / assist.ts の純粋関数に委ね、ここは描画・
 * ループ・入力・通知だけを受け持つ。入力は共通 VirtualPad（ADR 0018）の方向を球への
 * 加速度として使う。ゴール到達は send でサーバーへ通知するだけで、順位はサーバー受信順が
 * 確定する（ADR 0014）。クリア後に最短経路と自分の歩数を並べて見せ、「おわる」で finished
 * を送って基盤の結果発表（issue-14）へ進む。球の軌跡は、その回の結果として残す。
 */

import {
	type GamePayload,
	VirtualPad,
	useRealtimeGame,
	useVirtualPad,
} from "@rondo/game-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type Progress,
	REVEAL_INTERVAL_MS,
	askHint,
	hintLabel,
	moveTo,
	revealStep,
	startProgress,
} from "./assist";
import {
	BALL_R,
	type Ball,
	CELL,
	DIFFICULTIES,
	type Difficulty,
	type Level,
	MAZE_CELLS,
	atGoal,
	cellOfBall,
	createLevel,
	startBall,
	stepBall,
} from "./engine";
import { tiltMazeManifest } from "./manifest";
import { type MazeCell, shortestPath } from "./maze";
import { MODES, type ModeId, chooseMode } from "./modes";
import { TEXT } from "./text";

const WALL_COLOR = "#0f172a";
const FLOOR_COLOR = "#1e293b";
const GOAL_COLOR = "#4ade80";
const BALL_COLOR = "#facc15";
const TRAIL_COLOR = "rgba(250, 204, 21, 0.35)";
const HINT_COLOR = "#38bdf8";
const PATH_COLOR = "rgba(56, 189, 248, 0.75)";

/** 1 フレームの最大 dt（秒）。タブ復帰時の大ジャンプで壁をすり抜けないよう抑える。 */
const MAX_DT = 0.05;
/** 軌跡として保持する点の上限。 */
const MAX_TRAIL = 1200;

type Point = readonly [number, number];

/** ゴール到達を通知する（サーバーの権威判定 / issue-13 に届く）。 */
interface GoalEvent extends GamePayload {
	readonly type: "goal";
	readonly level: number;
}

/** 遊び終えた合図。基盤（サーバー / Mock）が結果発表へ繋ぐ。 */
interface FinishedEvent extends GamePayload {
	readonly type: "finished";
}

function cellCenter(cell: MazeCell): Point {
	return [(2 * cell.cx + 1.5) * CELL, (2 * cell.cy + 1.5) * CELL];
}

/** 新しい迷路の seed。毎回違う迷路にする。 */
function newSeed(): number {
	return Math.floor(Math.random() * 1_000_000) + 1;
}

function drawMaze(
	ctx: CanvasRenderingContext2D,
	level: Level,
	ball: Ball,
	trail: readonly Point[],
	progress: Progress,
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

	// 「答えを見る」: 最短経路を、示し終えたマスまで線で描く。
	const reveal = progress.reveal;
	if (reveal !== null && reveal.shown > 0) {
		const shown = reveal.path.slice(0, reveal.shown).map(cellCenter);
		ctx.strokeStyle = PATH_COLOR;
		ctx.fillStyle = PATH_COLOR;
		ctx.lineWidth = BALL_R / 2;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.beginPath();
		shown.forEach(([x, y], i) => {
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();
		for (const [x, y] of shown) {
			ctx.beginPath();
			ctx.arc(x, y, BALL_R / 2.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// お助け: 次に進むべきマスを枠で示す。
	if (progress.hint !== null) {
		const [x, y] = cellCenter(progress.hint);
		ctx.strokeStyle = HINT_COLOR;
		ctx.lineWidth = 3;
		ctx.strokeRect(x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4);
	}

	ctx.fillStyle = BALL_COLOR;
	ctx.beginPath();
	ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
	ctx.fill();
}

type Screen =
	| { readonly kind: "mode" }
	| { readonly kind: "difficulty" }
	| {
			readonly kind: "play";
			readonly difficulty: Difficulty;
			readonly seed: number;
	  };

export default function TiltMaze() {
	const [screen, setScreen] = useState<Screen>({ kind: "mode" });
	switch (screen.kind) {
		case "mode":
			return <ModeSelect onStart={() => setScreen({ kind: "difficulty" })} />;
		case "difficulty":
			return (
				<DifficultySelect
					onChoose={(difficulty) =>
						setScreen({ kind: "play", difficulty, seed: newSeed() })
					}
				/>
			);
		case "play":
			return (
				<Run
					key={screen.seed}
					difficulty={screen.difficulty}
					seed={screen.seed}
					onRetry={() => setScreen({ ...screen, seed: newSeed() })}
					onChangeDifficulty={() => setScreen({ kind: "difficulty" })}
				/>
			);
	}
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

/** 迷路の大きさを選ぶ。 */
function DifficultySelect({
	onChoose,
}: {
	onChoose: (difficulty: Difficulty) => void;
}) {
	return (
		<div className="flex w-full flex-col items-center gap-4">
			<p className="text-fg-muted text-sm">{TEXT.chooseDifficulty}</p>
			<div className="grid w-full grid-cols-3 gap-3">
				{DIFFICULTIES.map((difficulty) => (
					<button
						key={difficulty}
						type="button"
						onClick={() => onChoose(difficulty)}
						className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-accent px-2 py-3 text-accent-fg transition-transform active:scale-[0.98]"
					>
						<span className="font-bold text-2xl">
							{TEXT.difficulty[difficulty]}
						</span>
						<span className="text-xs opacity-80">
							{TEXT.difficultyNote(MAZE_CELLS[difficulty])}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

interface RunProps {
	readonly difficulty: Difficulty;
	readonly seed: number;
	readonly onRetry: () => void;
	readonly onChangeDifficulty: () => void;
}

/** 本編。1つの迷路を遊ぶ。 */
function Run({ difficulty, seed, onRetry, onChangeDifficulty }: RunProps) {
	const { send } = useRealtimeGame(tiltMazeManifest);
	const direction = useVirtualPad();

	const level = useMemo(
		() => createLevel(difficulty, seed),
		[difficulty, seed],
	);
	/** スタートからゴールまでの最短の歩数（マスを移る回数）。 */
	const shortestSteps = useMemo(
		() =>
			(shortestPath(level.grid, level.startCell, level.goalMazeCell)?.length ??
				1) - 1,
		[level],
	);

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const ballRef = useRef<Ball>(startBall(level));
	const clearedRef = useRef(false);
	const directionRef = useRef(direction);
	directionRef.current = direction;
	const sendRef = useRef(send);
	sendRef.current = send;

	// 進み具合は描画ループ（ref）と画面（state）の両方で使う。
	const [progress, setProgressState] = useState(() =>
		startProgress(level.startCell),
	);
	const progressRef = useRef(progress);
	const setProgress = (next: Progress) => {
		if (next === progressRef.current) return;
		progressRef.current = next;
		setProgressState(next);
	};
	const setProgressRef = useRef(setProgress);
	setProgressRef.current = setProgress;

	const [cleared, setCleared] = useState(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d") ?? null;
		if (canvas === null || ctx === null) return;
		canvas.width = level.widthPx;
		canvas.height = level.heightPx;

		let raf = 0;
		let last = performance.now();
		const trail: Point[] = [];

		const frame = (now: number) => {
			const dt = Math.min((now - last) / 1000, MAX_DT);
			last = now;

			if (!clearedRef.current) {
				const ball = stepBall(level, ballRef.current, directionRef.current, dt);
				ballRef.current = ball;
				trail.push([ball.x, ball.y]);
				if (trail.length > MAX_TRAIL) trail.shift();

				const cell = cellOfBall(ball);
				if (cell !== null) {
					setProgressRef.current(moveTo(progressRef.current, cell));
				}

				if (atGoal(level, ball)) {
					clearedRef.current = true;
					setCleared(true);
					// ゴールをサーバーへ通知する（順位はサーバーが決める / ADR 0014）。
					const goal: GoalEvent = { type: "goal", level: 1 };
					sendRef.current(goal);
				}
			}

			drawMaze(ctx, level, ballRef.current, trail, progressRef.current);
			raf = requestAnimationFrame(frame);
		};

		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, [level]);

	// 「答えを見る」: 0.5 秒ごとに最短経路を1マスずつ示す。
	const revealing =
		progress.reveal !== null &&
		progress.reveal.shown < progress.reveal.path.length;
	useEffect(() => {
		if (!revealing) return;
		const timer = setInterval(
			() => setProgressRef.current(revealStep(progressRef.current)),
			REVEAL_INTERVAL_MS,
		);
		return () => clearInterval(timer);
	}, [revealing]);

	const finish = () => {
		// 遊び終えた。基盤が結果発表へ繋ぐ（issue-14）。
		const finished: FinishedEvent = { type: "finished" };
		send(finished);
	};

	return (
		<div className="flex w-full flex-col items-center gap-4">
			<div className="flex w-full max-w-[min(90vw,360px)] items-end justify-between gap-2">
				<p className="text-slate-300 text-sm">
					{TEXT.difficulty[difficulty]}（{TEXT.difficultyNote(level.cells)}）
				</p>
				<p className="text-right text-[10px] text-slate-500 leading-tight">
					{TEXT.algorithmMaze}
					<br />
					{TEXT.algorithmPath} ・ {TEXT.seed(seed)}
				</p>
			</div>

			<canvas
				ref={canvasRef}
				className="w-full max-w-[min(90vw,360px)] rounded-lg"
			/>

			{cleared ? (
				<div className="flex w-full max-w-[min(90vw,360px)] flex-col gap-3 rounded-2xl bg-surface p-4 text-center">
					<p className="font-bold text-fg text-xl">{TEXT.cleared}</p>
					<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-left text-sm">
						<dt className="text-fg-muted">{TEXT.shortestSteps}</dt>
						<dd className="text-fg">{TEXT.steps(shortestSteps)}</dd>
						<dt className="text-fg-muted">{TEXT.yourSteps}</dt>
						<dd className="text-fg">{TEXT.steps(progress.steps)}</dd>
						<dt className="text-fg-muted">{TEXT.hintsUsed}</dt>
						<dd className="text-fg">{TEXT.times(progress.hintsUsed)}</dd>
					</dl>
					<button
						type="button"
						onClick={onRetry}
						className="min-h-11 rounded-xl bg-surface px-3 text-fg text-sm ring-1 ring-line ring-inset"
					>
						{TEXT.retry}
					</button>
					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={onChangeDifficulty}
							className="min-h-11 rounded-xl bg-surface px-3 text-fg text-sm ring-1 ring-line ring-inset"
						>
							{TEXT.changeDifficulty}
						</button>
						<button
							type="button"
							onClick={finish}
							className="min-h-11 rounded-xl bg-accent px-3 font-semibold text-accent-fg"
						>
							{TEXT.finish}
						</button>
					</div>
				</div>
			) : (
				<>
					{progress.reveal !== null ? (
						<p className="text-sky-400 text-sm">{TEXT.revealing}</p>
					) : (
						<button
							type="button"
							onClick={() =>
								setProgress(
									askHint(progressRef.current, level.grid, level.goalMazeCell),
								)
							}
							className="min-h-11 rounded-xl bg-surface px-5 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
						>
							{hintLabel(progress)}
						</button>
					)}
					<p className="text-slate-500 text-xs">{TEXT.padHint}</p>
					<div className="rounded-full bg-slate-800 ring-1 ring-slate-700 ring-inset">
						<VirtualPad size={140} />
					</div>
				</>
			)}
		</div>
	);
}
