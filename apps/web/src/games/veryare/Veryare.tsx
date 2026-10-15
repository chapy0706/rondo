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
 *
 * 平屋（issue-46）: ステージの通知が平屋なら、平屋の glb の読み込みを始め（assetSlots.ts）、
 * 待機ルームの間に読めていればシーンが差し替える。屋根と天井は「屋根」のボタンで切り替える（既定は隠す）。
 */

import type {
	VeryareHiderState,
	VeryareModelPose,
	VeryareOniNotice,
	VeryarePaint,
} from "@rondo/contracts";
import { VirtualPad, useRealtimeGame, useVirtualPad } from "@rondo/game-sdk";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type BrushName, type Hsl, PaintPanel } from "./PaintPanel";
import {
	type Vec3,
	createTapTracker,
	shotMessage,
	shotTarget,
	toNdc,
} from "./aim";
import { gameAssets } from "./assetSlots";
import { devTrace, traceEnabled } from "./assetTrace";
import {
	autoCameraActive,
	autoCameraSettings,
	loadAutoCamera,
	saveAutoCamera,
	stepAutoCamera,
} from "./autoCamera";
import { stepFacing } from "./bodyFacing";
import { cameraSettings } from "./camera";
import { browserStorage, loadCeiling, saveCeiling } from "./ceilingSetting";
import { isHirayaStage } from "./hiraya";
import {
	canLike,
	likeEvent,
	parseLikesNotice,
	revealTargets,
	stepRevealTarget,
} from "./likes";
import { HIRAYA_DEV, roofToggleAllowed, veryareManifest } from "./manifest";
import {
	type Members,
	NO_MEMBERS,
	applyMembersNotice,
	membersInPhase,
	membersSummary,
	parseMembersNotice,
	sampleMembers,
} from "./members";
import {
	PAD_DEAD_ZONE,
	WALK_SPEED,
	blinkLevel,
	blinkTargets,
	shouldReport,
} from "./motion";
import {
	createMotionWatch,
	motionWatchEnabled,
	stallLogMessage,
} from "./motionWatch";
import {
	type OniSample,
	pushOniSample,
	sampleOni,
	trackDelay,
} from "./oniTrack";
import {
	BRUSH_SIZES,
	PAINT_LOCK_MS,
	type PaintDraft,
	beginStroke,
	bodyColorAt,
	canEditPaint,
	clearPaint,
	emptyDraft,
	extendStroke,
	hereColor,
	hslToHex,
	paintEvent,
	shouldSubmitPaint,
	undoStroke,
} from "./paint";
import { FLOOR_COLOR, UNPAINTED_COLOR } from "./palette";
import {
	NO_POSE_CHOICE,
	WAITING_POSE_INTERVAL_MS,
	avatarPoseFixed,
	avatarPoseOf,
	canChangeWaitingPose,
	chooseGamePose,
	chooseWaitingPose,
	enterSpace,
	waitingPoseEvent,
} from "./poseChoice";
import {
	DEFAULT_POSE,
	POSE_NOTICE_MS,
	RANDOM_POSE_POOL,
	canChangePose,
	pickNextPose,
	poseLabel,
	poseNoticeVisible,
} from "./poses";
import {
	type Outcome,
	type Phase,
	type PhaseNotice,
	type Point,
	type Role,
	type Space,
	WAITING_ROOM_SPAWN,
	areaLook,
	canMove,
	canPaintWhileWaiting,
	canShoot,
	facingOfYaw,
	foundByShot,
	isSpectator,
	moveReport,
	parseHidersNotice,
	parseHidingNotice,
	parseOniNotice,
	parsePhaseNotice,
	parseRoomInfo,
	reloadRemainingMs,
	roleOf,
	shootEvent,
	spaceOf,
	viewOf,
	walkTarget,
} from "./rules";
import type { SceneHider, VeryareScene } from "./scene";
import {
	type MissReason,
	missHint,
	missText,
	shotLogMessage,
} from "./shotHint";
import { canReportSight, shouldReportSight, sightEvent } from "./sightReport";
import {
	type StageGrid,
	doorToOpen,
	mirrorMove,
	openDoorEvent,
	parseDoorsNotice,
	parseStageNotice,
	reconcile,
} from "./stage";

/** 「見つけた！」を出しておく時間（ミリ秒 / issue-27）。 */
const FOUND_NOTICE_MS = 1500;
/** 外れの理由（推定）を出しておく時間（ミリ秒 / issue-45 の続き）。 */
const MISS_NOTICE_MS = 1500;
/** 撃ってから、結果（隠れている一覧の変化）を開発中の Console に出すまでの時間（ミリ秒）。 */
const SHOT_LOG_DELAY_MS = 500;

