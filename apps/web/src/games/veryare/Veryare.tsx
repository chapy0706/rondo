"use client";

/**
 * veryare 本体（リアルタイムゲーム / ADR 0023 / 0024）。
 *
 * フェーズと勝敗はサーバー（いまはモック）の通知だけで進め、ここでは判定しない。
 * 自分の役割と、いる空間（待機ルーム / ステージ）を通知から決め、three.js の1つの
 * シーンの中で、その空間のグループだけを表示する。入力は game-sdk の VirtualPad を
 * 名前付きで2本使う（"move" で移動、"look" で視点 / ADR 0020）。
 * 鬼の待機中ペイントはアバターの色を変えるだけのローカル状態で、送らず保存もしない。
 * 鬼選出中は、鬼希望エリアの色（赤・待機 / 緑・開始 / 青・鬼希望）を通知のとおりに出す。
 * 探索の後は答え合わせタイム（20秒）を挟んで終了する（襖や位置の公開の演出は issue-29）。
 * 探索開始時の一括配信（隠れ側の状態 / issue-33）は受け取って人数だけを出す。隠れ側の
 * 体をステージに描くのは、ステージとキャラクターを統合する issue-29 以降。
 */

import type { VeryareHiderState } from "@rondo/contracts";
import { VirtualPad, useRealtimeGame, useVirtualPad } from "@rondo/game-sdk";
import { useEffect, useRef, useState } from "react";
import { veryareManifest } from "./manifest";
import {
	type Outcome,
	type Phase,
	type PhaseNotice,
	type Point,
	type Role,
	areaLook,
	canMove,
	canPaintWhileWaiting,
	moveReport,
	parseHidersNotice,
	parsePhaseNotice,
	parseRoomInfo,
	roleOf,
	spaceOf,
	spawnOf,
	stepPosition,
} from "./rules";
import type { VeryareScene } from "./scene";

/** 歩く速さ（m/秒）。 */
const WALK_SPEED = 1.6;
/** 視点パッドを倒しきったときの回転の速さ（ラジアン/秒）。 */
const TURN_SPEED = 2.2;
/** 位置の報告の最短間隔（ミリ秒）。 */
const SEND_INTERVAL_MS = 100;
/** アバターの既定の色。 */
const DEFAULT_COLOR = "#ece8f5";
/** 待機中ペイントで選べる色。本番のペイント（issue-25）とは別の簡易なもの。 */
const WAITING_COLORS = [
	"#f5b841",
	"#5fd3c4",
	"#f472b6",
	"#a3e635",
	"#60a5fa",
	"#ece8f5",
];

const PHASE_LABELS: Record<Phase, string> = {
	"oni-selection": "鬼選出",
	preparation: "準備移動",
	painting: "ペイント",
	exploration: "探索",
	reveal: "答え合わせ",
	ended: "終了",
};

const ROLE_LABELS: Record<Role, string> = {
	oni: "あなたは鬼",
	hider: "あなたは隠れる側",
	undecided: "鬼を決めています",
};

function outcomeText(outcome: Outcome, role: Role): string {
	switch (outcome) {
		case "not-enough-players":
			return "人数が足りず、ゲームは成立しませんでした";
		case "oni-wins":
			return role === "oni" ? "全員見つけた！あなたの勝ち" : "鬼の勝ち";
		case "hiders-win":
			return role === "hider" ? "逃げ切った！あなたの勝ち" : "隠れる側の勝ち";
	}
}

