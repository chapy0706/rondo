"use client";

/**
 * ルーム・ロビー。ルーム一覧の表示と、参加・新規作成を行う（ADR 0016）。
 *
 * 通信の詳細は useRealtimeLobby（と WebSocketAdapter / Mock）に閉じ込め、ここは
 * 表示と操作だけを受け持つ。既定ではモックが動くため、サーバーなしでも一覧・参加・
 * 作成を確かめられる。参加後のゲーム描画・進行は issue-12 で差し込む。
 */

import type { GameType } from "@rondo/contracts";
import Link from "next/link";
import { useRealtimeLobby } from "./useRealtimeLobby";

export function Lobby({ gameType }: { gameType: GameType }) {
	const { rooms, joined, error, createRoom, joinRoom, leaveRoom, refresh } =
		useRealtimeLobby(gameType);

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-16">
			<header className="flex flex-col gap-1">
				<h1 className="font-bold text-3xl text-white">ロビー</h1>
				<p className="text-slate-400 text-sm">{gameType}</p>
			</header>

			{error !== null && (
				<p className="rounded-lg bg-red-950 px-4 py-3 text-red-200 text-sm">
					{error}
				</p>
			)}

			{joined !== null ? (
				<section className="flex flex-col gap-4">
					<div className="rounded-2xl bg-slate-800 p-4">
						<h2 className="font-semibold text-lg text-white">参加中のルーム</h2>
						<p className="text-slate-400 text-sm">{joined.roomId}</p>
						<ul className="mt-3 flex flex-col gap-1">
							{joined.players.map((player) => (
								<li key={player.playerId} className="text-slate-200 text-sm">
									{player.name}
									{player.playerId === joined.you && (
										<span className="ml-2 text-indigo-400 text-xs">あなた</span>
									)}
								</li>
							))}
						</ul>
					</div>
					<p className="text-slate-500 text-sm">
						ゲーム本体はここに差し込まれる（issue-12）。
					</p>
					<button
						type="button"
						onClick={leaveRoom}
						className="rounded-xl bg-slate-700 px-4 py-3 font-medium text-white transition-transform active:scale-[0.98]"
					>
						退出する
					</button>
				</section>
			) : (
				<section className="flex flex-col gap-4">
					<div className="flex items-center justify-between">
						<h2 className="font-semibold text-lg text-white">ルーム一覧</h2>
						<button
							type="button"
							onClick={refresh}
							className="text-indigo-400 text-sm underline"
						>
							更新
						</button>
					</div>

					{rooms.length === 0 ? (
						<p className="text-slate-400 text-sm">
							空いているルームがありません。新しく作りましょう。
						</p>
					) : (
						<ul className="flex flex-col gap-3">
							{rooms.map((room) => {
								const full = room.playerCount >= room.capacity;
								return (
									<li key={room.roomId}>
										<button
											type="button"
											onClick={() => joinRoom(room.roomId)}
											disabled={full || room.status === "playing"}
											className="flex w-full items-center justify-between rounded-2xl bg-slate-800 px-4 py-3 text-left transition-transform active:scale-[0.98] disabled:opacity-50"
										>
											<span className="font-medium text-white">
												{room.roomId}
											</span>
											<span className="text-slate-400 text-sm">
												{room.playerCount}/{room.capacity}
												{room.status === "playing" && " ・進行中"}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}

					<button
						type="button"
						onClick={createRoom}
						className="rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition-transform active:scale-[0.98]"
					>
						新しいルームを作る
					</button>
				</section>
			)}

			<Link href="/select" className="text-indigo-400 text-sm underline">
				ゲーム選択へ戻る
			</Link>
		</main>
	);
}
