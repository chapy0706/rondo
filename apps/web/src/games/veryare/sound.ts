/**
 * veryare の音を鳴らす条件（issue-63）。クライアントがすでに持っている状態の変化だけから決める
 * （サーバーに、音のための通知は足さない）。純粋関数と、Veryare.tsx・SpectateView.tsx が呼ぶ
 * 薄いフック（useVeryareSound・useSpectateSound）を、ここにまとめる。
 *
 * | 音 | 条件 | 聞かせる相手 |
 * | --- | --- | --- |
 * | BGM | 鬼選出は top、準備移動から答え合わせは game、終了は無音 | 全員（観戦者を含む） |
 * | start | カウントを見ていて、鬼選出から準備移動に移ったとき | 全員（観戦者を含む） |
 * | count | 鬼選出でエリアが counting の間。取り消し（counting でなくなる）で止める | 遊ぶ人 |
 * | hit | 撃ってから 0.5 秒の窓の中で、狙った人が隠れ中の一覧から消えた / 自分が一覧から消えた | 撃った本人 / 見つかった本人 |
 * | miss | 窓が当たりなく過ぎた | 撃った本人 |
 * | paint | 自分の体を塗っている間 | 自分 |
 *
 * 音は見た目の補助で、ゲームの進行や判定に影響しない。音の呼び出しは soundHub が try/catch で囲み、
 * 旗（SOUND_READY・?sound=1）が無ければ何もしない。
 */

import { useCallback, useEffect, useRef } from "react";
import { type SoundHandle, soundHub } from "../../platform/sound/hub";
import type { BgmKey } from "../../platform/sound/keys";
import { type PhaseClock, remainingOf } from "./phaseClock";
import {
	type AreaState,
	type Phase,
	type PhaseNotice,
	foundByShot,
} from "./rules";

/** 撃ってから、当たりと外れを決めるまでの窓（外れの理由の推定の結果の見方と同じ 0.5 秒）。 */
export const SHOT_RESULT_WINDOW_MS = 500;
/** count を「始まりに 1 回」で鳴らす、素材の長さの下限。短ければ、残り 1 秒ごとに鳴らす。 */
export const COUNT_ONCE_MIN_MS = 8000;
/** paint を「0.1 秒ごと」で鳴らす、素材の長さの上限（これ未満）。長ければ繰り返す。 */
export const PAINT_TICK_MAX_MS = 500;
export const PAINT_TICK_MS = 100;
/** 塗る音の再生の速さのばらつき（±）。 */
export const PAINT_RATE_SPREAD = 0.05;
/** 塗る音（繰り返し）を、指を離したときに小さくして止める長さ。 */
export const PAINT_FADE_MS = 150;
/** カウントを取り消したときに、小さくして止める長さ。 */
export const COUNT_STOP_FADE_MS = 50;

// --- 場面と BGM ---------------------------------------------------------------------

export function gameBgm(phase: Phase): BgmKey | null {
	switch (phase) {
		case "oni-selection":
			return "bgm-top";
		case "ended":
			return null;
		default:
			return "bgm-game";
	}
}

// --- count と start -----------------------------------------------------------------

export function countActive(phase: Phase, area: AreaState | null): boolean {
	return phase === "oni-selection" && area === "counting";
}

export type CountPlan =
	| { readonly kind: "none" }
	/** 1 回だけ。素材の offsetMs から、delayMs 待って鳴らす（素材の終わりがカウントの 0 にそろう）。 */
	| {
			readonly kind: "once";
			readonly offsetMs: number;
			readonly delayMs: number;
	  }
	/** 残り 1 秒ごと（今からの待ち時間の並び）。 */
	| { readonly kind: "ticks"; readonly delaysMs: readonly number[] };

/** カウントの鳴らし方。durationMs は素材の長さ（分からなければ null）、remainingMs はカウントの残り。 */
export function countPlan(
	durationMs: number | null,
	remainingMs: number,
): CountPlan {
	if (!Number.isFinite(remainingMs) || remainingMs <= 0)
		return { kind: "none" };
	if (durationMs !== null && durationMs >= COUNT_ONCE_MIN_MS) {
		return {
			kind: "once",
			offsetMs: Math.max(0, durationMs - remainingMs),
			delayMs: Math.max(0, remainingMs - durationMs),
		};
	}
	const delaysMs: number[] = [];
	for (let second = Math.floor(remainingMs / 1000); second >= 1; second--) {
		delaysMs.push(remainingMs - second * 1000);
	}
	return delaysMs.length === 0 ? { kind: "none" } : { kind: "ticks", delaysMs };
}

