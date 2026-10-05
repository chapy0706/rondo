"use client";

/**
 * ルーム・ロビー。ルーム一覧の表示と、参加・新規作成を行う（ADR 0016）。
 *
 * 通信の詳細は useRealtimeLobby（と WebSocketAdapter / Mock）に閉じ込め、ここは
 * 表示と操作だけを受け持つ。既定ではモックが動くため、サーバーなしでも一覧・参加・
 * 作成を確かめられる。参加できたら、そのゲームの画面へ移る（issue-40）。
 */

import type { GameType, RoomOption } from "@rondo/contracts";
import Link from "next/link";
import { useState } from "react";
import { choiceLabel, chooseOption, initialSettings } from "./roomOptions";
import { useRealtimeLobby } from "./useRealtimeLobby";

export function Lobby({
	gameType,
	roomOptions = [],
}: {
	gameType: GameType;
	/** ルーム作成時に選ぶ設定（マニフェストの宣言）。一覧には出さない（ADR 0024）。 */
	roomOptions?: readonly RoomOption[];
}) {
	const { rooms, entering, waiting, error, createRoom, joinRoom, refresh } =
		useRealtimeLobby(gameType);
	const [settings, setSettings] = useState(() => initialSettings(roomOptions));

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

			{entering ? (
				<p className="text-slate-400 text-sm">ゲーム画面へ移動中...</p>
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
											disabled={waiting || full || room.status === "playing"}
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

					{roomOptions.map((option) => (
						<label
							key={option.key}
							className="flex items-center justify-between gap-3 text-slate-300 text-sm"
						>
							{option.label}
							<select
								value={settings[option.key] ?? option.default}
								onChange={(event) =>
									setSettings((current) =>
										chooseOption(current, option, event.target.value),
									)
								}
								className="min-h-11 rounded-xl bg-slate-800 px-3 text-base text-white"
							>
								{option.choices.map((choice) => (
									<option key={choice} value={choice}>
										{choiceLabel(option, choice)}
									</option>
								))}
							</select>
						</label>
					))}

					<button
						type="button"
						onClick={() =>
							createRoom(roomOptions.length > 0 ? settings : undefined)
						}
						disabled={waiting}
						className="rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
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
