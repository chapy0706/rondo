import { describe, expect, it } from "vitest";
import {
	BONE_EPSILON,
	MAX_STALLS,
	STALL_SECONDS,
	type WatchFrame,
	createMotionWatch,
	motionWatchEnabled,
	stallLogMessage,
} from "./motionWatch";

const DT = 1 / 60;

/** 動きの再生中の1コマ。clipTime と bones は、呼び出し側が変える。 */
const frame = (
	clipTime: number | null,
	bones: readonly number[],
	options: Partial<WatchFrame> = {},
): WatchFrame => ({
	body: "鬼",
	state: "walk",
	animated: true,
	clipTime,
	bones,
	...options,
});

/** frames コマ見せる。make(i) がそのコマの値。clock は秒、at はミリ秒。 */
function feed(
	watch: ReturnType<typeof createMotionWatch>,
	frames: number,
	make: (i: number) => WatchFrame,
	start = 0,
): number {
	let i = start;
	for (; i < start + frames; i++) {
		watch.observe(make(i), { clock: i * DT, at: 1000 + i * DT * 1000 });
	}
	return i;
}

describe("定数（見張りのしきい値）", () => {
	it("止まりとみなす時間は 0.5 秒。骨の回転のしきい値は、待機の細かい動きより十分小さい", () => {
		expect(STALL_SECONDS).toBe(0.5);
		// 手元の待機の動き（素材）は、どの 0.5 秒でも、四元数の成分が 0.0025 以上変わる（motionAssetFile.test.ts）。
		expect(BONE_EPSILON).toBeLessThanOrEqual(0.0025 / 4);
		expect(BONE_EPSILON).toBeGreaterThan(0);
	});
});

describe("createMotionWatch - 止まりを見つけて記録する", () => {
	it("再生の時間と骨の回転が進んでいれば、記録しない", () => {
		const watch = createMotionWatch();
		feed(watch, 600, (i) => frame(i * DT, [Math.sin(i * 0.1), 0, 0, 1]));
		expect(watch.stalls()).toEqual([]);
	});

	it("待機の細かい動き（0.5 秒で 0.0025 ほど）は、止まりにしない", () => {
		const watch = createMotionWatch();
		// 0.5 秒（30 コマ）で、成分が 0.0025 変わる、ゆっくりした揺れ。
		feed(watch, 600, (i) =>
			frame(i * DT, [0.0025 * (i / 30), 0, 0, 1], { state: "idle" }),
		);
		expect(watch.stalls()).toEqual([]);
	});

	it("再生の時間が 0.5 秒進まないと「time」を1件だけ記録する（体の名前・状態・時刻つき）", () => {
		const watch = createMotionWatch();
		const i = feed(watch, 10, (i) => frame(i * DT, [i * 0.01, 0, 0, 1]));
		feed(watch, 120, (j) => frame(0.2, [j * 0.01, 0, 0, 1]), i);
		const stalls = watch.stalls();
		expect(stalls).toHaveLength(1);
		expect(stalls[0]).toMatchObject({
			body: "鬼",
			state: "walk",
			reason: "time",
		});
		// 止まり始め（時間が最後に変わった 10 コマ目）から 0.5 秒たったコマで記録する。
		expect(stalls[0]?.at).toBeCloseTo(1000 + (10 + 30) * DT * 1000, 3);
	});

	it("骨の回転が 0.5 秒変わらないと「bones」を記録する（時間は進んでいても）", () => {
		const watch = createMotionWatch();
		feed(watch, 120, (i) => frame(i * DT, [0.1, 0.2, 0.3, 0.9]));
		expect(watch.stalls().map((s) => s.reason)).toEqual(["bones"]);
	});

	it("回復してから、もう一度止まれば、もう1件記録する", () => {
		const watch = createMotionWatch();
		let i = feed(watch, 60, () => frame(0, [0, 0, 0, 1]));
		i = feed(watch, 60, (j) => frame(j * DT, [j * 0.01, 0, 0, 1]), i);
		feed(watch, 60, () => frame(5, [0, 0, 0, 1]), i);
		expect(watch.stalls().map((s) => s.reason)).toEqual([
			"time",
			"bones",
			"time",
			"bones",
		]);
	});

	it("NaN や無限大があれば「invalid」を記録する", () => {
		const watch = createMotionWatch();
		feed(watch, 3, (i) => frame(i * DT, [Number.NaN, 0, 0, 1]));
		// 数に戻ったら回復。また壊れれば、もう1件。
		feed(watch, 1, (i) => frame(i * DT, [0, 0, 0, 1]), 3);
		feed(watch, 3, () => frame(Number.POSITIVE_INFINITY, [0, 0, 0, 1]), 100);
		expect(watch.stalls().map((s) => s.reason)).toEqual(["invalid", "invalid"]);
	});

	it("動きの再生中でない（ポーズ・静止した姿勢・動きの素材なし）なら、止まっていても記録しない", () => {
		const watch = createMotionWatch();
		feed(watch, 120, () =>
			frame(0, [0, 0, 0, 1], { state: "pose:idle", animated: false }),
		);
		expect(watch.stalls()).toEqual([]);
	});

	it("状態が変わったら、数え直す（変わった直後を止まりにしない）", () => {
		const watch = createMotionWatch();
		const states = ["idle", "walk", "run"];
		// 0.4 秒ごとに状態が変わり、そのたびに時間と骨が別の値で止まる（0.5 秒には届かない）。
		feed(watch, 600, (i) => {
			const k = Math.floor((i * DT) / 0.4);
			return frame(k, [k, 0, 0, 1], { state: states[k % 3] as string });
		});
		expect(watch.stalls()).toEqual([]);
	});

	it("体ごとに別に数える。忘れた体（消した体）は、また最初から", () => {
		const watch = createMotionWatch();
		feed(watch, 120, (i) =>
			i % 2 === 0
				? frame(i * DT, [i * 0.01, 0, 0, 1], { body: "a" })
				: frame(0, [0, 0, 0, 1], { body: "b" }),
		);
		expect(watch.stalls().map((s) => s.body)).toEqual(["b", "b"]);
		watch.forget("b");
		expect(watch.stalls()).toHaveLength(2);
	});

	it(`記録は ${MAX_STALLS} 件まで（古いものから捨てる）。記録のたびに知らせる`, () => {
		const seen: string[] = [];
		const watch = createMotionWatch((stall) => seen.push(stall.body));
		for (let n = 0; n < MAX_STALLS + 5; n++) {
			feed(watch, 2, () => frame(0, [Number.NaN], { body: `b${n}` }), n * 10);
		}
		expect(watch.stalls()).toHaveLength(MAX_STALLS);
		expect(watch.stalls()[0]?.body).toBe("b5");
		expect(seen).toHaveLength(MAX_STALLS + 5);
	});

	it("返す一覧は写しで、書き換えられない", () => {
		const watch = createMotionWatch();
		feed(watch, 2, () => frame(0, [Number.NaN]));
		const list = watch.stalls();
		expect(Object.isFrozen(list)).toBe(true);
		expect(Object.isFrozen(list[0])).toBe(true);
	});
});

