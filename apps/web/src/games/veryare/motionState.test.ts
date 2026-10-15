import { describe, expect, it } from "vitest";
import {
	IDLE_TO_WALK,
	INITIAL_BODY_MOTION,
	INITIAL_MOTION,
	MOTION_FADE_SECONDS,
	type MotionState,
	RUN_RATE,
	RUN_TO_WALK,
	SPEED_SMOOTH_SECONDS,
	STILL_BEFORE_POSE_SECONDS,
	WALK_RATE,
	WALK_TO_IDLE,
	WALK_TO_RUN,
	motionLogMessage,
	nextGait,
	playbackRate,
	smoothSpeed,
	stepBodyMotion,
	stepMotion,
} from "./motionState";

describe("定数（issue-57。報告の値）", () => {
	it("しきい値・再生の速さの範囲・混ぜる時間・止まってからポーズまでの時間", () => {
		expect([IDLE_TO_WALK, WALK_TO_IDLE, WALK_TO_RUN, RUN_TO_WALK]).toEqual([
			0.3, 0.15, 2.8, 2.4,
		]);
		expect(WALK_RATE).toEqual({ min: 0.5, max: 1.8 });
		expect(RUN_RATE).toEqual({ min: 0.75, max: 1.2 });
		expect(MOTION_FADE_SECONDS).toBe(0.2);
		expect(STILL_BEFORE_POSE_SECONDS).toBe(0.3);
		expect(SPEED_SMOOTH_SECONDS).toBe(0.15);
	});
});

describe("nextGait - 速さから、待機・歩く・走る（ヒステリシスつき）", () => {
	it("上がるときは 0.3 m/秒で歩き、2.8 m/秒で走る", () => {
		expect(nextGait("idle", 0.29)).toBe("idle");
		expect(nextGait("idle", 0.3)).toBe("walk");
		expect(nextGait("walk", 2.79)).toBe("walk");
		expect(nextGait("walk", 2.8)).toBe("run");
		expect(nextGait("idle", 4.5)).toBe("run");
	});

	it("下がるときは 2.4 m/秒未満で歩き、0.15 m/秒未満で待機", () => {
		expect(nextGait("run", 2.4)).toBe("run");
		expect(nextGait("run", 2.39)).toBe("walk");
		expect(nextGait("walk", 0.15)).toBe("walk");
		expect(nextGait("walk", 0.149)).toBe("idle");
		expect(nextGait("run", 0)).toBe("idle");
	});

	it("しきい値の近くで速さが揺れても、ばたつかない", () => {
		let gait = nextGait("idle", 0.31);
		const states: string[] = [];
		for (const speed of [0.29, 0.31, 0.2, 0.28, 0.16, 0.3]) {
			gait = nextGait(gait, speed);
			states.push(gait);
		}
		expect(new Set(states)).toEqual(new Set(["walk"]));
		let fast = nextGait("walk", 2.81);
		for (const speed of [2.79, 2.6, 2.45, 2.8, 2.5])
			fast = nextGait(fast, speed);
		expect(fast).toBe("run");
	});
});

describe("playbackRate - 再生の速さ（実際の速さ ÷ 標準の速さ。範囲つき）", () => {
	const native = { walk: 1.48, run: 4.13 };

	it("待機はいつも 1 倍", () => {
		expect(playbackRate("idle", 0.1, native)).toBe(1);
	});

	it("歩く・走るは、速さに比例し、範囲で抑える", () => {
		expect(playbackRate("walk", 1.48, native)).toBeCloseTo(1, 9);
		expect(playbackRate("walk", 2.22, native)).toBeCloseTo(1.5, 9);
		expect(playbackRate("walk", 0.3, native)).toBe(0.5);
		expect(playbackRate("walk", 2.79, native)).toBe(1.8);
		expect(playbackRate("run", 4.13, native)).toBeCloseTo(1, 9);
		expect(playbackRate("run", 4.5, native)).toBeCloseTo(4.5 / 4.13, 9);
		expect(playbackRate("run", 2.5, native)).toBe(0.75);
		expect(playbackRate("run", 9, native)).toBe(1.2);
	});

	it("速さが速くなると、再生の速さも上がる", () => {
		expect(playbackRate("walk", 1.0, native)).toBeLessThan(
			playbackRate("walk", 1.6, native),
		);
	});
});

