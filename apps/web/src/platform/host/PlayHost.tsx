"use client";

/**
 * 汎用ゲームホスト（基盤 / ADR 0003・0004）。
 *
 * registry から id でゲーム本体を遅延読み込みし、ゲームに GameHost（結果の受け取り）と
 * 共通入力（VirtualPad / ADR 0018）を供給する。ここには特定ゲームの記述を持たず、
 * 表を引くだけなので、ゲームを増やしてもこのコードは変わらない。
 *
 * ソロは realtime を持たない（ADR 0004）。リアルタイムゲームには、タブで共有する
 * セッション（issue-40。単一接続の多重化 / ADR 0007）のルームを渡す。ロビーで参加した
 * ルームや、リロード後に復帰したルームがあればそれを開き、なければ自動で部屋を作る
 * （選択画面から直接来た場合）。サーバーが確定した game-ended を受け取ったら結果発表
 * （ADR 0017 / 0014）を出し、退出でルームの解散へ繋いでロビーへ戻る。既定は Mock
 * （issue-11）なのでサーバーなしでも動く。
 */

import type {
	GameManifest,
	PlayResult,
	PlayerId,
	RealtimeResult,
} from "@rondo/contracts";
import {
	type GameHost,
	GameHostProvider,
	type RealtimeHost,
	VirtualPadProvider,
} from "@rondo/game-sdk";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type ReactNode,
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	findGameLoader,
	isFullscreenGame,
	isRealtimeMatch,
	lobbyPathOf,
	registry,
} from "../../games/registry";
import { GameLogo } from "../brand/GameLogo";
import { displayName } from "../brand/gameBrand";
import { LaunchGate } from "../launch/LaunchGate";
import { needsLaunchScreen } from "../launch/launch";
import { SoloGameLinks, soloGames } from "../lobby/soloGames";
import { ResultScreen } from "../result/ResultScreen";
import { closingDeadline } from "../result/closing";
import { ConnectionFailed } from "../session/ConnectionFailed";
import { type ErrorNotice, noticeFor } from "../session/serverErrors";
import {
	isSpectatorIn,
	playEntry,
	playStatus,
	roomExpired,
} from "../session/session";
import {
	getRealtimeSession,
	useSessionState,
} from "../session/useRealtimeSession";
import { GameFrame } from "./GameFrame";
import { RoomNameLabel } from "./RoomNameLabel";
import { resultView } from "./resultView";

interface RealtimeSession {
	readonly realtime: RealtimeHost | null;
	readonly result: RealtimeResult | null;
	/** 結果のあと、ルームが閉じる時刻（Date.now() の時計 / issue-70）。分からなければ null。 */
	readonly closesAt: number | null;
	/** 結果のあとにルームが閉じた（room-expired / issue-70）。ゲーム画面はロビーへ戻す。 */
	readonly expired: boolean;
	readonly you: PlayerId | null;
	/** 参加中のルームの名前（issue-58）。名前を持たない古いサーバーでは null。 */
	readonly roomName: string | null;
	/**
	 * 部屋に入れなかったとき（作成・参加・復帰の失敗）と、ルームが閉じたとき（room-closed / ADR 0047）の
	 * 案内。文言は、エラーの種類から決める（serverErrors.ts / issue-60）。
	 */
	readonly notice: ErrorNotice | null;
	/** つながらなかった（返事が届かない・つなぎ直しをすべて失敗した / issue-47）。 */
	readonly failed: boolean;
	/** もう一度、部屋に入るところからやり直す。 */
	readonly retry: () => void;
	readonly leave: () => void;
}

/** 開いたゲーム画面に合わせて、部屋を作るか、待つか、そのまま開くかを決めて動く。 */
function enterRoom(gameType: string): void {
	const session = getRealtimeSession();
	switch (playEntry(session.state, gameType)) {
		case "joined":
		case "waiting":
			break;
		case "leave-and-create":
			session.leave();
			session.create(gameType);
			break;
		case "create":
			session.create(gameType);
			break;
	}
}

/**
 * リアルタイムゲーム用のセッション。gameType が null（ソロ）なら接続しない。
 * 部屋に入るまで realtime は null。サーバーの game-ended を受けたら result に確定結果を持つ。
 * 画面を開いている間はルームを握り、離れたまま戻らなければ退出する（RealtimeSession.hold）。
 */