describe("motionWatchEnabled - 見張りを作るか", () => {
	it("テスト用の口が有効なときと、開発用の合図（開発用の変数か ?roof=1）のときだけ", () => {
		expect(
			motionWatchEnabled({ testHooks: true, dev: false, search: "" }),
		).toBe(true);
		expect(
			motionWatchEnabled({ testHooks: false, dev: true, search: "" }),
		).toBe(true);
		expect(
			motionWatchEnabled({ testHooks: false, dev: false, search: "?roof=1" }),
		).toBe(true);
	});

	it("本番の既定（どれも無い）では作らない", () => {
		expect(
			motionWatchEnabled({ testHooks: false, dev: false, search: "" }),
		).toBe(false);
		expect(
			motionWatchEnabled({ testHooks: false, dev: false, search: "?roof=0" }),
		).toBe(false);
	});
});

describe("stallLogMessage - 開発中の Console に出す、止まりの1行", () => {
	it("体の名前・状態・理由・時刻", () => {
		expect(
			stallLogMessage({
				body: "oni",
				state: "walk",
				at: 1234.5,
				reason: "time",
			}),
		).toBe(
			"[veryare-motion] 止まり: oni・walk・再生の時間が進まない（1234 ms）",
		);
		expect(
			stallLogMessage({ body: "self", state: "idle", at: 10, reason: "bones" }),
		).toBe(
			"[veryare-motion] 止まり: self・idle・骨の回転が変わらない（10 ms）",
		);
		expect(
			stallLogMessage({
				body: "self",
				state: "run",
				at: 10,
				reason: "invalid",
			}),
		).toBe("[veryare-motion] 止まり: self・run・NaN か無限大（10 ms）");
	});
});