/** ゲームの開始の音を鳴らすか。prev は直前に見ていたフェーズとエリア（無ければ null）。 */
export function startSignal(
	prev: { readonly phase: Phase; readonly area: AreaState | null } | null,
	next: Phase,
): boolean {
	return (
		prev !== null &&
		countActive(prev.phase, prev.area) &&
		next === "preparation"
	);
}

// --- paint --------------------------------------------------------------------------

export type PaintPlan =
	| { readonly kind: "ticks"; readonly intervalMs: number }
	| { readonly kind: "loop"; readonly fadeMs: number };

/** 塗る音の鳴らし方。長さの分からない素材（開発中のビープ）は、繰り返しとして扱う（1 回だけ鳴る）。 */
export function paintPlan(durationMs: number | null): PaintPlan {
	if (durationMs !== null && durationMs < PAINT_TICK_MAX_MS) {
		return { kind: "ticks", intervalMs: PAINT_TICK_MS };
	}
	return { kind: "loop", fadeMs: PAINT_FADE_MS };
}

/** 再生の速さ（1 ± 5%）。random は 0 以上 1 未満。 */
export function paintRate(random: () => number): number {
	return 1 + (random() * 2 - 1) * PAINT_RATE_SPREAD;
}

// --- hit と miss --------------------------------------------------------------------

export interface ShotWindow {
	readonly target: string | null;
	/** 撃ったときの、隠れ中の一覧。 */
	readonly before: readonly string[] | null;
	readonly at: number;
}

export function openShot(
	target: string | null,
	before: readonly string[] | null,
	at: number,
): ShotWindow {
	return { target, before, at };
}

/** 窓の中で、狙った人が一覧から消えたか（当たり）。窓を過ぎた当たりでは鳴らさない。 */
export function shotHit(
	shot: ShotWindow | null,
	hidingNow: readonly string[],
	now: number,
): boolean {
	if (shot === null || now - shot.at > SHOT_RESULT_WINDOW_MS) return false;
	return foundByShot(shot.target, shot.before, hidingNow);
}

/** 窓が当たりなく過ぎたか（外れ）。 */
export function shotMissed(shot: ShotWindow | null, now: number): boolean {
	return shot !== null && now - shot.at >= SHOT_RESULT_WINDOW_MS;
}

/** 探索中に、隠れ中の一覧から自分が消えたか（見つかった本人の hit）。 */
export function foundSelf(
	phase: Phase,
	before: readonly string[] | null,
	after: readonly string[],
	you: string | null,
): boolean {
	if (phase !== "exploration" || before === null || you === null) return false;
	return before.includes(you) && !after.includes(you);
}

// --- フック -------------------------------------------------------------------------

function useGameBgm(phase: Phase): void {
	useEffect(() => {
		soundHub.setGameBgm(gameBgm(phase));
	}, [phase]);
	useEffect(() => () => soundHub.setGameBgm(undefined), []);
}

/** 鬼選出から準備移動に移ったときの start（遊ぶ人と観戦者で同じ）。 */
function useStartSignal(phase: Phase, area: AreaState | null): void {
	const prevRef = useRef<{ phase: Phase; area: AreaState | null } | null>(null);
	useEffect(() => {
		if (startSignal(prevRef.current, phase)) soundHub.play("se-start");
		prevRef.current = { phase, area };
	}, [phase, area]);
}

