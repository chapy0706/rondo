"use client";

/**
 * 観戦の画面（issue-67）。観戦ルームの観戦者が見る、画面いっぱいの 1 枚（GameFrame の中身）。
 *
 * - 操作の部品（移動・視点のパッド、撃つ、襖、ポーズ、塗る）は出さない。ゲームに操作を送らない
 * - 状態の行: フェーズと残り時間。結果のときは「次の試合まで あと ○ 秒」
 * - 3D の画面: 観戦用の通知（spectate）の全員を補間して描き、選んだ相手の後ろを追うカメラで見る（壁の
 *   向こうに出ない守り / ADR 0043 は、シーンのまま）。体をタップしても、追う相手を替えられる
 * - 下: 追う相手の横にスクロールできる選択（鬼、隠れ 1〜）。選んだ相手は、試合が替わっても、いれば保つ
 *
 * 判断の中身（読み取り・補間・ラベル・追う相手・カメラの向き）は、spectate.ts の純粋な関数。
 */

import { useRealtimeGame } from "@rondo/game-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { gameAssets } from "./assetSlots";
import { devTrace } from "./assetTrace";
import { cameraSettings } from "./camera";
import { isHirayaStage } from "./hiraya";
import { HIRAYA_DEV, veryareManifest } from "./manifest";
import {
	NO_PHASE_CLOCK,
	type PhaseClock,
	receivePhase,
	remainingOf,
} from "./phaseClock";
import { type PhaseNotice, parsePhaseNotice } from "./rules";
import type { VeryareScene } from "./scene";
import {
	EMPTY_SPECTATE,
	type SpectateView as SpectateData,
	actorChosenPose,
	applySpectateNotice,
	cameraTarget,
	carryFollow,
	followChoices,
	followYaw,
	nextGameSeconds,
	parseSpectateNotice,
	sampleSpectate,
	spectateStatus,
} from "./spectate";
import { type StageGrid, parseDoorsNotice, parseStageNotice } from "./stage";

/** タップと見なす、押してから離すまでの動きの上限（px）。 */
const TAP_SLOP_PX = 12;

const FOLLOW_BUTTON =
	"min-h-11 shrink-0 rounded-xl px-4 font-semibold text-sm ring-1 ring-line ring-inset aria-pressed:bg-accent aria-pressed:text-accent-fg";