function useRealtimeSession(gameType: string | null): RealtimeSession {
	const state = useSessionState();

	useEffect(() => {
		if (gameType === null) return;
		const release = getRealtimeSession().hold();
		enterRoom(gameType);
		return release;
	}, [gameType]);

	const room =
		gameType !== null && state.room?.gameType === gameType ? state.room : null;
	const roomId = room?.roomId ?? null;
	const you = room?.you ?? null;
	const players = room?.players ?? null;
	// 口は、ルームが変わったときだけ作る（参加者の変化では作り直さない）。
	const port = useMemo(
		() => (roomId === null ? null : getRealtimeSession().gamePort(roomId)),
		[roomId],
	);
	const realtime = useMemo<RealtimeHost | null>(
		() =>
			port === null || roomId === null || you === null || players === null
				? null
				: { port, roomId, you, players },
		[port, roomId, you, players],
	);

	const leave = useCallback(() => {
		// 退出でルームは解散する（ADR 0017）。
		getRealtimeSession().leave();
	}, []);

	const retry = useCallback(() => {
		if (gameType === null) return;
		getRealtimeSession().dismiss();
		enterRoom(gameType);
	}, [gameType]);

	// 閉じる時刻は、残りを受け取った時点から数える（復帰で送り直された残りでも、数え直す / issue-70）。
	const closesAt = useMemo(
		() => closingDeadline(state.closesInMs, Date.now()),
		[state.closesInMs],
	);
	const waiting = gameType !== null && playEntry(state, gameType) === "waiting";
	const failed = gameType !== null && playStatus(state, gameType) === "failed";

	return {
		realtime,
		result: room === null ? null : state.result,
		closesAt: room === null ? null : closesAt,
		expired: gameType !== null && roomExpired(state),
		you,
		roomName: room?.roomName ?? null,
		notice:
			room === null && !waiting && !failed && state.errorCode !== null
				? noticeFor(state.errorCode)
				: null,
		failed,
		retry,
		leave,
	};
}

