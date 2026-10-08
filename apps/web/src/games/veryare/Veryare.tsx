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
 * 探索開始時の一括配信（隠れ側の状態 / issue-33）を受け取り、隠れ側を描く。
 *
 * 観戦（issue-28 / ADR 0027・0034・0035）: まだ隠れている一覧から外れた隠れ側（見つかった・
 * 被りで失格）は観戦者になり、探索中は鬼を中央に固定した周回カメラ（鬼 TPS 視点）で見る。
 * 移動はできず、視点パッドでカメラを回すだけ。探索中の隠れ側は、自分の視点と鬼 TPS 視点を
 * 切り替えられる。鬼の状態はサーバーが全員へ送る（鬼は動くたびに、向きを添えて報告する）。
 */

import type { VeryareHiderState, VeryareOniNotice } from "@rondo/contracts";
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
	facingOfYaw,
	isSpectator,
	moveReport,
	parseHidersNotice,
	parseHidingNotice,
	parseOniNotice,
	parsePhaseNotice,
	parseRoomInfo,
	roleOf,
	spaceOf,
	spawnOf,
	stepPosition,
	viewOf,
} from "./rules";
import type { SceneHider, SceneOni, VeryareScene } from "./scene";

/** 歩く速さ（m/秒）。 */
const WALK_SPEED = 1.6;
/** 視点パッドを倒しきったときの回転の速さ（ラジアン/秒）。 */
const TURN_SPEED = 2.2;
/** 位置の報告の最短間隔（ミリ秒）。 */
const SEND_INTERVAL_MS = 100;
/** 向きだけが変わったときに報告し直す角度の差（ラジアン）。 */
const FACING_EPSILON = 0.05;
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
	/** 探索中の鬼の状態（観戦・鬼 TPS 視点に使う）。 */
	const [oniState, setOniState] = useState<VeryareOniNotice | null>(null);
	/** まだ隠れている隠れ側の一覧。届くまでは null。 */
	const [hiding, setHiding] = useState<readonly string[] | null>(null);
	/** 探索中の隠れ側が、鬼 TPS 視点を選んでいるか。 */
	const [choseOni, setChoseOni] = useState(false);
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
		const offOni = on("oni", (payload) => {
			const next = parseOniNotice(payload);
			if (next !== null) setOniState(next);
		});
		const offHiding = on("hiding", (payload) => {
			const next = parseHidingNotice(payload);
			if (next !== null) setHiding(next.playerIds);
		});
		return () => {
			offPhase();
			offInfo();
			offHiders();
			offOni();
			offHiding();
		};
	}, [on]);

	const phase: Phase = notice?.phase ?? "oni-selection";
	const role = roleOf(notice?.oni ?? null, you);
	const space = spaceOf(phase, role);
	const spectator = isSpectator(phase, role, hiding, you);
	const oniVisible =
		(phase === "exploration" || phase === "reveal") && oniState !== null;
	const view = viewOf({
		phase,
		role,
		spectator,
		choseOni,
		oniKnown: oniState !== null,
	});
	// 観戦者は移動できない（サーバー側でも、準備移動の後の隠れ側の移動は無視される）。
	const movable = notice !== null && canMove(phase, role) && !spectator;
	const sceneOni: SceneOni | null =
		oniVisible && oniState !== null
			? { x: oniState.x, z: oniState.z, facing: oniState.facing }
			: null;
	const sceneHiders: readonly SceneHider[] =
		(phase === "exploration" || phase === "reveal") && hiders !== null
			? hiders
					.filter((h) => h.playerId !== you)
					.map((h) => ({
						id: h.playerId,
						x: h.x,
						z: h.z,
						color: h.paint?.color ?? DEFAULT_COLOR,
					}))
			: [];
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
		view,
		sceneOni,
		sceneHiders,
	});
	latest.current = {
		move,
		look,
		movable,
		space,
		avatarColor,
		area,
		send,
		view,
		sceneOni,
		sceneHiders,
	};

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
			let sentFacing: number | null = null;

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
					// 位置と向きはクライアントが報告し、サーバーが制限する（変わったときだけ
					// 間引いて送る）。向きは観戦者へ送る鬼の向きに使う（issue-28）。
					const position = positionRef.current;
					const facing = facingOfYaw(yaw);
					const moved =
						sentPosition === null ||
						sentPosition.x !== position.x ||
						sentPosition.z !== position.z;
					const turned =
						sentFacing === null ||
						Math.abs(facing - sentFacing) > FACING_EPSILON;
					if ((moved || turned) && time - lastSent >= SEND_INTERVAL_MS) {
						current.send(moveReport(position, facing));
						sentPosition = position;
						sentFacing = facing;
						lastSent = time;
					}
				}

				scene.setSpace(current.space);
				scene.setArea(current.area);
				scene.setAvatar(positionRef.current, current.avatarColor);
				scene.setOni(current.sceneOni);
				scene.setHiders(current.sceneHiders);
				scene.setView(current.view);
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
		<div
			className="flex w-full flex-col gap-3"
			data-testid="veryare"
			data-phase={phase}
		>
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
				{phase === "exploration" && hiding !== null
					? ` ・隠れている ${hiding.length}人`
					: ""}
			</p>
			{area !== null ? (
				<p
					className="text-sm"
					data-testid="veryare-area"
					data-color={areaLook(area).color}
				>
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

			{spectator ? (
				<p className="rounded-xl bg-surface px-3 py-2 text-fg text-sm">
					見つかりました。観戦中です
					{view === "oni"
						? "（鬼の視点・視点パッドで回せます）"
						: "（探索が始まると鬼の視点になります）"}
				</p>
			) : null}
			{phase === "exploration" && role === "hider" && !spectator ? (
				<button
					type="button"
					aria-pressed={choseOni}
					disabled={oniState === null}
					onClick={() => setChoseOni((current) => !current)}
					className="min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset disabled:opacity-50"
				>
					{choseOni ? "自分の視点に戻る" : "鬼の視点を見る"}
				</button>
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
				{/* 終了後の勝敗は、基盤の結果画面（game-ended）に任せる（issue-42）。 */}
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
				{movable ? (
					<div className="flex flex-col items-center gap-1">
						<div className="rounded-full bg-surface ring-1 ring-line ring-inset">
							<VirtualPad name="move" size={120} />
						</div>
						<span className="text-fg-muted text-xs">移動</span>
					</div>
				) : (
					// 動けない間（観戦中を含む）は移動パッドを出さない。
					<div aria-hidden="true" className="size-[120px]" />
				)}
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
