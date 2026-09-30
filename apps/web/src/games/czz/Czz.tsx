"use client";

/**
 * czz 本体（ソロゲーム / ADR 0004）。起動画面は czz 自身が持つ（launchScreen: custom / issue-21）。
 *
 * 画面は 起動画面 → 出題（3問）→ 結果 と、起動画面から開くクレジットの4つで、ルートは
 * 持たずにここで切り替える。結果画面の「おわる」で useSoloGame の reportResult を呼び、
 * 基盤の結果表示へ繋ぐ。本家の BGM・効果音・マスコットは初心者モードで出し、設定は
 * メモリ上だけで持つ（ADR 0019）。通信・DB・認証は持たない。
 */

import type { PlayResult } from "@rondo/contracts";
import { useSoloGame } from "@rondo/game-sdk";
import { useCallback, useState } from "react";
import { type SfxName, useBgm, useSfx } from "./audio/useCzzAudio";
import type { CzzTask } from "./core/task";
import { czzTasks } from "./data/tasks";
import { czzManifest } from "./manifest";
import {
	type Screen,
	type UiMode,
	bgmFor,
	pickManualUrl,
} from "./presentation";
import { TASKS_PER_SESSION, eligibleTasks, pickTasks } from "./session";
import { Credits } from "./ui/Credits";
import { Play } from "./ui/Play";
import { SessionResult } from "./ui/SessionResult";
import { type AudioSettings, TitleScreen } from "./ui/TitleScreen";
import { T, themeStyle } from "./ui/theme";

/** マニュアルの URL は環境変数から受け取る（未設定・不正ならリンクを出さない）。 */
const MANUAL_URL = pickManualUrl(process.env.NEXT_PUBLIC_CZZ_MANUAL_URL);

export default function Czz() {
	const { reportResult } = useSoloGame(czzManifest);

	const [screen, setScreen] = useState<Screen>("title");
	// 発表会の想定（IT 初心者が大半）に合わせ、初心者モードで始める。
	const [mode, setMode] = useState<UiMode>("beginner");
	const [audio, setAudio] = useState<AudioSettings>({
		bgmEnabled: true,
		sfxEnabled: true,
	});
	const [tasks, setTasks] = useState<readonly CzzTask[]>([]);
	const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
	const [result, setResult] = useState<PlayResult | null>(null);

	useBgm(bgmFor(screen, currentTaskId, { mode, ...audio }));
	const playSfx = useSfx({ mode, sfxEnabled: audio.sfxEnabled });

	const start = () => {
		playSfx("start");
		// タップの後に選ぶので、サーバー描画との食い違いは起きない。
		setTasks(
			pickTasks(eligibleTasks(czzTasks), TASKS_PER_SESSION, Math.random),
		);
		setResult(null);
		setScreen("play");
	};

	const onTaskChange = useCallback((task: CzzTask) => {
		setCurrentTaskId(task.id);
	}, []);

	const onGraded = useCallback(
		(passed: boolean) => playSfx((passed ? "ok" : "ng") satisfies SfxName),
		[playSfx],
	);

	const onFinish = useCallback((finished: PlayResult) => {
		setResult(finished);
		setScreen("result");
	}, []);

	return (
		<div
			style={themeStyle(mode)}
			className={`w-full px-4 ${T.radius} ${T.fg}`}
			data-czz-mode={mode}
		>
			{screen === "title" ? (
				<TitleScreen
					mode={mode}
					audio={audio}
					manualUrl={MANUAL_URL}
					onModeChange={setMode}
					onAudioChange={setAudio}
					onStart={start}
					onCredits={() => setScreen("credits")}
				/>
			) : null}

			{screen === "credits" ? (
				<Credits onBack={() => setScreen("title")} />
			) : null}

			{screen === "play" ? (
				<Play
					tasks={tasks}
					mode={mode}
					onTaskChange={onTaskChange}
					onGraded={onGraded}
					onFinish={onFinish}
				/>
			) : null}

			{screen === "result" && result !== null ? (
				<SessionResult result={result} onDone={() => reportResult(result)} />
			) : null}
		</div>
	);
}