/** カウントの音。カウントの間だけ鳴らし、取り消し・画面を離れる・画面から戻るで止める（戻れば合わせ直す）。 */
function useCountSound(clock: PhaseClock): void {
	const phase = clock.notice?.phase ?? "oni-selection";
	const area = clock.notice?.area ?? null;
	const active = countActive(phase, area);
	const { receivedAt } = clock;
	const clockRef = useRef(clock);
	clockRef.current = clock;
	useEffect(() => {
		if (!active) return;
		const handles: SoundHandle[] = [];
		const timers: number[] = [];
		const stop = () => {
			for (const timer of timers) window.clearTimeout(timer);
			timers.length = 0;
			for (const handle of handles) handle.stop(COUNT_STOP_FADE_MS);
			handles.length = 0;
		};
		const begin = () => {
			stop();
			// 素材を読み込み中なら、このカウントは鳴らさない（長さが分からないまま、刻みで鳴らさない）。
			const duration = soundHub.durationMs("se-count");
			if (duration === undefined) return;
			const plan = countPlan(
				duration,
				remainingOf(
					{ notice: clockRef.current.notice, receivedAt },
					performance.now(),
				),
			);
			if (plan.kind === "once") {
				handles.push(
					soundHub.play("se-count", {
						offsetMs: plan.offsetMs,
						delayMs: plan.delayMs,
					}),
				);
			} else if (plan.kind === "ticks") {
				for (const delay of plan.delaysMs) {
					timers.push(
						window.setTimeout(() => {
							handles.push(soundHub.play("se-count"));
						}, delay),
					);
				}
			}
		};
		// 画面が隠れている間は音の時計が止まるので、戻ったら残りに合わせ直す。
		const onVisible = () => {
			if (document.visibilityState === "visible") begin();
			else stop();
		};
		begin();
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			stop();
		};
		// 送り直し（receivedAt が変わる）でも、残りに合わせ直す。
	}, [active, receivedAt]);
}

/**
 * 遊ぶ人の画面の音。返す shot は「撃つ」が受け付けられたとき、paint は塗っているか（自分の体の上で
 * 指が動いているか）が変わるたびに呼ぶ。
 */
export function useVeryareSound(input: {
	readonly clock: PhaseClock;
	readonly hiding: readonly string[] | null;
	readonly you: string | null;
}): {
	readonly shot: (target: string | null) => void;
	readonly paint: (active: boolean) => void;
} {
	const phase = input.clock.notice?.phase ?? "oni-selection";
	const area = input.clock.notice?.area ?? null;
	useGameBgm(phase);
	useStartSignal(phase, area);
	useCountSound(input.clock);

	// 当たりと外れ（撃った本人）、見つかった本人の当たり。
	const hidingRef = useRef(input.hiding);
	const shotRef = useRef<ShotWindow | null>(null);
	const missTimerRef = useRef<number | null>(null);
	useEffect(() => {
		const before = hidingRef.current;
		const after = input.hiding;
		hidingRef.current = after;
		if (after === null) return;
		const now = performance.now();
		if (shotHit(shotRef.current, after, now)) {
			shotRef.current = null;
			soundHub.play("se-hit");
		} else if (foundSelf(phase, before, after, input.you)) {
			soundHub.play("se-hit");
		}
	}, [input.hiding, input.you, phase]);
	const shot = useCallback((target: string | null) => {
		const at = performance.now();
		shotRef.current = openShot(target, hidingRef.current, at);
		if (missTimerRef.current !== null) {
			window.clearTimeout(missTimerRef.current);
		}
		missTimerRef.current = window.setTimeout(() => {
			missTimerRef.current = null;
			if (shotMissed(shotRef.current, performance.now())) {
				shotRef.current = null;
				soundHub.play("se-miss");
			}
		}, SHOT_RESULT_WINDOW_MS);
	}, []);

	// 塗る音（自分にだけ）。
	const paintRef = useRef<{ stop: () => void } | null>(null);
	const paint = useCallback((active: boolean) => {
		if (!active) {
			paintRef.current?.stop();
			paintRef.current = null;
			return;
		}
		if (paintRef.current !== null) return;
		const plan = paintPlan(soundHub.durationMs("se-paint") ?? null);
		if (plan.kind === "loop") {
			const handle = soundHub.loop("se-paint");
			paintRef.current = { stop: () => handle.stop(plan.fadeMs) };
			return;
		}
		const tick = () => {
			soundHub.play("se-paint", { rate: paintRate(Math.random) });
		};
		tick();
		const timer = window.setInterval(tick, plan.intervalMs);
		paintRef.current = { stop: () => window.clearInterval(timer) };
	}, []);
	// ペイントのフェーズを出たら、塗る音を止める。
	useEffect(() => {
		if (phase !== "painting") paint(false);
	}, [phase, paint]);
	useEffect(
		() => () => {
			paint(false);
			if (missTimerRef.current !== null) {
				window.clearTimeout(missTimerRef.current);
			}
		},
		[paint],
	);

	return { shot, paint };
}

/** 観戦者（観戦ルーム）の画面の音: BGM と start だけ。 */
export function useSpectateSound(notice: PhaseNotice | null): void {
	const phase = notice?.phase ?? "oni-selection";
	const area = notice?.area ?? null;
	useGameBgm(phase);
	useStartSignal(phase, area);
}
