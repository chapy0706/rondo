import { describe, expect, it } from "vitest";
import {
	AUTO_CAMERA_STORAGE_KEY,
	type AutoCameraInput,
	type AutoCameraState,
	DEFAULT_AUTO_CAMERA,
	autoCameraActive,
	autoCameraSettings,
	loadAutoCamera,
	saveAutoCamera,
	stepAutoCamera,
} from "./autoCamera";

const DT = 1 / 60;
const MAX = DEFAULT_AUTO_CAMERA.maxRate;
const REST: AutoCameraState = { yaw: 0, rate: 0 };

/** 視点パッドを長く触っていない、追従ありの入力。move は VirtualPad の約束（y は下が正）。 */
function input(
	move: { x: number; y: number },
	extra: Partial<AutoCameraInput> = {},
): AutoCameraInput {
	return {
		move,
		speed: 4.5 * Math.hypot(move.x, move.y),
		secondsSinceLook: 10,
		enabled: true,
		dt: DT,
		...extra,
	};
}

/** 同じ入力で n コマ進める。 */
function run(
	state: AutoCameraState,
	frame: AutoCameraInput,
	n: number,
): AutoCameraState[] {
	const states: AutoCameraState[] = [];
	let current = state;
	for (let i = 0; i < n; i++) {
		current = stepAutoCamera(current, frame);
		states.push(current);
	}
	return states;
}

/** -π〜π に直した、2 つの向きの差。 */
function turned(from: number, to: number): number {
	const d = to - from;
	return d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
}