describe("smoothSpeed - 進んだ距離からの速さ（0.15 秒でならす）", () => {
	it("同じ速さで進み続けると、その速さに寄る（行き過ぎない）", () => {
		let speed = 0;
		for (let i = 0; i < 60; i++) speed = smoothSpeed(speed, 1.5 / 60, 1 / 60);
		expect(speed).toBeCloseTo(1.5, 3);
		expect(speed).toBeLessThanOrEqual(1.5 + 1e-9);
	});

	it("止まると 0 に寄る。時間が進まなければ変えない", () => {
		let speed = 2;
		for (let i = 0; i < 60; i++) speed = smoothSpeed(speed, 0, 1 / 60);
		expect(speed).toBeLessThan(0.01);
		expect(smoothSpeed(1.2, 0.5, 0)).toBe(1.2);
	});

	it("0.15 秒で、差の 95% 以上を追う", () => {
		const after = smoothSpeed(
			0,
			2 * SPEED_SMOOTH_SECONDS,
			SPEED_SMOOTH_SECONDS,
		);
		expect(after).toBeGreaterThanOrEqual(2 * 0.95);
	});
});

describe("stepMotion - 待機・歩く・走る・ポーズの切り替え（時間は dt で注入）", () => {
	const run = (
		state: MotionState,
		steps: {
			speed: number;
			dt: number;
			chosen?: string | null;
			fixed?: boolean;
		}[],
	) => {
		let s = state;
		const actions: string[] = [];
		for (const step of steps) {
			const next = stepMotion(s, {
				speed: step.speed,
				dt: step.dt,
				chosen: (step.chosen ?? null) as never,
				fixed: step.fixed ?? false,
			});
			s = next.state;
			actions.push(
				next.action.kind === "pose"
					? `pose:${next.action.pose}`
					: next.action.kind,
			);
		}
		return { state: s, actions };
	};

	it("ポーズを選んでいない人は、止まっていれば待機、動けば歩く・走る", () => {
		const { actions } = run(INITIAL_MOTION, [
			{ speed: 0, dt: 1 },
			{ speed: 1, dt: 0.1 },
			{ speed: 3, dt: 0.1 },
			{ speed: 0, dt: 0.1 },
		]);
		expect(actions).toEqual(["idle", "walk", "run", "idle"]);
	});

	it("動いている間は、ポーズを選んでいても、ポーズに移らない", () => {
		const { actions } = run(INITIAL_MOTION, [
			{ speed: 1, dt: 0.1, chosen: "maleCrouch" },
			{ speed: 1, dt: 1, chosen: "maleCrouch" },
			{ speed: 3, dt: 1, chosen: "maleCrouch" },
		]);
		expect(actions).toEqual(["walk", "walk", "run"]);
	});

	it("止まって 0.3 秒たつと、選んだポーズへ移る（それまでは待機）", () => {
		const { actions } = run(INITIAL_MOTION, [
			{ speed: 1, dt: 0.1, chosen: "maleCrouch" },
			{ speed: 0, dt: 0.1, chosen: "maleCrouch" },
			{ speed: 0, dt: 0.1, chosen: "maleCrouch" },
			{ speed: 0, dt: 0.15, chosen: "maleCrouch" },
		]);
		expect(actions).toEqual(["walk", "idle", "idle", "pose:maleCrouch"]);
	});

	it("動き出すと、ポーズから歩く・走るに戻る。また止まると、0.3 秒後にポーズ", () => {
		const { actions } = run(INITIAL_MOTION, [
			{ speed: 0, dt: 1, chosen: "maleCrouch" },
			{ speed: 1, dt: 0.1, chosen: "maleCrouch" },
			{ speed: 0, dt: 0.2, chosen: "maleCrouch" },
			{ speed: 0, dt: 0.2, chosen: "maleCrouch" },
		]);
		expect(actions).toEqual([
			"pose:maleCrouch",
			"walk",
			"idle",
			"pose:maleCrouch",
		]);
	});

	it("動いている間にボタンを押すと、選ぶポーズだけが変わる（体は歩くまま）", () => {
		const { actions } = run(INITIAL_MOTION, [
			{ speed: 1, dt: 0.1, chosen: "maleCrouch" },
			{ speed: 1, dt: 0.1, chosen: "femaleDance" },
			{ speed: 0, dt: 0.4, chosen: "femaleDance" },
		]);
		expect(actions).toEqual(["walk", "walk", "pose:femaleDance"]);
	});

	it("止まっているときにボタンを押すと、すぐに新しいポーズへ移る（0.3 秒を待たない）", () => {
		const { actions } = run(INITIAL_MOTION, [
			{ speed: 1, dt: 0.1 },
			{ speed: 0, dt: 0.05 },
			{ speed: 0, dt: 0.05, chosen: "maleCrouch" },
			{ speed: 0, dt: 0.05, chosen: "femaleDance" },
		]);
		expect(actions).toEqual([
			"walk",
			"idle",
			"pose:maleCrouch",
			"pose:femaleDance",
		]);
	});

	it("止まっている状態（ペイントフェーズ・確定のあと）は、動いていても、選んだポーズか idle のポーズ", () => {
		expect(
			run(INITIAL_MOTION, [
				{ speed: 2, dt: 0.1, chosen: "maleCrouch", fixed: true },
			]).actions,
		).toEqual(["pose:maleCrouch"]);
		expect(
			run(INITIAL_MOTION, [{ speed: 0, dt: 0.1, fixed: true }]).actions,
		).toEqual(["pose:idle"]);
	});
});

