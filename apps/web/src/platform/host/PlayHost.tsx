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
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { findGameLoader, lobbyPathOf } from "../../games/registry";
import { LaunchGate } from "../launch/LaunchGate";
import { needsLaunchScreen } from "../launch/launch";
import { ResultScreen } from "../result/ResultScreen";
import { playEntry } from "../session/session";
import {
	getRealtimeSession,
	useSessionState,
} from "../session/useRealtimeSession";

interface RealtimeSession {
	readonly realtime: RealtimeHost | null;
	readonly result: RealtimeResult | null;
	readonly you: PlayerId | null;
	/** 部屋に入れなかったとき（参加・復帰の失敗）の文言。 */
	readonly error: string | null;
	readonly leave: () => void;
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
		const session = getRealtimeSession();
		const release = session.hold();
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
		return release;
	}, [gameType]);

	const room =
		gameType !== null && state.room?.gameType === gameType ? state.room : null;
	const roomId = room?.roomId ?? null;
	const you = room?.you ?? null;
	const realtime = useMemo<RealtimeHost | null>(
		() =>
			roomId === null || you === null
				? null
				: { port: getRealtimeSession().gamePort(roomId), roomId, you },
		[roomId, you],
	);

	const leave = useCallback(() => {
		// 退出でルームは解散する（ADR 0017）。
		getRealtimeSession().leave();
	}, []);

	const waiting = gameType !== null && playEntry(state, gameType) === "waiting";

	return {
		realtime,
		result: room === null ? null : state.result,
		you,
		error: room === null && !waiting ? state.error : null,
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
	const { realtime, result, you, error, leave } = useRealtimeSession(
		isRealtime && launched ? manifest.id : null,
	);

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

	const connecting = isRealtime && realtime === null;

	return (
		<GameHostProvider value={host}>
			<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-8 px-6 py-12">
				{launched && (
					<h1 className="font-bold text-2xl text-white">{manifest.title}</h1>
				)}

				<VirtualPadProvider>
					<LaunchGate manifest={manifest} launched={launched} onStart={start}>
						{Game === null ? (
							<p className="text-slate-400">
								このゲームはまだ起動できません（本体が未登録）。
							</p>
						) : connecting && error !== null ? (
							<div className="flex flex-col items-center gap-3">
								<p className="text-red-200 text-sm">{error}</p>
								<Link
									href={lobbyPathOf(manifest.id)}
									className="text-indigo-400 text-sm underline"
								>
									ロビーへ
								</Link>
							</div>
						) : connecting ? (
							<p className="text-slate-400">ルームに接続中...</p>
						) : (
							<Suspense
								fallback={<p className="text-slate-400">読み込み中...</p>}
							>
								<Game key={playKey} />
							</Suspense>
						)}
					</LaunchGate>
				</VirtualPadProvider>

				{result !== null && (
					<ResultScreen result={result} you={you} onLeave={leaveRoom} />
				)}

				{isRealtime && realtime !== null && result === null && (
					<button
						type="button"
						onClick={leaveRoom}
						className="rounded-xl bg-slate-700 px-4 py-3 font-medium text-white transition-transform active:scale-[0.98]"
					>
						退出する
					</button>
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