describe("stepAutoCamera - 視点の自動追従（向き yaw だけを動かす）", () => {
	it("止まっているとき（速さが定数以下）は、向きが変わらない", () => {
		const last = run(REST, input({ x: 1, y: 0 }, { speed: 0 }), 60).at(-1);
		expect(last).toEqual(REST);
		const slow = DEFAULT_AUTO_CAMERA.minSpeed * 0.99;
		expect(
			run(REST, input({ x: 1, y: 0 }, { speed: slow }), 60).at(-1),
		).toEqual(REST);
	});

	it("前へ倒しているとき（角度がほぼ 0）は、向きが変わらない", () => {
		const last = run(REST, input({ x: 0, y: -1 }), 120).at(-1);
		expect(last?.yaw).toBeCloseTo(0, 9);
	});

	it("横へ倒すと、倒した側へ回る（右は yaw が減る、左は増える）。上限の速さ以下", () => {
		const right = run(REST, input({ x: 1, y: 0 }), 60);
		const left = run(REST, input({ x: -1, y: 0 }), 60);
		expect(right.at(-1)?.yaw).toBeLessThan(0);
		expect(left.at(-1)?.yaw).toBeGreaterThan(0);
		for (const s of [...right, ...left]) {
			expect(Math.abs(s.rate)).toBeLessThanOrEqual(MAX + 1e-12);
		}
	});

	it("回す強さは、横の成分（sin）に比例する（斜め 30° は、真横の半分に近づく）", () => {
		const side = run(REST, input({ x: 1, y: 0 }), 600).at(-1);
		const angle = Math.PI / 6;
		const diagonal = run(
			REST,
			input({ x: Math.sin(angle), y: -Math.cos(angle) }),
			600,
		).at(-1);
		expect(side?.rate).toBeCloseTo(-MAX, 6);
		expect(diagonal?.rate).toBeCloseTo(-MAX * 0.5, 6);
	});

	it("急に始めない（最初のコマは上限よりずっと遅い）", () => {
		const first = stepAutoCamera(REST, input({ x: 1, y: 0 }));
		expect(Math.abs(first.rate)).toBeGreaterThan(0);
		expect(Math.abs(first.rate)).toBeLessThan(MAX * 0.2);
	});

	it("急に止めない（止まった後、回る速さは少しずつ 0 へ戻り、逆へは回らない）", () => {
		const moving = run(REST, input({ x: 1, y: 0 }), 120).at(
			-1,
		) as AutoCameraState;
		const stopped = run(moving, input({ x: 0, y: 0 }, { speed: 0 }), 120);
		expect(Math.abs(stopped[0]?.rate ?? 0)).toBeGreaterThan(MAX * 0.5);
		let previous = Math.abs(moving.rate);
		for (const s of stopped) {
			expect(s.rate).toBeLessThanOrEqual(0);
			expect(Math.abs(s.rate)).toBeLessThanOrEqual(previous);
			previous = Math.abs(s.rate);
		}
		expect(stopped.at(-1)?.rate).toBe(0);
	});

	it("後ろへ倒している（100° 超）ときは、回らない。100° 以内なら回る", () => {
		const back = (deg: number) => {
			const a = (deg * Math.PI) / 180;
			return input({ x: Math.sin(a), y: -Math.cos(a) });
		};
		expect(run(REST, back(101), 60).at(-1)?.yaw).toBe(0);
		expect(run(REST, back(180), 60).at(-1)?.yaw).toBe(0);
		expect(run(REST, back(-150), 60).at(-1)?.yaw).toBe(0);
		expect(run(REST, back(99), 60).at(-1)?.yaw).toBeLessThan(0);
	});

	it("視点パッドを触っている間と、離してから 1.2 秒は、回らない（回っていても、すぐ止める）", () => {
		const moving = run(REST, input({ x: 1, y: 0 }), 60).at(
			-1,
		) as AutoCameraState;
		for (const since of [0, 0.5, 1.19]) {
			const next = stepAutoCamera(
				moving,
				input({ x: 1, y: 0 }, { secondsSinceLook: since }),
			);
			expect(next).toEqual({ yaw: moving.yaw, rate: 0 });
		}
		const after = stepAutoCamera(
			REST,
			input({ x: 1, y: 0 }, { secondsSinceLook: 1.2 }),
		);
		expect(after.yaw).toBeLessThan(0);
	});

	it("設定が「なし」のとき、回らない", () => {
		const last = run(REST, input({ x: 1, y: 0 }, { enabled: false }), 60).at(
			-1,
		);
		expect(last).toEqual(REST);
	});

	it("±180° をまたぐときも、近い回り方で回る（1 コマで大きく跳ばない）。結果は -π〜π", () => {
		const nearPi: AutoCameraState = { yaw: Math.PI - 0.001, rate: MAX };
		const left = stepAutoCamera(nearPi, input({ x: -1, y: 0 }));
		expect(left.yaw).toBeLessThan(0);
		expect(left.yaw).toBeGreaterThanOrEqual(-Math.PI);
		expect(Math.abs(turned(nearPi.yaw, left.yaw))).toBeLessThanOrEqual(
			MAX * DT + 1e-12,
		);
		const nearMinusPi: AutoCameraState = { yaw: -Math.PI + 0.001, rate: -MAX };
		const right = stepAutoCamera(nearMinusPi, input({ x: 1, y: 0 }));
		expect(right.yaw).toBeGreaterThan(0);
		expect(right.yaw).toBeLessThanOrEqual(Math.PI);
		expect(Math.abs(turned(nearMinusPi.yaw, right.yaw))).toBeLessThanOrEqual(
			MAX * DT + 1e-12,
		);
	});

	it("NaN や無限大を出さない（壊れた入力では、回さない）", () => {
		const cases: AutoCameraInput[] = [
			input({ x: Number.NaN, y: 0 }),
			input({ x: Number.POSITIVE_INFINITY, y: 0 }),
			input({ x: 1, y: 0 }, { speed: Number.NaN }),
			input({ x: 1, y: 0 }, { dt: Number.NaN }),
			input({ x: 1, y: 0 }, { dt: Number.POSITIVE_INFINITY }),
			input({ x: 1, y: 0 }, { dt: -1 }),
			input({ x: 1, y: 0 }, { secondsSinceLook: Number.NaN }),
			input({ x: 1, y: 0 }, { secondsSinceLook: Number.POSITIVE_INFINITY }),
		];
		for (const frame of cases) {
			const next = stepAutoCamera(REST, frame);
			expect(Number.isFinite(next.yaw)).toBe(true);
			expect(Number.isFinite(next.rate)).toBe(true);
		}
		const broken = stepAutoCamera(
			{ yaw: Number.NaN, rate: Number.NaN },
			input({ x: 1, y: 0 }),
		);
		expect(Number.isFinite(broken.yaw)).toBe(true);
		expect(Number.isFinite(broken.rate)).toBe(true);
	});

	it("右へ倒し続けると、一定の速さ（上限）で回り続け、上限を超えない", () => {
		const states = run(REST, input({ x: 1, y: 0 }), 60 * 10);
		let previous = REST.yaw;
		const steps: number[] = [];
		for (const s of states) {
			const step = turned(previous, s.yaw);
			expect(step).toBeLessThanOrEqual(0);
			expect(Math.abs(step)).toBeLessThanOrEqual(MAX * DT + 1e-12);
			steps.push(step);
			previous = s.yaw;
		}
		// 後半の 5 秒は、上限の速さで一定。
		for (const step of steps.slice(-300)) {
			expect(step / DT).toBeCloseTo(-MAX, 6);
		}
	});

	it("上限の速さは毎秒 75°、待つ時間は 1.2 秒、角度のしきい値は 100°", () => {
		expect((DEFAULT_AUTO_CAMERA.maxRate * 180) / Math.PI).toBeCloseTo(75, 9);
		expect(DEFAULT_AUTO_CAMERA.lookDelaySeconds).toBe(1.2);
		expect((DEFAULT_AUTO_CAMERA.maxAngle * 180) / Math.PI).toBeCloseTo(100, 9);
	});
});