export function SpectateView() {
	const { on, players } = useRealtimeGame(veryareManifest);

	const [notice, setNotice] = useState<PhaseNotice | null>(null);
	const phaseClockRef = useRef<PhaseClock>(NO_PHASE_CLOCK);
	/** 結果（終了のフェーズ）を受け取った時刻。次の試合までの残りを数える。 */
	const [endedAt, setEndedAt] = useState<number | null>(null);
	const [grid, setGrid] = useState<StageGrid | null>(null);
	const [openDoors, setOpenDoors] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const spectateRef = useRef<SpectateData>(EMPTY_SPECTATE);
	const [visibleActors, setVisibleActors] = useState(0);
	/** 選んだ相手（まだ選んでいなければ null。鬼を追う）。 */
	const [chosen, setChosen] = useState<string | null>(null);
	const [now, setNow] = useState(0);

	const [assets] = useState(gameAssets);
	const [characterSlot] = useState(() => assets.characterSlot());
	const randomLayout = grid !== null && !isHirayaStage(grid);
	const materialSlot = useMemo(
		() => (randomLayout ? assets.stageMaterialSlot() : null),
		[randomLayout, assets],
	);

	useEffect(() => {
		const offPhase = on("phase", (payload) => {
			const next = parsePhaseNotice(payload);
			if (next === null) return;
			const at = performance.now();
			const clock = receivePhase(phaseClockRef.current, next, at);
			if (clock === phaseClockRef.current) return;
			phaseClockRef.current = clock;
			setNotice(next);
			setEndedAt((current) =>
				next.phase === "ended" ? (current ?? at) : null,
			);
		});
		const offSpectate = on("spectate", (payload) => {
			const next = parseSpectateNotice(payload);
			if (next === null) return;
			spectateRef.current = applySpectateNotice(
				spectateRef.current,
				next,
				performance.now(),
			);
			setVisibleActors(spectateRef.current.actors.size);
		});
		const offStage = on("stage", (payload) => {
			const next = parseStageNotice(payload);
			if (next !== null) setGrid(next);
		});
		const offDoors = on("doors", (payload) => {
			const next = parseDoorsNotice(payload);
			if (next !== null) setOpenDoors(next);
		});
		return () => {
			offPhase();
			offSpectate();
			offStage();
			offDoors();
		};
	}, [on]);

	// 残り時間と、次の試合までの残りを数え直す。
	useEffect(() => {
		const timer = setInterval(() => setNow(performance.now()), 250);
		return () => clearInterval(timer);
	}, []);

	const oni = notice?.oni ?? null;
	const choices = useMemo(() => followChoices(players, oni), [players, oni]);
	const follow = carryFollow(chosen, choices);
	const labels = useMemo(
		() => new Map(choices.map((c) => [c.id, c.label])),
		[choices],
	);

	const remainingMs = remainingOf(phaseClockRef.current, now);
	const status = spectateStatus({
		phase: notice?.phase ?? null,
		remainingSeconds:
			remainingMs === Number.POSITIVE_INFINITY
				? null
				: Math.ceil(remainingMs / 1000),
		outcome: notice?.outcome ?? null,
		nextGameSeconds:
			endedAt === null
				? null
				: nextGameSeconds(endedAt, Math.max(now, endedAt)),
	});

	/** 描画ループが読む、いまの値。 */
	const latest = useRef({ grid, openDoors, materialSlot, follow, labels, oni });
	latest.current = { grid, openDoors, materialSlot, follow, labels, oni };

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sceneRef = useRef<VeryareScene | null>(null);
	const downRef = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas === null) return;
		let disposed = false;
		let frame = 0;
		let observer: ResizeObserver | null = null;
		void import("./scene").then(({ createScene }) => {
			if (disposed) return;
			const camera = cameraSettings(HIRAYA_DEV, window.location.search);
			const scene = createScene(canvas, {
				trace: devTrace,
				camera,
				bodies: characterSlot,
			});
			sceneRef.current = scene;
			scene.setSpectating(true);
			const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
			fit();
			observer = new ResizeObserver(fit);
			observer.observe(canvas);
			let yaw = 0;
			let last = performance.now();
			const loop = (time: number) => {
				const dt = Math.min((time - last) / 1000, 0.1);
				last = time;
				const current = latest.current;
				const actors = sampleSpectate(spectateRef.current, time);
				scene.setStage(current.grid, current.openDoors);
				scene.setStageMaterials(current.materialSlot);
				scene.setCameraClamp(true);
				scene.setSpace("stage");
				scene.setActors(
					actors.map((actor) => ({
						id: actor.id,
						label: current.labels.get(actor.id) ?? "",
						x: actor.x,
						z: actor.z,
						facing: actor.facing,
						oni: actor.id === current.oni,
						color: actor.color,
						chosen: actorChosenPose(actor.pose),
					})),
				);
				const target = cameraTarget(
					current.follow,
					actors.map((actor) => actor.id),
				);
				const followed = actors.find((actor) => actor.id === target);
				if (followed !== undefined) yaw = followYaw(yaw, followed.facing, dt);
				scene.setView(target === null ? "self" : { hider: target });
				scene.setCamera(yaw, camera.pitch);
				scene.render();
				frame = requestAnimationFrame(loop);
			};
			frame = requestAnimationFrame(loop);
		});
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			observer?.disconnect();
			sceneRef.current?.dispose();
			sceneRef.current = null;
		};
	}, [characterSlot]);

	/** 3D の画面のタップ。当たった体を、追う相手にする（ドラッグは無視する）。 */
	const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const down = downRef.current;
		downRef.current = null;
		const scene = sceneRef.current;
		if (down === null || scene === null) return;
		if (
			Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP_PX
		) {
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
		const hit = scene.pickActor(x, y);
		if (hit !== null) setChosen(hit);
	};

	return (
		<div
			className="flex min-h-0 w-full flex-1 flex-col"
			data-testid="veryare-spectate"
			data-spectating="true"
			data-phase={notice?.phase ?? ""}
			data-follow-target={follow ?? ""}
			data-visible-actors={visibleActors}
		>
			<div className="flex shrink-0 items-center px-3 pb-1.5 text-sm">
				<output
					className="truncate font-semibold text-fg"
					data-testid="spectate-status"
				>
					{status}
				</output>
			</div>

			<div className="relative min-h-0 flex-1 overflow-hidden">
				<canvas
					ref={canvasRef}
					className="absolute inset-0 block size-full"
					data-testid="spectate-canvas"
					onPointerDown={(event) => {
						downRef.current = { x: event.clientX, y: event.clientY };
					}}
					onPointerUp={onPointerUp}
					onPointerCancel={() => {
						downRef.current = null;
					}}
				/>
			</div>

			<div
				className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2"
				data-testid="spectate-follow-list"
			>
				{choices.map((choice) => (
					<button
						key={choice.id}
						type="button"
						data-testid="spectate-follow"
						data-actor={choice.id}
						aria-pressed={choice.id === follow}
						onClick={() => setChosen(choice.id)}
						className={FOLLOW_BUTTON}
					>
						{choice.label}
					</button>
				))}
			</div>
		</div>
	);
}