const SPEEDS = { walk: 1.5, run: 4.5 } as const;

/** 毎フレーム here を返す関数で、frames フレーム進める（dt は 16 ms）。 */
function run(
	from: typeof INITIAL_BODY_MOTION,
	frames: number,
	here: (i: number) => { x: number; z: number },
	options: { chosen?: "femaleDance" | null; fixed?: boolean } = {},
) {
	let state = from;
	let last = stepBodyMotion(state, {
		here: here(0),
		dt: 0.016,
		chosen: options.chosen ?? null,
		fixed: options.fixed ?? false,
		jumped: false,
		speeds: SPEEDS,
	});
	for (let i = 0; i < frames; i++) {
		last = stepBodyMotion(state, {
			here: here(i),
			dt: 0.016,
			chosen: options.chosen ?? null,
			fixed: options.fixed ?? false,
			jumped: false,
			speeds: SPEEDS,
		});
		state = last.state;
	}
	return last;
}

describe("stepBodyMotion - 位置の変化から、体の動きを決める（すべての体で同じ / issue-57）", () => {
	it("位置が速く変われば歩く、止まればポーズ（選んでいれば）か待機", () => {
		// 1 フレーム（16 ms）に 2 cm 進む ≒ 1.25 m/秒 → 歩く（ならしの後）。
		const walking = run(
			INITIAL_BODY_MOTION,
			30,
			(i) => ({ x: i * 0.02, z: 0 }),
			{
				chosen: "femaleDance",
			},
		);
		expect(walking.action).toEqual({ kind: "walk" });
		expect(walking.rate).toBeCloseTo(1.25 / SPEEDS.walk, 1);
		// 止まって STILL_BEFORE_POSE_SECONDS たてば、選んだポーズ。
		const frames = Math.ceil(STILL_BEFORE_POSE_SECONDS / 0.016) + 30;
		const posed = run(walking.state, frames, () => ({ x: 0.6, z: 0 }), {
			chosen: "femaleDance",
		});
		expect(posed.action).toEqual({ kind: "pose", pose: "femaleDance" });
		expect(posed.rate).toBe(1);
		// ポーズを選んでいなければ、待機の動き。
		const idle = run(posed.state, 1, () => ({ x: 0.6, z: 0 }));
		expect(idle.action).toEqual({ kind: "idle" });
	});

	it("走る速さ（3 m/秒以上）なら走る", () => {
		const step = run(INITIAL_BODY_MOTION, 30, (i) => ({ x: i * 0.06, z: 0 }));
		expect(step.action).toEqual({ kind: "run" });
	});

	it("最初のフレームと、空間が変わった直後（jumped）は、位置が飛んでも速さ 0", () => {
		const first = stepBodyMotion(INITIAL_BODY_MOTION, {
			here: { x: 50, z: 50 },
			dt: 0.016,
			chosen: null,
			fixed: false,
			jumped: false,
			speeds: SPEEDS,
		});
		expect(first.state.speed).toBe(0);
		const jumped = stepBodyMotion(first.state, {
			here: { x: -50, z: 0 },
			dt: 0.016,
			chosen: null,
			fixed: false,
			jumped: true,
			speeds: SPEEDS,
		});
		expect(jumped.state.speed).toBe(0);
		expect(jumped.action).toEqual({ kind: "idle" });
	});

	it("見えていない間（here が null）は、前の位置を忘れ、見え始めの一歩で速さを出さない", () => {
		const walking = run(INITIAL_BODY_MOTION, 30, (i) => ({
			x: i * 0.02,
			z: 0,
		}));
		const hidden = stepBodyMotion(walking.state, {
			here: null,
			dt: 0.016,
			chosen: null,
			fixed: false,
			jumped: false,
			speeds: SPEEDS,
		});
		expect(hidden.state.last).toBeNull();
		expect(hidden.state.speed).toBe(0);
		const back = stepBodyMotion(hidden.state, {
			here: { x: 30, z: 0 },
			dt: 0.016,
			chosen: null,
			fixed: false,
			jumped: false,
			speeds: SPEEDS,
		});
		expect(back.state.speed).toBe(0);
	});

	it("静止の指定（fixed）なら、動いていても選んだポーズ（なければ idle）", () => {
		const fixed = run(INITIAL_BODY_MOTION, 30, (i) => ({ x: i * 0.06, z: 0 }), {
			fixed: true,
		});
		expect(fixed.action).toEqual({ kind: "pose", pose: "idle" });
	});

	it("動きの素材が無い（speeds が null）なら、再生の速さは 1", () => {
		const step = stepBodyMotion(INITIAL_BODY_MOTION, {
			here: { x: 0, z: 0 },
			dt: 0.016,
			chosen: null,
			fixed: false,
			jumped: false,
			speeds: null,
		});
		expect(step.rate).toBe(1);
	});
});

describe("motionLogMessage - 開発中だけ Console に出す、体の動きの1行", () => {
	it("体の名前、状態、速さ、再生の速さと、重みの付いた動きの時間・重み", () => {
		expect(
			motionLogMessage("自分の体", {
				state: "walk",
				speed: 1.321,
				rate: 0.891,
				status: [
					{ name: "walk", time: 0.4249, weight: 0.75 },
					{ name: "idle", time: 3.1, weight: 0.25 },
					{ name: "run", time: 0.2, weight: 0 },
				],
			}),
		).toBe(
			"[veryare-motion] 自分の体: walk（速さ 1.32 m/秒・再生 0.89 倍）・walk 時間 0.42 重み 0.75、idle 時間 3.10 重み 0.25",
		);
	});

	it("ポーズは名前つき。動きの素材が無い体は「動きなし」", () => {
		expect(
			motionLogMessage("自分の体", {
				state: "pose:maleCrouch",
				speed: 0,
				rate: 1,
				status: [],
			}),
		).toBe(
			"[veryare-motion] 自分の体: pose:maleCrouch（速さ 0.00 m/秒・再生 1.00 倍）・動きなし（静止した姿勢）",
		);
	});
});