export default function Veryare() {
	const { on, send, you } = useRealtimeGame(veryareManifest);
	const move = useVirtualPad("move");
	const look = useVirtualPad("look");

	const [notice, setNotice] = useState<PhaseNotice | null>(null);
	const [phaseStartedAt, setPhaseStartedAt] = useState(0);
	const [explorationSeconds, setExplorationSeconds] = useState<number | null>(
		null,
	);
	const [waitingColor, setWaitingColor] = useState(DEFAULT_COLOR);
	/** 探索開始時に届いた、隠れ側の状態（CPU を含む）。 */
	const [hiders, setHiders] = useState<readonly VeryareHiderState[] | null>(
		null,
	);
	const [now, setNow] = useState(0);

	// サーバーの通知を購読する（全員宛てのフェーズ通知と、入室後の案内）。
	useEffect(() => {
		const offPhase = on("phase", (payload) => {
			const next = parsePhaseNotice(payload);
			if (next === null) return;
			setNotice(next);
			setPhaseStartedAt(performance.now());
		});
		const offInfo = on("room-info", (payload) => {
			const info = parseRoomInfo(payload);
			if (info !== null) setExplorationSeconds(info.explorationSeconds);
		});
		const offHiders = on("hiders", (payload) => {
			const next = parseHidersNotice(payload);
			if (next !== null) setHiders(next.hiders);
		});
		return () => {
			offPhase();
			offInfo();
			offHiders();
		};
	}, [on]);

	const phase: Phase = notice?.phase ?? "oni-selection";
	const role = roleOf(notice?.oni ?? null, you);
	const space = spaceOf(phase, role);
	const movable = notice !== null && canMove(phase, role);
	const painting = canPaintWhileWaiting(phase, role);
	// 待機中ペイントは待機ルームの中だけで見せる。ステージの見た目には一切持ち込まない。
	const avatarColor =
		role === "oni" && space === "waiting-room" ? waitingColor : DEFAULT_COLOR;

	// 残り時間の表示を更新する。
	useEffect(() => {
		const timer = setInterval(() => setNow(performance.now()), 250);
		return () => clearInterval(timer);
	}, []);
	const remainingSeconds =
		notice?.durationMs == null
			? null
			: Math.max(
					0,
					Math.ceil((notice.durationMs - (now - phaseStartedAt)) / 1000),
				);

	// 描画ループが最新の値を読むための参照。
	// 鬼希望エリアは鬼選出中だけ見せる。
	const area = phase === "oni-selection" ? (notice?.area ?? null) : null;
	const latest = useRef({
		move,
		look,
		movable,
		space,
		avatarColor,
		area,
		send,
	});
	latest.current = { move, look, movable, space, avatarColor, area, send };

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const fadeRef = useRef<HTMLDivElement | null>(null);
	const sceneRef = useRef<VeryareScene | null>(null);
	const positionRef = useRef<Point>(spawnOf("waiting-room"));

	// three.js のシーンを作り、描画ループを回す。three.js は遅延読み込みする。
	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas === null) return;
		let disposed = false;
		let frame = 0;
		let observer: ResizeObserver | null = null;

		void import("./scene").then(({ createScene }) => {
			if (disposed) return;
			const scene = createScene(canvas);
			sceneRef.current = scene;

			const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
			fit();
			observer = new ResizeObserver(fit);
			observer.observe(canvas);

			let yaw = 0;
			const pitch = 0.35;
			let last = performance.now();
			let lastSent = 0;
			let sentPosition: Point | null = null;

			const loop = (time: number) => {
				const dt = Math.min((time - last) / 1000, 0.1);
				last = time;
				const current = latest.current;

				yaw -= current.look.x * TURN_SPEED * dt;
				if (current.movable) {
					positionRef.current = stepPosition(
						positionRef.current,
						current.move,
						yaw,
						WALK_SPEED,
						dt,
						current.space,
					);
					// 位置はクライアントが報告し、サーバーが制限する（動いたときだけ間引いて送る）。
					const position = positionRef.current;
					const moved =
						sentPosition === null ||
						sentPosition.x !== position.x ||
						sentPosition.z !== position.z;
					if (moved && time - lastSent >= SEND_INTERVAL_MS) {
						current.send(moveReport(position));
						sentPosition = position;
						lastSent = time;
					}
				}

				scene.setSpace(current.space);
				scene.setArea(current.area);
				scene.setAvatar(positionRef.current, current.avatarColor);
				scene.setCamera(yaw, pitch);
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
	}, []);

	// 空間が変わったら、その空間の初期位置に立ち、暗転から明ける短い演出を入れる。
	const previousSpace = useRef(space);
	useEffect(() => {
		if (previousSpace.current === space) return;
		previousSpace.current = space;
		positionRef.current = spawnOf(space);
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (!reduce) {
			fadeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 450,
				easing: "ease-out",
			});
		}
	}, [space]);

	return (
		<div className="flex w-full flex-col gap-3">
			<div className="flex items-center justify-between text-sm">
				<span className="font-semibold text-fg">
					{notice === null ? "開始を待っています" : PHASE_LABELS[phase]}
					{remainingSeconds !== null ? ` ・残り ${remainingSeconds}秒` : ""}
				</span>
				{explorationSeconds !== null ? (
					<span className="text-fg-muted">探索 {explorationSeconds}秒</span>
				) : null}
			</div>
			<p className="text-fg-muted text-sm">
				{ROLE_LABELS[role]}
				{space === "waiting-room" ? "（待機ルーム）" : "（ステージ）"}
				{phase === "oni-selection" ? " ・鬼になりたい人は中央の円へ" : ""}
				{(phase === "painting" || phase === "exploration") && role === "hider"
					? " ・その場から動けません"
					: ""}
				{phase === "exploration" && hiders !== null
					? ` ・隠れている ${hiders.length}人`
					: ""}
			</p>
			{area !== null ? (
				<p className="text-sm">
					<span
						className={`mr-2 inline-block size-3 rounded-full align-middle ${
							{
								red: "bg-red-500",
								green: "bg-green-500",
								blue: "bg-blue-500",
							}[areaLook(area).color]
						}`}
						aria-hidden="true"
					/>
					<span className="font-semibold text-fg">{areaLook(area).label}</span>
					<span className="text-fg-muted">
						{area === "waiting"
							? " ・あと1人そろうと始められます"
							: area === "ready"
								? " ・中央の円に触れると10秒のカウントが始まります"
								: " ・今触れると鬼の立候補になります"}
					</span>
				</p>
			) : null}

			<div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl">
				<canvas ref={canvasRef} className="block size-full" />
				<div
					ref={fadeRef}
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 bg-ink opacity-0"
				/>
				{notice?.outcome != null && phase === "reveal" ? (
					// 答え合わせの間は景色を見せるため、勝敗は上の帯にだけ出す。
					<div className="absolute inset-x-0 top-0 bg-ink/70 px-4 py-2 text-center">
						<p className="font-semibold text-fg">
							答え合わせ ・{outcomeText(notice.outcome, role)}
						</p>
					</div>
				) : null}
				{notice?.outcome != null && phase === "ended" ? (
					<div className="absolute inset-0 flex items-center justify-center bg-ink/70 p-6 text-center">
						<p className="font-semibold text-fg text-xl">
							{outcomeText(notice.outcome, role)}
						</p>
					</div>
				) : null}
			</div>

			{painting ? (
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-2 text-fg-muted text-sm">
						待つ間、自分の色を塗り替えられます（保存されません）
					</legend>
					<div className="flex flex-wrap gap-2">
						{WAITING_COLORS.map((color) => (
							<button
								key={color}
								type="button"
								aria-label={`色 ${color}`}
								aria-pressed={waitingColor === color}
								onClick={() => setWaitingColor(color)}
								className={`size-11 rounded-full ring-inset ${
									waitingColor === color ? "ring-4 ring-fg" : "ring-1 ring-line"
								}`}
								style={{ backgroundColor: color }}
							/>
						))}
					</div>
				</fieldset>
			) : null}

			<div className="flex items-center justify-between">
				<div className="flex flex-col items-center gap-1">
					<div className="rounded-full bg-surface ring-1 ring-line ring-inset">
						<VirtualPad name="move" size={120} />
					</div>
					<span className="text-fg-muted text-xs">移動</span>
				</div>
				<div className="flex flex-col items-center gap-1">
					<div className="rounded-full bg-surface ring-1 ring-line ring-inset">
						<VirtualPad name="look" size={120} />
					</div>
					<span className="text-fg-muted text-xs">視点</span>
				</div>
			</div>
		</div>
	);
}