/** 視点パッドを倒しきったときの回転の速さ（ラジアン/秒）。 */
const TURN_SPEED = 2.2;
/** アバターの既定の色（まだ塗っていない体の色。サーバーの palette.gleam と同じ）。 */
const DEFAULT_COLOR = UNPAINTED_COLOR;
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
	const { on, send, you, players } = useRealtimeGame(veryareManifest);
	/** 通知の購読の中で、いまの自分の ID を読むための参照。 */
	const youRef = useRef(you);
	youRef.current = you;
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
	/** ステージの地図（ステージの通知 / issue-29c）。届くまでは null で、ステージを描かない。 */
	const [grid, setGrid] = useState<StageGrid | null>(null);
	/** 開いている襖（襖の通知のとおり。クライアントは変えない）。 */
	const [openDoors, setOpenDoors] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	/** 素材の入口（issue-46）。画面全体で1つ（ロビーの先読みと同じもの）。 */
	const [assets] = useState(gameAssets);
	/** 平屋の glb の差し替え口。ステージの通知が平屋のときだけ、読み込みを始める。 */
	const stageSlot = useMemo(
		() => (grid !== null && isHirayaStage(grid) ? assets.hirayaSlot() : null),
		[grid, assets],
	);
	/**
	 * ランダム間取りの材質の差し替え口（stage-materials）。ステージの通知がランダム間取りになったとき
	 * だけ、1回読み始める（通知が届き直しても、読み直さない）。
	 */
	const randomLayout = grid !== null && !isHirayaStage(grid);
	const materialSlot = useMemo(
		() => (randomLayout ? assets.stageMaterialSlot() : null),
		[randomLayout, assets],
	);
	/** 平屋の glb を表示しているか（シーンが決める）と、屋根と天井を表示するか（既定は隠す）。 */
	const [modelShown, setModelShown] = useState(false);
	const [roofVisible, setRoofVisible] = useState(false);
	/** 屋根の切り替えボタンは開発用だけ（来場者の画面には出さない）。URL はマウントの後に読む。 */
	const [roofToggle, setRoofToggle] = useState(false);
	useEffect(() => {
		setRoofToggle(roofToggleAllowed(HIRAYA_DEV, window.location.search));
	}, []);
	/**
	 * 天井のあり・なし（画面の隅の設定。既定はあり）。端末に覚えた値は、マウントの後に読む
	 * （ceilingSetting.ts。読めなければ既定のまま）。
	 */
	const [ceiling, setCeiling] = useState(true);
	const [settingsOpen, setSettingsOpen] = useState(false);
	useEffect(() => {
		setCeiling(loadCeiling(browserStorage()));
	}, []);
	const toggleCeiling = () => {
		const next = !ceiling;
		setCeiling(next);
		saveCeiling(browserStorage(), next);
	};
	/**
	 * 視点の自動追従のあり・なし（同じ設定の中。既定はあり、端末の動きを減らす設定がオンならなし）。
	 * 端末に覚えた値は、マウントの後に読む（autoCamera.ts）。
	 */
	const [autoCamera, setAutoCamera] = useState(true);
	useEffect(() => {
		setAutoCamera(
			loadAutoCamera(
				browserStorage(),
				window.matchMedia("(prefers-reduced-motion: reduce)").matches,
			),
		);
	}, []);
	const toggleAutoCamera = () => {
		const next = !autoCamera;
		setAutoCamera(next);
		saveAutoCamera(browserStorage(), next);
	};
	/** 視点パッドを指で押さえているか（向き 0 のまま押さえている間も、自動で回さない）。 */
	const lookHeldRef = useRef(false);
	/** 描いているペイント（issue-25）。 */
	const [draft, setDraft] = useState<PaintDraft>(emptyDraft);
	/** 自分のポーズ（issue-56）と、ポーズボタンを押したか（押していれば、確定のときに送る）。 */
	/**
	 * 選んだポーズ（issue-59）。待機ポーズとゲームの隠れ側のポーズは別の変数に持ち、ステージに移ったら
	 * ゲーム用は null から始める（poseChoice.ts）。
	 */
	const [poseChoice, setPoseChoice] = useState(NO_POSE_CHOICE);
	const pose: VeryareModelPose = poseChoice.game ?? DEFAULT_POSE;
	const poseChosen = poseChoice.game !== null;
	/** ゲーム用のポーズを選んだ時刻（選んだポーズの表示名を POSE_NOTICE_MS だけ出す / issue-57）。 */
	const [poseNoticeAt, setPoseNoticeAt] = useState<number | null>(null);
	/** 待機ポーズのボタンを止めている間か（押してから WAITING_POSE_INTERVAL_MS）。 */
	const [waitingPoseCooling, setWaitingPoseCooling] = useState(false);
	const waitingPosePressedRef = useRef<number | null>(null);
	/** 素材の体に差し替えたか（シーンが決める。ポーズボタンを出すかに使う）。 */
	const [bodyPosable, setBodyPosable] = useState(false);
	/** キャラクターの素材の差し替え口（issue-56）。対戦の画面を開いた時点で読み込みを始める。 */
	const [characterSlot] = useState(() => assets.characterSlot());
	/** 選んでいる色。null の間は「ここの色」。 */
	const [paintColor, setPaintColor] = useState<string | null>(null);
	const [hsl, setHsl] = useState<Hsl>({ h: 30, s: 40, l: 50 });
	const [brush, setBrush] = useState<BrushName>("medium");
	const [eyedropper, setEyedropper] = useState(false);
	/** 「塗り終わり」を押したか。 */
	const [paintConfirmed, setPaintConfirmed] = useState(false);
	/** ペイントを送ったか（一度だけ）。 */
	const [paintSubmitted, setPaintSubmitted] = useState(false);
	const submittedRef = useRef(false);
	const drawingRef = useRef(false);
	/** まだ隠れている隠れ側の一覧。届くまでは null。 */
	const [hiding, setHiding] = useState<readonly string[] | null>(null);
	/** 探索中の隠れ側が、鬼 TPS 視点を選んでいるか。 */
	const [choseOni, setChoseOni] = useState(false);
	const [now, setNow] = useState(0);
	/** 最後に撃った時刻（自分のタイマー。撃つボタンの無効の表示に使う / issue-27）。 */
	const [lastShotAt, setLastShotAt] = useState<number | null>(null);
	/** 「見つけた！」を出した時刻。 */
	const [foundAt, setFoundAt] = useState<number | null>(null);
	/** 外れの理由（推定。表示だけ）と、出した時刻。 */
	const [miss, setMiss] = useState<{
		readonly reason: MissReason;
		readonly at: number;
	} | null>(null);
	/** 最後に撃った相手と、直前の隠れている一覧（命中を一覧の更新で知るため）。 */
	const shotTargetRef = useRef<string | null>(null);
	const hidingRef = useRef<readonly string[] | null>(null);

	const sceneRef = useRef<VeryareScene | null>(null);
	const positionRef = useRef<Point>(WAITING_ROOM_SPAWN);
	/**
	 * サーバーが持っているはずの自分の位置（issue-29c）。報告のたびに、サーバーの game.move を
	 * 再現して進め（mirrorMove）、手元の位置と 1 cm 以上ずれたら手元を合わせる（reconcile）。
	 */
	const serverRef = useRef<Point>(WAITING_ROOM_SPAWN);
	/** 届いた鬼の通知（受け取った時刻つき。ほかの人の画面で補間する / issue-46）。 */
	const oniTrackRef = useRef<readonly OniSample[]>([]);
	/**
	 * 待機ルームのほかのメンバー（issue-59）。通知の購読と描画ループで読むので参照に持ち、画面の属性
	 * （E2E）に出す人数と待機ポーズだけを state にする。
	 */
	const membersRef = useRef<Members>(NO_MEMBERS);
	const [memberView, setMemberView] = useState(() =>
		membersSummary(NO_MEMBERS),
	);
	/** いいねの数（答え合わせの間に届く。隠れ側ごと / issue-32）と、自分が送った相手。 */
	const [likes, setLikes] = useState<ReadonlyMap<string, number>>(
		() => new Map(),
	);
	const [liked, setLiked] = useState<ReadonlySet<string>>(() => new Set());
	/** 答え合わせで見ている隠れ場所（issue-32）。null は自分の視点。 */
	const [revealTarget, setRevealTarget] = useState<string | null>(null);
	/** 通知の購読の中で、いまのフェーズを読むための参照（遅れて届いた members を捨てる）。 */
	const phaseRef = useRef<Phase>("oni-selection");

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
			if (next === null) return;
			setHiders(next.hiders);
			// 自分が載っていれば、それがサーバーの持つ自分の位置（探索中の隠れ側は動けない）。
			// 再接続で玄関から始め直した自分の体も、隠れた場所へ戻る。
			const self = next.hiders.find((h) => h.playerId === youRef.current);
			if (self !== undefined) {
				positionRef.current = { x: self.x, z: self.z };
				serverRef.current = { x: self.x, z: self.z };
			}
		});
		const offOni = on("oni", (payload) => {
			const next = parseOniNotice(payload);
			if (next === null) return;
			setOniState(next);
			// ほかの人の画面で、通知の間を補間するため、受け取った時刻つきで持つ（issue-46）。
			oniTrackRef.current = pushOniSample(oniTrackRef.current, {
				at: performance.now(),
				x: next.x,
				z: next.z,
				facing: next.facing,
			});
		});
		const offHiding = on("hiding", (payload) => {
			const next = parseHidingNotice(payload);
			if (next === null) return;
			if (
				foundByShot(shotTargetRef.current, hidingRef.current, next.playerIds)
			) {
				shotTargetRef.current = null;
				setFoundAt(performance.now());
				// 推定が外れでも、サーバーが当てたなら「見つけた！」だけを出す（判定はサーバー）。
				setMiss(null);
			}
			hidingRef.current = next.playerIds;
			setHiding(next.playerIds);
		});
		// 待機ルームのメンバー（issue-59）。クライアントのフェーズが鬼選出でなければ捨てる。
		const offMembers = on("members", (payload) => {
			const list = parseMembersNotice(payload);
			if (list === null) return;
			const next = applyMembersNotice(membersRef.current, list, {
				self: youRef.current,
				at: performance.now(),
				phase: phaseRef.current,
			});
			if (next === membersRef.current) return;
			membersRef.current = next;
			setMemberView(membersSummary(next));
		});
		// いいねの数（issue-32）。答え合わせの間、変わるたびに全員へ届く。
		const offLikes = on("likes", (payload) => {
			const next = parseLikesNotice(payload);
			if (next !== null) setLikes(next);
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
			offLikes();
			offMembers();
			offStage();
			offDoors();
			offPhase();
			offInfo();
			offHiders();
			offOni();
			offHiding();
		};
	}, [on]);

	const phase: Phase = notice?.phase ?? "oni-selection";
	phaseRef.current = phase;
	// 鬼選出を離れたら（ステージに移ったら）、ほかのメンバーの体を消す（issue-59）。
	useEffect(() => {
		const next = membersInPhase(membersRef.current, phase);
		if (next === membersRef.current) return;
		membersRef.current = next;
		setMemberView(membersSummary(next));
	}, [phase]);
	/** 参加者の名前（頭上の名前に使う / issue-59）。 */
	const names = useMemo(
		() => new Map(players.map((player) => [player.playerId, player.name])),
		[players],
	);
	const role = roleOf(notice?.oni ?? null, you);
	const space = spaceOf(phase, role);
	const spectator = isSpectator(phase, role, hiding, you);
	const oniVisible =
		(phase === "exploration" || phase === "reveal") && oniState !== null;
	// 答え合わせの外では、隠れ場所の視点を外す（次の答え合わせは自分の視点から始める / issue-32）。
	useEffect(() => {
		if (phase !== "reveal") setRevealTarget(null);
	}, [phase]);
	const view = viewOf({
		phase,
		role,
		spectator,
		choseOni,
		oniKnown: oniState !== null,
		revealTarget,
		you,
	});
	// 鬼の視界の報告（issue-32）。探索中の鬼だけが、0.5 秒ごとに送る。
	const sightActive = canReportSight({ phase, role, spectator });
	// 観戦者は移動できない（サーバー側でも、準備移動の後の隠れ側の移動は無視される）。
	const movable = notice !== null && canMove(phase, role) && !spectator;
	// ほかの人の画面の鬼は、描画のたびに補間する（oniTrack.ts）。鬼本人の画面では、通知の位置の
	// 鬼は描かず、自分の体を鬼の体にして、手元の位置と向きで動かす（issue-46）。
	const othersOni = oniVisible && role !== "oni";
	// 鬼が見えなくなったら（探索の前・終わった後）、持っている通知を捨てる（次の対戦に持ち越さない）。
	useEffect(() => {
		if (!oniVisible) oniTrackRef.current = [];
	}, [oniVisible]);
	const selfOni =
		role === "oni" &&
		space === "stage" &&
		(phase === "exploration" || phase === "reveal");
	const sceneHiders: readonly SceneHider[] =
		(phase === "exploration" || phase === "reveal") && hiders !== null
			? hiders
					.filter((h) => h.playerId !== you)
					.map((h) => ({
						id: h.playerId,
						x: h.x,
						z: h.z,
						facing: h.facing,
						pose: h.pose,
						color: h.paint?.kind === "uniform" ? h.paint.color : DEFAULT_COLOR,
						paint: h.paint,
					}))
			: [];
	// 答え合わせの赤い点滅（ADR 0033）。探索の開始に届いた隠れ側全員（見つかった人も
	// 逃げ切った人も）。被りで失格した人は一覧に無いので、点滅しない。
	const blink = blinkTargets(
		phase,
		hiders === null ? null : hiders.map((h) => h.playerId),
		you,
	);
	const painting = canPaintWhileWaiting(phase, role);
	// 答え合わせの隠れ場所の切り替えと、いいね（issue-32）。
	const targets = revealTargets(hiders);
	const nameOf = (id: string) => names.get(id) ?? "隠れ側";
	const likeable = canLike({ phase, target: revealTarget, you, liked });
	const onLike = () => {
		if (!likeable || revealTarget === null) return;
		send(likeEvent(revealTarget));
		setLiked((current) => new Set([...current, revealTarget]));
	};
	// 待機ルームのポーズボタン（issue-59）。素材の体のときだけ出す。押すたびに、いまと違うポーズへ
	// ランダムに変え、waiting-pose を送る。サーバーの間と同じだけ、ボタンを止める。
	const waitingPoseShown =
		phase === "oni-selection" && space === "waiting-room" && bodyPosable;
	const onWaitingPose = () => {
		const at = performance.now();
		if (
			!canChangeWaitingPose({
				phase,
				space,
				posable: bodyPosable,
				now: at,
				lastPressedAt: waitingPosePressedRef.current,
			})
		) {
			return;
		}
		waitingPosePressedRef.current = at;
		const next = pickNextPose(
			poseChoice.waiting ?? DEFAULT_POSE,
			RANDOM_POSE_POOL,
			Math.random,
		);
		// 自分の体には、手元ですぐ反映する（サーバーからは、ほかの人にだけ届く）。
		setPoseChoice((choice) => chooseWaitingPose(choice, next));
		send(waitingPoseEvent(next));
		setWaitingPoseCooling(true);
		window.setTimeout(
			() => setWaitingPoseCooling(false),
			WAITING_POSE_INTERVAL_MS,
		);
	};
	// 射撃（issue-27）。撃てるのは探索フェーズの鬼だけ。間隔は自分のタイマーで見せる。
	const shootable = canShoot(phase, role, spectator);
	const reloadMs = reloadRemainingMs(lastShotAt, now);
	const showFound = foundAt !== null && now - foundAt < FOUND_NOTICE_MS;
	const showMiss = miss !== null && now - miss.at < MISS_NOTICE_MS;
	// 狙う点（タップで決める / issue-46 の続き）。撃てる間だけ持ち、撃てなくなったら消す。
	const [aim, setAim] = useState<Vec3 | null>(null);
	const tapsRef = useRef(createTapTracker());
	useEffect(() => {
		if (!shootable) setAim(null);
	}, [shootable]);
	const shoot = () => {
		const at = performance.now();
		if (reloadRemainingMs(lastShotAt, at) > 0) return;
		const scene = sceneRef.current;
		// 狙う点があれば、そこにいる隠れ側（いなければ外れ）。無ければ、これまでどおり画面の中央。
		const target =
			scene === null
				? null
				: shotTarget(aim, scene.hiderBodies(), () => scene.pickHider());
		shotTargetRef.current = target;
		setLastShotAt(at);
		setNow(at);
		send(shootEvent(target));
		// 外れの理由を、サーバーと同じ規則で推定して出す（表示だけ。判定はサーバー）。
		const body =
			target === null
				? undefined
				: scene?.hiderBodies().find((hider) => hider.id === target);
		const hint = missHint({
			grid,
			open: openDoors,
			oni: positionRef.current,
			target: body === undefined ? null : { x: body.x, z: body.z },
			reloadMs: 0,
		});
		setMiss(hint === null ? null : { reason: hint, at });
		if (traceEnabled(HIRAYA_DEV, window.location.search)) {
			console.info(shotMessage({ target, aim }));
			const before = hidingRef.current ?? [];
			window.setTimeout(() => {
				console.info(
					shotLogMessage({
						target,
						hint,
						before,
						after: hidingRef.current ?? [],
					}),
				);
			}, SHOT_LOG_DELAY_MS);
		}
	};
	// 狙いのタップ。キャンバスの上で始まったタッチだけを、指ごとに見る（操作部品はキャンバスの外）。
	const onAimDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!shootable) return;
		tapsRef.current.down(
			event.pointerId,
			{ x: event.clientX, y: event.clientY },
			event.timeStamp,
		);
	};
	const onAimMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!shootable) return;
		tapsRef.current.move(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
		});
	};
	const onAimUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!shootable) return;
		const at = { x: event.clientX, y: event.clientY };
		if (!tapsRef.current.up(event.pointerId, at, event.timeStamp)) return;
		const ndc = toNdc(at, event.currentTarget.getBoundingClientRect());
		setAim(sceneRef.current?.pickAim(ndc.x, ndc.y)?.point ?? null);
	};
	const onAimCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		tapsRef.current.cancel(event.pointerId);
	};
	// 襖を開けるボタン（issue-29c）。閉じた襖の境から 1.5 m 以内のとき、いちばん近い襖を
	// 開ける報告を送る。表示は襖の通知を待って変える（クライアントは襖の状態を変えない）。
	// 位置は描画ループの参照なので、残り時間の更新（250 ms ごと）に合わせて見直す。
	const door =
		grid === null
			? null
			: doorToOpen({
					grid,
					open: openDoors,
					phase,
					movable,
					space,
					position: positionRef.current,
				});
	const openDoor = () => {
		if (door !== null) send(openDoorEvent(door));
	};
	// 待機中ペイントは待機ルームの中だけで見せる。ステージの見た目には一切持ち込まない。
	const avatarColor =
		role === "oni" && space === "waiting-room" ? waitingColor : DEFAULT_COLOR;

	// 残り時間の表示を更新する。
	useEffect(() => {
		const timer = setInterval(() => setNow(performance.now()), 250);
		return () => clearInterval(timer);
	}, []);
	const remainingMs =
		notice?.durationMs == null
			? Number.POSITIVE_INFINITY
			: notice.durationMs - (now - phaseStartedAt);

	// ペイント（issue-25）。ペイントフェーズの隠れ側が、自分の体の円柱に描く。描いている間は
	// 自分の画面だけ（誰にも送らない）。終わりの 2 秒前か「塗り終わり」で、一度だけ送る。
	const paintEditable = canEditPaint({
		phase,
		role,
		spectator,
		submitted: paintSubmitted,
		remainingMs,
	});
	const showPaintPanel = phase === "painting" && role === "hider" && !spectator;
	// ゲーム用のポーズ（issue-57）。準備移動とペイントフェーズの隠れ側が、確定の電文を送る前まで選べる。
	// 準備移動では画面のボタン、ペイントフェーズではペイントの板のボタン。押すたびに、選ぶポーズだけを
	// 変え（体は、動いていれば歩く・走るのまま、止まると選んだポーズへ移る / motionState.ts）、
	// 選んだポーズの表示名を POSE_NOTICE_MS だけ出す。
	const gamePoseOpen =
		bodyPosable &&
		canChangePose({ phase, role, spectator, submitted: paintSubmitted });
	const gamePoseShown = gamePoseOpen && phase === "preparation";
	const poseNoticeShown = poseNoticeVisible(poseNoticeAt, now);
	const onNextGamePose = () => {
		if (!gamePoseOpen) return;
		setPoseChoice((choice) =>
			chooseGamePose(
				choice,
				pickNextPose(
					choice.game ?? DEFAULT_POSE,
					RANDOM_POSE_POOL,
					Math.random,
				),
			),
		);
		const at = performance.now();
		setPoseNoticeAt(at);
		setNow(at);
		// 表示名を消すため、出しておく時間の後に描き直す（残り時間の表示の 250 ms ごとより早く）。
		window.setTimeout(() => setNow(performance.now()), POSE_NOTICE_MS);
	};
	useEffect(() => {
		if (
			submittedRef.current ||
			!shouldSubmitPaint({
				phase,
				remainingMs,
				submitted: paintSubmitted,
				confirmed: paintConfirmed,
				strokeCount: draft.strokes.length,
				poseChosen,
			})
		) {
			return;
		}
		submittedRef.current = true;
		setPaintSubmitted(true);
		// ペイントとポーズは、同じ確定の電文で一度だけ送る（issue-56）。
		send(paintEvent(draft.strokes, poseChosen ? pose : null));
	}, [
		phase,
		remainingMs,
		paintSubmitted,
		paintConfirmed,
		draft,
		send,
		pose,
		poseChosen,
	]);
	// 自分の体に映すペイント。探索の開始に届いた自分のペイント（サーバーが確定したもの）を先に、
	// 無ければ描いている途中のもの。
	const serverSelfPaint =
		hiders?.find((h) => h.playerId === you)?.paint ?? null;
	const selfPaint: VeryarePaint | null =
		role !== "hider"
			? null
			: (serverSelfPaint ??
				(draft.strokes.length > 0
					? { kind: "strokes", strokes: draft.strokes }
					: null));
	// ここの色。平屋の glb を表示しているときは、足もとの床の見た目の色（ペイント画面の間だけ求める）。
	// 表示していなければ、サーバーの代表色の表（palette.ts）。
	const sceneHere = showPaintPanel
		? (sceneRef.current?.floorColorAt(
				positionRef.current.x,
				positionRef.current.z,
			) ?? null)
		: null;
	const here =
		sceneHere ?? (grid === null ? null : hereColor(grid, positionRef.current));
	const brushColor = paintColor ?? here ?? FLOOR_COLOR;
	const pointOnCanvas = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		return sceneRef.current?.pickPaint(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-(((event.clientY - rect.top) / rect.height) * 2 - 1),
		);
	};
	const onPaintDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!paintEditable) return;
		const pick = pointOnCanvas(event);
		if (pick == null) return;
		if (eyedropper) {
			setPaintColor(
				pick.kind === "stage" ? pick.color : bodyColorAt(draft.strokes, pick),
			);
			setEyedropper(false);
			return;
		}
		if (pick.kind !== "body") return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drawingRef.current = true;
		setDraft((current) =>
			beginStroke(current, {
				color: brushColor,
				size: BRUSH_SIZES[brush],
				point: pick,
			}),
		);
	};
	const onPaintMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!paintEditable || !drawingRef.current) return;
		const pick = pointOnCanvas(event);
		if (pick?.kind !== "body") return;
		setDraft((current) => extendStroke(current, pick));
	};
	const onPaintUp = () => {
		drawingRef.current = false;
	};
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
		selfPaint,
		blink,
		phaseStartedAt,
		phase,
		role,
		grid,
		openDoors,
		move,
		look,
		movable,
		space,
		avatarColor,
		area,
		send,
		view,
		othersOni,
		selfOni,
		sceneHiders,
		stageSlot,
		materialSlot,
		roofVisible,
		ceiling,
		autoCamera,
		modelShown,
		setModelShown,
		showPaintPanel,
		sightActive,
		aim,
		pose,
		poseChosen,
		avatarPose: avatarPoseOf(poseChoice, space),
		avatarFixed: avatarPoseFixed(phase, role),
		names,
		bodyPosable,
		setBodyPosable,
	});
	latest.current = {
		selfPaint,
		blink,
		phaseStartedAt,
		phase,
		role,
		grid,
		openDoors,
		move,
		look,
		movable,
		space,
		avatarColor,
		area,
		send,
		view,
		othersOni,
		selfOni,
		sceneHiders,
		stageSlot,
		materialSlot,
		roofVisible,
		ceiling,
		autoCamera,
		modelShown,
		setModelShown,
		showPaintPanel,
		sightActive,
		aim,
		pose,
		poseChosen,
		avatarPose: avatarPoseOf(poseChoice, space),
		avatarFixed: avatarPoseFixed(phase, role),
		names,
		bodyPosable,
		setBodyPosable,
	};

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const fadeRef = useRef<HTMLDivElement | null>(null);

	// three.js のシーンを作り、描画ループを回す。three.js は遅延読み込みする。
	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas === null) return;
		let disposed = false;
		/** テスト用の口の片付け（口を作らなければ何もしない）。 */
		let removeTestHook: () => void = () => undefined;
		let frame = 0;
		let observer: ResizeObserver | null = null;

		void import("./scene").then(({ createScene }) => {
			if (disposed) return;
			// カメラの定数。開発中だけ、URL の指定（?camPitchMax=0.45 など）で変えられる。
			const camera = cameraSettings(HIRAYA_DEV, window.location.search);
			// 動きの見張り（issue-57 の後半）。テスト用の口か、開発用の合図のときだけ作る（本番の既定では
			// 作らない）。開発用の合図のときは、止まりを Console に出す。
			const watch = motionWatchEnabled({
				testHooks: process.env.NEXT_PUBLIC_RONDO_TEST_HOOKS === "1",
				dev: HIRAYA_DEV,
				search: window.location.search,
			})
				? createMotionWatch(
						traceEnabled(HIRAYA_DEV, window.location.search)
							? (stall) => console.warn(stallLogMessage(stall))
							: undefined,
					)
				: null;
			// 開発中だけ、カメラの高さを Console に出す（?roof=1 と同じ合図）。
			const scene = createScene(canvas, {
				trace: devTrace,
				camera,
				// キャラクターの素材（issue-56）。待機ルームにいる間に、仮のカプセルから差し替える。
				bodies: characterSlot,
				...(watch === null ? {} : { watch }),
				...(traceEnabled(HIRAYA_DEV, window.location.search)
					? {
							cameraLog: (message: string) => console.info(message),
							motionLog: (message: string) => console.info(message),
						}
					: {}),
			});
			sceneRef.current = scene;
			const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
			fit();
			observer = new ResizeObserver(fit);
			observer.observe(canvas);

			let yaw = 0;
			const pitch = camera.pitch;
			// 視点の自動追従の定数（開発中だけ URL で変えられる）と、いまの回る速さ。
			const follow = autoCameraSettings(HIRAYA_DEV, window.location.search);
			let followRate = 0;
			/** 視点パッドを最後に触った時刻（ミリ秒）。触っていなければ、ずっと前。 */
			let lookTouchedAt = Number.NEGATIVE_INFINITY;
			/**
			 * テストから与えた移動の傾き（テスト用の口があるときだけ。与えていなければ null で、パッドの入力を
			 * 使う / testHooks.ts の setMove）。
			 */
			let testMove: { readonly x: number; readonly y: number } | null = null;
			// テスト用の口（テスト用の環境変数があるときだけ / testHooks.ts）。条件は、この場で環境変数を
			// 比べる（ビルド時に false に置き換わり、口の読み込みごと本番の配るファイルから消える）。
			// ゲームの状態は、描画ループと同じ値（手元の位置、視点の向き）を読むだけで、書き換えない。
			if (process.env.NEXT_PUBLIC_RONDO_TEST_HOOKS === "1") {
				void import("./testHooks").then(({ installVeryareTestHook }) => {
					if (disposed) return;
					removeTestHook = installVeryareTestHook(
						true,
						window as unknown as Record<string, unknown>,
						() => sceneRef.current,
						() => ({
							phase: latest.current.phase,
							position: positionRef.current,
							yaw,
							openDoors: latest.current.openDoors.size,
						}),
						{
							setMove: (input) => {
								testMove = input;
							},
							move: () => testMove,
						},
					);
				});
			}
			const reduceMotion = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			);
			let last = performance.now();
			let lastSent = 0;
			let sentPosition: Point | null = null;
			let sentFacing: number | null = null;
			/**
			 * 自分の体の向き（issue-57）。スティックを倒した方向へ、なめらかに回す（視点の向きとは分ける。
			 * 止まったら最後の向きを保つ / bodyFacing.ts）。鬼本人の体にも、移動の報告にも、この向きを使う。
			 */
			let bodyFacing = facingOfYaw(yaw);
			/** 最後に視界を報告した時刻（issue-32）。探索の外では null に戻す。 */
			let lastSight: number | null = null;

			const loop = (time: number) => {
				const dt = Math.min((time - last) / 1000, 0.1);
				last = time;
				const current = latest.current;
				const move = testMove ?? current.move;

				yaw -= current.look.x * TURN_SPEED * dt;
				// 視点の自動追従（yaw だけを動かす）。移動より先に回し、このコマの移動と体の向きは、
				// 回した後の yaw を使う。
				if (
					lookHeldRef.current ||
					current.look.x !== 0 ||
					current.look.y !== 0
				) {
					lookTouchedAt = time;
				}
				const followed = stepAutoCamera(
					{ yaw, rate: followRate },
					{
						move,
						speed: Math.hypot(move.x, move.y) * WALK_SPEED,
						secondsSinceLook: (time - lookTouchedAt) / 1000,
						enabled:
							current.autoCamera &&
							autoCameraActive(current.phase, current.movable),
						dt,
					},
					follow,
				);
				yaw = followed.yaw;
				followRate = followed.rate;
				if (current.movable) {
					// 手元でも、サーバーと同じ規則（壁・襖・待機ルームの円）で動かす。
					const rule = {
						phase: current.phase,
						role: current.role,
						space: current.space,
						grid: current.grid,
						open: current.openDoors,
					};
					positionRef.current = mirrorMove({
						...rule,
						from: positionRef.current,
						to: walkTarget(positionRef.current, move, yaw, WALK_SPEED, dt),
					});
					// 位置と向きはクライアントが報告し、サーバーが制限する（変わったときだけ
					// 間引いて送る）。向きは観戦者へ送る鬼の向きに使う（issue-28）。
					const position = positionRef.current;
					bodyFacing = stepFacing(bodyFacing, move, yaw, dt);
					const facing = bodyFacing;
					if (
						shouldReport({
							time,
							lastSent,
							position,
							sentPosition,
							facing,
							sentFacing,
						})
					) {
						current.send(moveReport(position, facing));
						// サーバーは前の位置から報告の位置へ一度に動かす。その結果を再現して、
						// 角や壁沿いで手元の小刻みな動きとずれたら、サーバーの位置に合わせる。
						serverRef.current = mirrorMove({
							...rule,
							from: serverRef.current,
							to: position,
						});
						positionRef.current = reconcile(position, serverRef.current);
						sentPosition = position;
						sentFacing = facing;
						lastSent = time;
					}
				}

				scene.setStage(current.grid, current.openDoors);
				scene.setStageModel(current.stageSlot);
				scene.setStageMaterials(current.materialSlot);
				scene.setRoofVisible(current.roofVisible);
				scene.setCeilingVisible(current.ceiling);
				// ステージのカメラは領域の外に出さない（ADR 0043）。ペイント画面と待機ルームは対象外。
				scene.setCameraClamp(
					current.space === "stage" && !current.showPaintPanel,
				);
				scene.setSpace(current.space);
				const shown = scene.stageModelShown();
				if (shown !== current.modelShown) current.setModelShown(shown);
				scene.setArea(current.area);
				scene.setAvatar(
					positionRef.current,
					current.avatarColor,
					current.selfPaint,
				);
				scene.setOni(
					current.othersOni
						? sampleOni(
								oniTrackRef.current,
								time - trackDelay(oniTrackRef.current),
							)
						: null,
				);
				scene.setSelfOni(current.selfOni ? bodyFacing : null);
				// 自分の体の向きとポーズ（issue-56）。ポーズを変えたときは、シーンがなめらかに寄せる。
				scene.setAvatarFacing(bodyFacing);
				// 選んだポーズ（押していなければ null）。待機ルームでは待機ポーズ、ステージではゲーム用の
				// ポーズ（issue-59）。隠れ側は、ペイントフェーズ以降、静止した姿勢に固定する（issue-57）。
				scene.setAvatarPose(current.avatarPose, current.avatarFixed);
				// 待機ルームのほかのメンバー（issue-59）。補間した位置で描く。
				scene.setMembers(
					current.space === "waiting-room"
						? sampleMembers(membersRef.current, time, current.names)
						: [],
				);
				const posable = scene.bodyPosable();
				if (posable !== current.bodyPosable) current.setBodyPosable(posable);
				scene.setAim(current.aim);
				scene.setHiders(current.sceneHiders);
				scene.setView(current.view);
				scene.setBlink(
					current.blink.others,
					current.blink.self,
					blinkLevel(time - current.phaseStartedAt, reduceMotion.matches),
				);
				scene.setCamera(yaw, pitch);
				scene.render();
				// 鬼の視界の報告（issue-32）。描いたばかりのカメラで、壁越しを除いて見えている隠れ側を送る。
				if (!current.sightActive) {
					lastSight = null;
				} else if (shouldReportSight(time, lastSight)) {
					current.send(sightEvent(scene.sightedHiders()));
					lastSight = time;
				}
				frame = requestAnimationFrame(loop);
			};
			frame = requestAnimationFrame(loop);
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			observer?.disconnect();
			removeTestHook();
			sceneRef.current?.dispose();
			sceneRef.current = null;
		};
		// characterSlot は useState の値で変わらない（シーンは画面を開いている間、1つだけ作る）。
	}, [characterSlot]);

	// 空間が変わったら、その空間の初期位置に立ち、暗転から明ける短い演出を入れる。
	// ステージの初期位置は、ステージの通知の玄関（サーバーも同じ所へ置く / issue-29a）。
	// 通知が届く前にステージへ移ったら、届いたときに立つ。同じ地図が届き直しても
	// （再接続の後など）、立ち直さない。
	const placedRef = useRef<Space>("waiting-room");
	useEffect(() => {
		if (placedRef.current === space) return;
		if (space === "stage" && grid === null) return;
		placedRef.current = space;
		const start =
			space === "stage" && grid !== null ? grid.spawn : WAITING_ROOM_SPAWN;
		positionRef.current = start;
		serverRef.current = start;
		// ステージに移ったら、ゲーム用の選んだポーズは null から始める（待機のポーズを引き継がない）。
		setPoseChoice((choice) => enterSpace(choice, space));
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (!reduce) {
			fadeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 450,
				easing: "ease-out",
			});
		}
	}, [space, grid]);

	return (
		<div
			className="flex w-full flex-col gap-3"
			data-testid="veryare"
			data-phase={phase}
			data-open-doors={openDoors.size}
			data-blinking={blink.others.length + (blink.self ? 1 : 0)}
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
			{waitingPoseShown ? (
				<button
					type="button"
					data-testid="veryare-waiting-pose"
					data-pose={poseChoice.waiting ?? ""}
					disabled={waitingPoseCooling}
					onClick={onWaitingPose}
					className="min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset disabled:opacity-50"
				>
					ポーズを変える
					{poseChoice.waiting !== null
						? `（いま: ${poseLabel(poseChoice.waiting)}）`
						: ""}
				</button>
			) : null}

			{gamePoseShown ? (
				<button
					type="button"
					data-testid="veryare-game-pose"
					data-pose={poseChoice.game ?? ""}
					onClick={onNextGamePose}
					className="min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
				>
					ポーズを変える
					{poseChosen ? `（いま: ${poseLabel(pose)}）` : ""}
				</button>
			) : null}
			{poseNoticeShown && (gamePoseOpen || showPaintPanel) ? (
				<output
					data-testid="veryare-pose-notice"
					className="block rounded-xl bg-accent px-3 py-2 text-center font-semibold text-accent-fg text-sm"
				>
					{poseLabel(pose)}
				</output>
			) : null}

			{spectator ? (
				<p className="rounded-xl bg-surface px-3 py-2 text-fg text-sm">
					見つかりました。観戦中です
					{view === "oni"
						? "（鬼の視点・視点パッドで回せます）"
						: "（探索が始まると鬼の視点になります）"}
				</p>
			) : null}
			{roofToggle && modelShown && space === "stage" ? (
				<button
					type="button"
					aria-pressed={roofVisible}
					onClick={() => setRoofVisible((current) => !current)}
					className="min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
				>
					{roofVisible ? "屋根を隠す" : "屋根を表示する"}
				</button>
			) : null}
			{phase === "reveal" && targets.length > 0 ? (
				<div
					className="flex flex-col gap-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-line ring-inset"
					data-testid="veryare-reveal"
					data-reveal-target={revealTarget ?? ""}
				>
					<p className="text-fg text-sm">
						{revealTarget === null
							? "自分の視点"
							: `${nameOf(revealTarget)}${revealTarget === you ? "（自分）" : ""}の隠れ場所`}
						{revealTarget !== null
							? ` ・いいね ${likes.get(revealTarget) ?? 0}`
							: ""}
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() =>
								setRevealTarget((current) =>
									stepRevealTarget(targets, current, -1),
								)
							}
							className="min-h-11 flex-1 rounded-xl bg-ink px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
						>
							前の隠れ場所
						</button>
						<button
							type="button"
							onClick={() =>
								setRevealTarget((current) =>
									stepRevealTarget(targets, current, 1),
								)
							}
							className="min-h-11 flex-1 rounded-xl bg-ink px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
						>
							次の隠れ場所
						</button>
					</div>
					<div className="flex gap-2">
						{revealTarget !== null ? (
							<button
								type="button"
								onClick={() => setRevealTarget(null)}
								className="min-h-11 flex-1 rounded-xl bg-ink px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
							>
								自分の視点
							</button>
						) : null}
						{revealTarget !== null && revealTarget !== you ? (
							<button
								type="button"
								data-testid="veryare-like"
								disabled={!likeable}
								onClick={onLike}
								className="min-h-11 flex-1 rounded-xl bg-accent px-3 font-semibold text-accent-fg text-sm disabled:opacity-50"
							>
								{revealTarget !== null && liked.has(revealTarget)
									? "いいね済み"
									: "いいね"}
							</button>
						) : null}
					</div>
					{role === "hider" && you !== null ? (
						<p className="text-fg-muted text-xs" data-testid="veryare-my-likes">
							あなたへのいいね {likes.get(you) ?? 0}
						</p>
					) : null}
				</div>
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

			<div
				className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl"
				data-testid="veryare-view"
				data-visible-members={memberView.count}
				data-member-poses={memberView.poses}
			>
				<canvas
					ref={canvasRef}
					className="block size-full"
					style={paintEditable ? { touchAction: "none" } : undefined}
					onPointerDown={(event) => {
						onPaintDown(event);
						onAimDown(event);
					}}
					onPointerMove={(event) => {
						onPaintMove(event);
						onAimMove(event);
					}}
					onPointerUp={(event) => {
						onPaintUp();
						onAimUp(event);
					}}
					onPointerCancel={(event) => {
						onPaintUp();
						onAimCancel(event);
					}}
				/>
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
				{shootable ? (
					// 照準（画面の中央）。この向きの先に重なった隠れ側を狙う。
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 flex items-center justify-center"
					>
						<span className="font-bold text-2xl text-fg/80">＋</span>
					</div>
				) : null}
				{showFound ? (
					<div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
						<p
							className="font-bold text-2xl text-fg"
							data-testid="veryare-found"
						>
							見つけた！
						</p>
					</div>
				) : null}
				{showMiss && !showFound ? (
					<div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
						<p className="font-bold text-fg text-lg" data-testid="veryare-miss">
							{missText(miss.reason)}
						</p>
					</div>
				) : null}
				{space === "stage" ? (
					// 画面の隅の設定（天井のあり・なし、視点の自動追従のあり・なし。ランダム間取りと平屋の両方）。
					<div
						className={`absolute right-2 flex flex-col items-end gap-1 ${notice?.outcome != null && phase === "reveal" ? "top-12" : "top-2"}`}
					>
						<button
							type="button"
							aria-expanded={settingsOpen}
							onClick={() => setSettingsOpen((current) => !current)}
							className="min-h-9 rounded-lg bg-ink/70 px-2 font-semibold text-fg text-xs ring-1 ring-line ring-inset"
						>
							設定
						</button>
						{settingsOpen ? (
							<>
								<button
									type="button"
									aria-pressed={ceiling}
									onClick={toggleCeiling}
									className="min-h-9 rounded-lg bg-ink/80 px-2 text-fg text-xs ring-1 ring-line ring-inset"
									data-testid="veryare-ceiling"
								>
									天井: {ceiling ? "あり" : "なし"}
								</button>
								<button
									type="button"
									aria-pressed={autoCamera}
									onClick={toggleAutoCamera}
									className="min-h-9 rounded-lg bg-ink/80 px-2 text-fg text-xs ring-1 ring-line ring-inset"
									data-testid="veryare-auto-camera"
								>
									視点の自動追従: {autoCamera ? "あり" : "なし"}
								</button>
							</>
						) : null}
					</div>
				) : null}
				{/* 終了後の勝敗は、基盤の結果画面（game-ended）に任せる（issue-42）。 */}
			</div>

			{showPaintPanel ? (
				<PaintPanel
					editable={paintEditable}
					submitted={paintSubmitted}
					locked={remainingMs <= PAINT_LOCK_MS}
					strokeCount={draft.strokes.length}
					color={brushColor}
					here={here}
					brush={brush}
					eyedropper={eyedropper}
					hsl={hsl}
					onColor={setPaintColor}
					onHsl={(next) => {
						setHsl(next);
						setPaintColor(hslToHex(next.h, next.s, next.l));
					}}
					onBrush={setBrush}
					onEyedropper={() => setEyedropper((current) => !current)}
					onUndo={() => setDraft(undoStroke)}
					onClear={() => setDraft(clearPaint)}
					onConfirm={() => setPaintConfirmed(true)}
					{...(bodyPosable
						? {
								pose: {
									label: poseLabel(pose),
									chosen: poseChosen,
									// いまと違うポーズを、プールからランダムに選ぶ（issue-56）。
									onNext: onNextGamePose,
								},
							}
						: {})}
				/>
			) : null}
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
							<VirtualPad name="move" size={120} deadZone={PAD_DEAD_ZONE} />
						</div>
						<span className="text-fg-muted text-xs">移動</span>
					</div>
				) : (
					// 動けない間（観戦中を含む）は移動パッドを出さない。
					<div aria-hidden="true" className="size-[120px]" />
				)}
				{door !== null ? (
					<button
						type="button"
						onClick={openDoor}
						data-testid="veryare-open-door"
						className="min-h-11 rounded-xl bg-surface px-4 font-semibold text-fg text-sm ring-1 ring-line ring-inset active:scale-95"
					>
						襖を開ける
					</button>
				) : null}
				{shootable ? (
					<button
						type="button"
						onClick={shoot}
						disabled={reloadMs > 0}
						data-testid="veryare-shoot"
						className="size-20 rounded-full bg-accent font-bold text-accent-fg transition-transform active:scale-95 disabled:opacity-50"
					>
						{reloadMs > 0 ? `${Math.ceil(reloadMs / 1000)}` : "撃つ"}
					</button>
				) : null}
				<div className="flex flex-col items-center gap-1">
					<div
						className="rounded-full bg-surface ring-1 ring-line ring-inset"
						// 押さえている間を知るため（自動追従を止める）。パッドの動きには関わらない。
						onPointerDown={() => {
							lookHeldRef.current = true;
						}}
						onPointerUp={() => {
							lookHeldRef.current = false;
						}}
						onPointerCancel={() => {
							lookHeldRef.current = false;
						}}
						onLostPointerCapture={() => {
							lookHeldRef.current = false;
						}}
					>
						<VirtualPad name="look" size={120} deadZone={PAD_DEAD_ZONE} />
					</div>
					<span className="text-fg-muted text-xs">視点</span>
				</div>
			</div>
		</div>
	);
}