export function PlayHost({ manifest }: { manifest: GameManifest }) {
	const router = useRouter();
	const [soloResult, setSoloResult] = useState<PlayResult | null>(null);
	const [playKey, setPlayKey] = useState(0);

	// 共通起動画面（issue-30）を挟むゲームは、「はじめる」を押すまで本編を出さない。
	// custom のゲームは最初から起動済みとし、ゲーム自身の起動画面に委ねる。
	const [launched, setLaunched] = useState(() => !needsLaunchScreen(manifest));
	const start = useCallback(() => setLaunched(true), []);

	const isRealtime = manifest.kind === "realtime";
	// ルームへの接続は起動してから始める（起動画面で待つ間に部屋を作らない）。
	const {
		realtime,
		result,
		closesAt,
		expired,
		you,
		roomName,
		notice,
		failed,
		retry,
		leave,
	} = useRealtimeSession(isRealtime && launched ? manifest.id : null);

	const reportResult = useCallback((value: PlayResult) => {
		setSoloResult(value);
	}, []);

	const host = useMemo<GameHost>(
		() => ({ reportResult, realtime }),
		[reportResult, realtime],
	);

	const Game = useMemo(() => {
		const loader = findGameLoader(manifest.id);
		return loader ? lazy(loader) : null;
	}, [manifest.id]);

	const replay = useCallback(() => {
		setSoloResult(null);
		setPlayKey((key) => key + 1);
	}, []);

	// リアルタイムのゲームから退出したら、そのゲームのロビーへ戻る（issue-40）。
	const leaveRoom = useCallback(() => {
		leave();
		router.push(lobbyPathOf(manifest.id));
	}, [leave, router, manifest.id]);

	const backToSelect = useCallback(() => {
		leave();
		router.push("/select");
	}, [leave, router]);

	const toLobby = useCallback(() => {
		leave();
		router.push(lobbyPathOf(manifest.id));
	}, [leave, router, manifest.id]);

	// 結果のあと、時間がたってルームが閉じたら、ロビーへ戻す（ロビーに「前のルームは、閉じられました」が
	// 出る / issue-70）。閉じる判断はサーバーが持ち、画面は通知を受けて動くだけ。
	useEffect(() => {
		if (expired) router.push(lobbyPathOf(manifest.id));
	}, [expired, router, manifest.id]);

	const connecting = isRealtime && realtime === null;
	// 観戦ルームの観戦者（issue-67）は、結果のあとも同じルームで次の試合を見るので、結果の画面に
	// 替えない（ゲームの画面が、結果と次の試合までの残りを出す）。退出は、いつでもできる。
	const spectating =
		realtime !== null && isSpectatorIn(realtime.you, realtime.players);
	const shownResult = spectating ? null : result;
	const view = resultView(manifest, shownResult);
	const fullscreen = isFullscreenGame(manifest.id);
	// 画面いっぱいの枠では、文字だけの表示（接続中など）を、ゲームの中身の場所の中央に置く。
	const statusBox = (node: ReactNode) =>
		fullscreen ? (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
				{node}
			</div>
		) : (
			node
		);

	const game = (
		<VirtualPadProvider>
			<LaunchGate manifest={manifest} launched={launched} onStart={start}>
				{Game === null ? (
					statusBox(
						<p className="text-slate-400">
							このゲームはまだ起動できません（本体が未登録）。
						</p>,
					)
				) : connecting && failed ? (
					statusBox(
						<ConnectionFailed
							onRetry={retry}
							onLobby={isRealtimeMatch(manifest.id) ? toLobby : undefined}
							onSelect={backToSelect}
						/>,
					)
				) : connecting && notice !== null ? (
					statusBox(
						<div
							className="flex flex-col items-center gap-3"
							data-testid="room-error"
							data-code={notice.code}
						>
							<p className="text-red-200 text-sm">{notice.text}</p>
							{/* ルームを作れないときは、ひとり用のゲームへの導線（issue-60）。 */}
							{notice.actions.includes("solo") ? (
								<SoloGameLinks games={soloGames(registry)} />
							) : null}
							<Link
								href={lobbyPathOf(manifest.id)}
								className="text-indigo-400 text-sm underline"
							>
								ロビーへ
							</Link>
						</div>,
					)
				) : connecting ? (
					statusBox(<p className="text-slate-400">ルームに接続中...</p>)
				) : (
					<Suspense
						fallback={statusBox(
							<p className="text-slate-400">読み込み中...</p>,
						)}
					>
						<Game key={playKey} />
					</Suspense>
				)}
			</LaunchGate>
		</VirtualPadProvider>
	);

	if (fullscreen) {
		// 画面いっぱいの 1 枚（GameFrame.tsx）。退出とゲーム選択へ戻るは、上部バーのメニューに置く。
		return (
			<GameHostProvider value={host}>
				<GameFrame
					manifest={manifest}
					roomName={roomName}
					onLeave={
						isRealtime && realtime !== null && shownResult === null
							? leaveRoom
							: null
					}
					onBackToSelect={backToSelect}
					spectating={spectating}
				>
					{view === "instead-of-game" && shownResult !== null ? (
						<ResultScreen
							result={shownResult}
							you={you}
							onLeave={leaveRoom}
							game={manifest}
							closesAt={closesAt}
							fill
						/>
					) : (
						game
					)}
				</GameFrame>
			</GameHostProvider>
		);
	}

	return (
		<GameHostProvider value={host}>
			<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-8 px-6 py-12">
				{launched && (
					<h1
						className="flex items-center gap-3 font-bold text-2xl text-white"
						data-testid="play-title"
						data-game={manifest.id}
					>
						<GameLogo manifest={manifest} size={32} />
						{displayName(manifest)}
					</h1>
				)}

				{view === "instead-of-game" && shownResult !== null ? (
					<ResultScreen
						result={shownResult}
						you={you}
						onLeave={leaveRoom}
						game={manifest}
						closesAt={closesAt}
					/>
				) : (
					game
				)}

				{view === "below-game" && shownResult !== null && (
					<ResultScreen
						result={shownResult}
						you={you}
						onLeave={leaveRoom}
						game={manifest}
						closesAt={closesAt}
					/>
				)}

				{isRealtime && realtime !== null && shownResult === null && (
					<div className="flex flex-col items-center gap-2">
						{roomName !== null && <RoomNameLabel name={roomName} />}
						<button
							type="button"
							onClick={leaveRoom}
							className="rounded-xl bg-slate-700 px-4 py-3 font-medium text-white transition-transform active:scale-[0.98]"
						>
							退出する
						</button>
					</div>
				)}

				{isRealtime ? (
					<button
						type="button"
						onClick={backToSelect}
						className="text-indigo-400 text-sm underline"
					>
						ゲーム選択へ戻る
					</button>
				) : (
					<Link href="/select" className="text-indigo-400 text-sm underline">
						ゲーム選択へ戻る
					</Link>
				)}
			</main>

			{soloResult !== null && (
				<div className="fixed inset-0 flex items-center justify-center bg-black/70 px-6">
					<div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-slate-800 p-6">
						<h2 className="font-bold text-white text-xl">おしまい</h2>
						<p className="text-slate-300">スコア {soloResult.score}</p>
						<button
							type="button"
							onClick={replay}
							className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white"
						>
							もう一度遊ぶ
						</button>
						<Link href="/select" className="text-indigo-400 text-sm underline">
							ゲーム選択へ戻る
						</Link>
					</div>
				</div>
			)}
		</GameHostProvider>
	);
}
