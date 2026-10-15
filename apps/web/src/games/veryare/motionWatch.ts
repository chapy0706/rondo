/**
 * 体の動きの見張り（ウォッチドッグ）。動きが止まる不具合を、自動で見つける。three を使わない純粋な関数。
 *
 * 体ごとに毎フレーム、いまの状態・再生の時間・骨の回転を受け取り、動きの再生中（待機・歩く・走る）なのに
 * - 再生の時間が STALL_SECONDS のあいだ進んでいない（time）
 * - 骨の回転が STALL_SECONDS のあいだ BONE_EPSILON より変わっていない（bones）
 * - 時間か骨の回転に、NaN や無限大がある（invalid）
 * のとき、止まりとして記録する。止まっている間は1件だけで、回復してから、また止まれば、もう1件。
 *
 * 時間は、描画の dt を足した時計（clock・秒）で数える（タブの裏で描画が間引かれても、止まりにしない）。
 * 記録の時刻（at）は、描画の時刻（ミリ秒）。
 *
 * 作るのは、テスト用の口（NEXT_PUBLIC_RONDO_TEST_HOOKS）か、開発用の合図（NEXT_PUBLIC_VERYARE_HIRAYA・
 * ?roof=1）のときだけ（Veryare.tsx）。本番の既定では作らない。
 */

import { traceEnabled } from "./assetTrace";

/** 止まりとみなす時間（秒）。 */
export const STALL_SECONDS = 0.5;
/**
 * 骨の回転が変わったとみなす差（四元数の成分の差の最大）。手元の待機の動き（素材）は、どの 0.5 秒でも
 * 0.0025 以上変わる（motionAssetFile.test.ts で確かめる）ので、その 1/5。
 */
export const BONE_EPSILON = 0.0005;
/** 記録を持つ上限（古いものから捨てる）。 */
export const MAX_STALLS = 100;
/** 時計の足し算の誤差の分だけ、しきい値をゆるめる。 */
const CLOCK_SLACK = 1e-6;

export type StallReason = "time" | "bones" | "invalid";

/** 止まりの記録。 */
export interface Stall {
	/** 体の名前（motionRegistry.ts の登録の名前）。 */
	readonly body: string;
	/** そのときの状態（idle・walk・run）。 */
	readonly state: string;
	/** 記録した描画の時刻（ミリ秒）。 */
	readonly at: number;
	readonly reason: StallReason;
}

/** 体1つの、1フレームの値。 */
export interface WatchFrame {
	readonly body: string;
	/** idle・walk・run・pose:<識別子>。 */
	readonly state: string;
	/** 動きの再生中か（動きの素材があり、状態が待機・歩く・走る）。 */
	readonly animated: boolean;
	/** いまの状態の動きの再生の時間（秒）。無ければ null。 */
	readonly clipTime: number | null;
	/** 骨の回転（四元数を並べたもの）。 */
	readonly bones: readonly number[];
}

export interface MotionWatch {
	observe(
		frame: WatchFrame,
		time: { readonly clock: number; readonly at: number },
	): void;
	/** 止まりの記録（古い順。写しを凍らせて返す）。 */
	stalls(): readonly Stall[];
	/** 体を消したとき。その体の数えを捨てる（記録は残す）。 */
	forget(body: string): void;
}

interface Track {
	state: string;
	clipTime: number | null;
	timeSince: number;
	bones: readonly number[];
	bonesSince: number;
	flagged: Set<StallReason>;
}

function finite(frame: WatchFrame): boolean {
	if (frame.clipTime !== null && !Number.isFinite(frame.clipTime)) return false;
	return frame.bones.every((value) => Number.isFinite(value));
}

function maxDiff(a: readonly number[], b: readonly number[]): number {
	if (a.length !== b.length) return Number.POSITIVE_INFINITY;
	let max = 0;
	for (let i = 0; i < a.length; i++) {
		max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
	}
	return max;
}

/** 見張りを作る。onStall は記録のたびに呼ぶ（開発中の Console に出す）。 */
export function createMotionWatch(
	onStall?: (stall: Stall) => void,
): MotionWatch {
	const tracks = new Map<string, Track>();
	const records: Stall[] = [];
	const record = (
		frame: WatchFrame,
		track: Track,
		reason: StallReason,
		at: number,
	) => {
		if (track.flagged.has(reason)) return;
		track.flagged.add(reason);
		const stall = Object.freeze({
			body: frame.body,
			state: frame.state,
			at,
			reason,
		});
		records.push(stall);
		if (records.length > MAX_STALLS) records.shift();
		onStall?.(stall);
	};

	return {
		observe(frame, { clock, at }) {
			let track = tracks.get(frame.body);
			if (track === undefined || track.state !== frame.state) {
				track = {
					state: frame.state,
					clipTime: frame.clipTime,
					timeSince: clock,
					bones: [...frame.bones],
					bonesSince: clock,
					flagged: new Set(),
				};
				tracks.set(frame.body, track);
			}
			if (!finite(frame)) {
				record(frame, track, "invalid", at);
				return;
			}
			track.flagged.delete("invalid");
			if (!frame.animated) {
				track.clipTime = frame.clipTime;
				track.timeSince = clock;
				track.bones = [...frame.bones];
				track.bonesSince = clock;
				track.flagged.clear();
				return;
			}
			if (frame.clipTime !== track.clipTime) {
				track.clipTime = frame.clipTime;
				track.timeSince = clock;
				track.flagged.delete("time");
			} else if (clock - track.timeSince >= STALL_SECONDS - CLOCK_SLACK) {
				record(frame, track, "time", at);
			}
			if (maxDiff(frame.bones, track.bones) > BONE_EPSILON) {
				track.bones = [...frame.bones];
				track.bonesSince = clock;
				track.flagged.delete("bones");
			} else if (clock - track.bonesSince >= STALL_SECONDS - CLOCK_SLACK) {
				record(frame, track, "bones", at);
			}
		},
		stalls: () => Object.freeze([...records]),
		forget(body) {
			tracks.delete(body);
		},
	};
}

/**
 * 見張りを作るか。テスト用の口（NEXT_PUBLIC_RONDO_TEST_HOOKS）が有効なときと、開発用の合図
 * （NEXT_PUBLIC_VERYARE_HIRAYA か ?roof=1 / assetTrace.ts の traceEnabled）のときだけ。
 */
export function motionWatchEnabled(options: {
	readonly testHooks: boolean;
	readonly dev: boolean;
	readonly search: string;
}): boolean {
	return options.testHooks || traceEnabled(options.dev, options.search);
}

const REASON_LABELS: Record<StallReason, string> = {
	time: "再生の時間が進まない",
	bones: "骨の回転が変わらない",
	invalid: "NaN か無限大",
};

/** 開発中の Console に出す、止まりの1行。 */
export function stallLogMessage(stall: Stall): string {
	return `[veryare-motion] 止まり: ${stall.body}・${stall.state}・${REASON_LABELS[stall.reason]}（${Math.floor(stall.at)} ms）`;
}