describe("autoCameraActive - 自分が動けるときだけ追従する", () => {
	it("待機ルーム（鬼選出）、準備移動、鬼の探索では、追従する", () => {
		expect(autoCameraActive("oni-selection", true)).toBe(true);
		expect(autoCameraActive("preparation", true)).toBe(true);
		expect(autoCameraActive("exploration", true)).toBe(true);
	});

	it("ペイントフェーズ（鬼が待機ルームで動けても）、動けないとき、確定後は追従しない", () => {
		expect(autoCameraActive("painting", true)).toBe(false);
		expect(autoCameraActive("exploration", false)).toBe(false);
		expect(autoCameraActive("reveal", false)).toBe(false);
		expect(autoCameraActive("ended", false)).toBe(false);
	});
});

describe("autoCameraSettings - 開発中だけ、URL で追従の定数を変えられる", () => {
	const all =
		"?camFollowDeg=90&camFollowDelay=2&camFollowAngleDeg=120&camFollowMinSpeed=1";

	it("本番の既定（開発用の合図なし）では、URL の指定を無視する", () => {
		expect(autoCameraSettings(false, all)).toEqual(DEFAULT_AUTO_CAMERA);
	});

	it("開発用の変数か ?roof=1 のとき、指定した値を使う（角度は度で指定する）", () => {
		const expected = {
			maxRate: Math.PI / 2,
			lookDelaySeconds: 2,
			maxAngle: (120 * Math.PI) / 180,
			minSpeed: 1,
		};
		for (const s of [
			autoCameraSettings(true, all),
			autoCameraSettings(false, `${all}&roof=1`),
		]) {
			expect(s.maxRate).toBeCloseTo(expected.maxRate, 12);
			expect(s.lookDelaySeconds).toBe(expected.lookDelaySeconds);
			expect(s.maxAngle).toBeCloseTo(expected.maxAngle, 12);
			expect(s.minSpeed).toBe(expected.minSpeed);
		}
	});

	it("指定の無い値・数でない値・範囲の外の値は、既定のまま", () => {
		const s = autoCameraSettings(
			true,
			"?camFollowDeg=abc&camFollowDelay=-1&camFollowAngleDeg=500&camFollowMinSpeed=",
		);
		expect(s).toEqual(DEFAULT_AUTO_CAMERA);
	});
});

/** localStorage の代わり。 */
function memory(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		values,
	};
}

const broken = {
	getItem: (): string | null => {
		throw new Error("使えない");
	},
	setItem: (): void => {
		throw new Error("使えない");
	},
};

describe("視点の自動追従のあり・なし（端末に覚える）", () => {
	it("既定は「あり」。動きを減らす設定の端末では、既定を「なし」にする", () => {
		expect(loadAutoCamera(memory(), false)).toBe(true);
		expect(loadAutoCamera(memory(), true)).toBe(false);
		expect(
			loadAutoCamera(memory({ [AUTO_CAMERA_STORAGE_KEY]: "?" }), false),
		).toBe(true);
	});

	it("覚えた値は、端末の動きを減らす設定より優先する", () => {
		expect(
			loadAutoCamera(memory({ [AUTO_CAMERA_STORAGE_KEY]: "on" }), true),
		).toBe(true);
		expect(
			loadAutoCamera(memory({ [AUTO_CAMERA_STORAGE_KEY]: "off" }), false),
		).toBe(false);
	});

	it("覚えた値を、次に読める", () => {
		const storage = memory();
		saveAutoCamera(storage, false);
		expect(storage.values.get(AUTO_CAMERA_STORAGE_KEY)).toBe("off");
		expect(loadAutoCamera(storage, false)).toBe(false);
		saveAutoCamera(storage, true);
		expect(loadAutoCamera(storage, true)).toBe(true);
	});

	it("使えない（無い・例外を投げる）ときも動く。読めなければ既定", () => {
		expect(loadAutoCamera(null, false)).toBe(true);
		expect(loadAutoCamera(null, true)).toBe(false);
		expect(loadAutoCamera(broken, false)).toBe(true);
		expect(loadAutoCamera(broken, true)).toBe(false);
		expect(() => saveAutoCamera(broken, false)).not.toThrow();
		expect(() => saveAutoCamera(null, false)).not.toThrow();
	});
});
