"use client";

/**
 * ルーム・ロビー。ルーム一覧の表示と、参加・新規作成を行う（ADR 0016）。
 *
 * 通信の詳細は useRealtimeLobby（と WebSocketAdapter / Mock）に閉じ込め、ここは
 * 表示と操作だけを受け持つ。既定ではモックが動くため、サーバーなしでも一覧・参加・
 * 作成を確かめられる。参加できたら、そのゲームの画面へ移る（issue-40）。
 * 開いた時点で、そのゲームの素材の先読みを始める（何を読むかはゲームの側 / issue-46）。
 * 一覧にはルーム名・人数・状態を出し、識別子は出さない。ルーム名は作るときに決められる
 * （issue-58）。名前は来場者の自由な入力なので、React の標準の表示（文字として出す）のままにする。
 */

import {
	type GameManifest,
	type GameType,
	ROOM_NAME_MAX_LENGTH,
	type RoomOption,
} from "@rondo/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { prefetchForLobby } from "../../games/registry";
import { GameLogo } from "../brand/GameLogo";
import { displayName } from "../brand/gameBrand";
import { ConnectionFailed } from "../session/ConnectionFailed";
import { RoomListItem } from "./RoomListItem";
import { roomNameHint } from "./roomName";
import { choiceLabel, chooseOption, initialSettings } from "./roomOptions";
import { useRealtimeLobby } from "./useRealtimeLobby";

export function Lobby({
	gameType,
	roomOptions = [],
	manifest,
}: {
	gameType: GameType;
	/** 見出しに出すゲーム（issue-69）。無ければ識別子を出す。 */
	manifest?: GameManifest;
	/** ルーム作成時に選ぶ設定（マニフェストの宣言）。一覧には出さない（ADR 0024）。 */
	roomOptions?: readonly RoomOption[];
}) {
	const router = useRouter();
	const {
		rooms,
		entering,
		waiting,
		error,
		failed,
		retry,
		createRoom,
		joinRoom,
		refresh,
	} = useRealtimeLobby(gameType);
	const [settings, setSettings] = useState(() => initialSettings(roomOptions));
	const [roomName, setRoomName] = useState("");
	const nameHint = roomNameHint(roomName);
	// ロビーを開いた時点で、そのゲームの素材の先読みを始める（issue-46）。ロビーを離れても止めない。
	useEffect(() => {
		prefetchForLobby(gameType);
	}, [gameType]);

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-16">
			<header className="flex flex-col gap-1">
				<h1 className="font-bold text-3xl text-white">ロビー</h1>
				<p
					className="flex items-center gap-2 text-slate-300 text-sm"
					data-testid="lobby-game"
					data-game={gameType}
				>
					{manifest !== undefined ? (
						<>
							<GameLogo manifest={manifest} size={24} />
							{displayName(manifest)}
						</>
					) : (
						gameType
					)}
				</p>
			</header>

			{error !== null && (
				<p className="rounded-lg bg-red-950 px-4 py-3 text-red-200 text-sm">
					{error}
				</p>
			)}

			{entering ? (
				<p className="text-slate-400 text-sm">ゲーム画面へ移動中...</p>
			) : failed ? (
				<ConnectionFailed
					onRetry={retry}
					onSelect={() => router.push("/select")}
				/>
			) : (
				<section className="flex flex-col gap-4">
					<div className="flex items-center justify-between">
						<h2
							data-testid="lobby-room-list"
							className="font-semibold text-lg text-white"
						>
							ルーム一覧
						</h2>
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
										<RoomListItem
											room={room}
											onJoin={() => joinRoom(room.roomId)}
											disabled={waiting || full || room.status === "playing"}
										/>
									</li>
								);
							})}
						</ul>
					)}

					<label className="flex flex-col gap-2 text-slate-300 text-sm">
						ルーム名
						<input
							type="text"
							data-testid="lobby-room-name"
							value={roomName}
							onChange={(event) => setRoomName(event.target.value)}
							placeholder="空欄なら「（あなたの名前）のルーム」"
							aria-describedby="room-name-hint"
							className="min-h-11 rounded-xl bg-slate-800 px-3 text-base text-white placeholder:text-slate-500"
						/>
						<span id="room-name-hint" className="text-slate-500 text-xs">
							{nameHint ?? `${ROOM_NAME_MAX_LENGTH} 文字まで`}
						</span>
					</label>

					{roomOptions.map((option) => (
						<label
							key={option.key}
							className="flex items-center justify-between gap-3 text-slate-300 text-sm"
						>
							{option.label}
							<select
								// E2E は、文言ではなく、選択肢の key で探す（lobby-option-cpu など）。
								data-testid={`lobby-option-${option.key}`}
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
						data-testid="lobby-create-room"
						onClick={() =>
							createRoom(
								roomOptions.length > 0 ? settings : undefined,
								roomName,
							)
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
