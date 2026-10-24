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
 * 運営の画面（URL に ?operator=1 / issue-67）では、観戦ルームを作るトグルを出し、観戦の行を押せる
 * （operator.ts）。来場者の画面には出さない。
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
import {
	hiddenRoomOptions,
	prefetchForLobby,
	ruleRoomOptions,
	spectateRoomOptions,
} from "../../games/registry";
import { GameLogo } from "../brand/GameLogo";
import { displayName } from "../brand/gameBrand";
import { ConnectionFailed } from "../session/ConnectionFailed";
import { LobbyNotice } from "./LobbyNotice";
import { RoomListItem } from "./RoomListItem";
import { isOperator, spectateSettingsToSend } from "./operator";
import { numberedRoomLabels, roomNameHint } from "./roomName";
import {
	choiceLabel,
	chooseOption,
	initialSettings,
	settingsToSend,
	visibleOptions,
} from "./roomOptions";
import { rulesEntryOn, rulesStorage, withRuleOptions } from "./rulesEntry";
import { spectateAllowed } from "./spectateFlag";
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
		notice,
		failed,
		retry,
		createRoom,
		joinRoom,
		refresh,
		reload,
	} = useRealtimeLobby(gameType);
	// 同じ名前のルームを見分けるため、一覧の順で (2)・(3) を付けて出す（画面だけ）。
	const labels = numberedRoomLabels(rooms);
	const [settings, setSettings] = useState(() => initialSettings(roomOptions));
	// 新しい規則の選択肢の入口（URL の ?rules=1 / rulesEntry.ts）。URL と端末の記憶は、マウントの後に読む
	// （サーバーの描画では出さない）。開いたら、足した選択肢の既定を、いまの選び方に足す。
	const [rulesOn, setRulesOn] = useState(false);
	useEffect(() => {
		const on = rulesEntryOn(window.location.search, rulesStorage());
		setRulesOn(on);
		if (on) {
			setSettings((current) => ({
				...initialSettings(ruleRoomOptions(gameType)),
				...current,
			}));
		}
	}, [gameType]);
	const options = rulesOn
		? withRuleOptions(roomOptions, ruleRoomOptions(gameType))
		: roomOptions;
	const [roomName, setRoomName] = useState("");
	// いまの選び方で出さない選択肢（平屋では CPU など）。何を出さないかは、ゲームの側が決める。
	const hidden = hiddenRoomOptions(gameType, settings);
	const nameHint = roomNameHint(roomName);
	// 運営の画面か（issue-67）。URL は、マウントの後に読む（実行時の判定。サーバーの描画では false）。
	const [operator, setOperator] = useState(false);
	useEffect(() => {
		setOperator(isOperator(window.location.search));
	}, []);
	const spectateOptions = spectateRoomOptions(gameType);
	const [spectateMode, setSpectateMode] = useState(false);
	const [spectateSettings, setSpectateSettings] = useState(() =>
		initialSettings(spectateOptions ?? []),
	);
	const spectateToggle = operator && spectateOptions !== null;
	const creatingSpectate = spectateToggle && spectateMode;
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

			{/* 入れない・作れないときの案内（issue-60）。文言は、エラーの種類から決める（サーバーの文は出さない）。 */}
			{notice !== null && (
				<LobbyNotice
					notice={notice}
					onRefresh={refresh}
					onReload={reload}
					onRetry={retry}
				/>
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
							{rooms.map((room, index) => (
								// 識別子は、画面に文字としては出さず、E2E が行を探す属性としてだけ持つ（issue-58）。
								<li key={room.roomId} data-room-id={room.roomId}>
									{/* 満員・プレイ中は、行が自分で押せない形にする（roomAvailability.ts）。 */}
									<RoomListItem
										room={room}
										label={labels[index]}
										onJoin={() => joinRoom(room.roomId)}
										disabled={waiting}
										canSpectate={operator || spectateAllowed()}
									/>
								</li>
							))}
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

					{spectateToggle ? (
						<label className="flex items-center justify-between gap-3 text-slate-300 text-sm">
							観戦ルームを作る（CPU だけの試合）
							<input
								type="checkbox"
								data-testid="lobby-spectate-toggle"
								checked={spectateMode}
								onChange={(event) => setSpectateMode(event.target.checked)}
								className="size-5"
							/>
						</label>
					) : null}

					{creatingSpectate
						? (spectateOptions ?? []).map((option) => (
								<label
									key={option.key}
									className="flex items-center justify-between gap-3 text-slate-300 text-sm"
								>
									{option.label}
									<select
										data-testid={`lobby-spectate-option-${option.key}`}
										value={spectateSettings[option.key] ?? option.default}
										onChange={(event) =>
											setSpectateSettings((current) =>
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
							))
						: null}

					{(creatingSpectate ? [] : visibleOptions(options, hidden)).map(
						(option) => (
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
						),
					)}

					<button
						type="button"
						data-testid="lobby-create-room"
						onClick={() =>
							createRoom(
								creatingSpectate
									? spectateSettingsToSend(
											spectateOptions ?? [],
											spectateSettings,
										)
									: options.length > 0
										? settingsToSend(options, settings, hidden)
										: undefined,
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
