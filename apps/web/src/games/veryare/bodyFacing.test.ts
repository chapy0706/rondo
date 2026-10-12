import { describe, expect, it } from "vitest";
import {
	BODY_TURN_SPEED,
	facingTarget,
	stepFacing,
	turnToward,
} from "./bodyFacing";
import { facingOfYaw } from "./rules";

const deg = (d: number) => (d * Math.PI) / 180;

describe("facingTarget - スティックを倒した方向（世界の向き。サーバーの向きの約束）", () => {
	it("前へ倒すと、視点の向きと同じ向き（これまでの facingOfYaw と同じ）", () => {
		for (const yaw of [0, 0.7, -2.1]) {
			expect(facingTarget({ x: 0, y: -1 }, yaw)).toBeCloseTo(
				facingOfYaw(yaw),
				9,
			);
		}
	});

	it("横へ倒すと、進む向き（視点の向きから 90° 回った向き）", () => {
		// yaw 0 は -z を向く。右（+x）へ倒すと +x へ進む = 向き 0。
		expect(facingTarget({ x: 1, y: 0 }, 0)).toBeCloseTo(0, 9);
		expect(facingTarget({ x: -1, y: 0 }, 0)).toBeCloseTo(Math.PI, 9);
		// 後ろへ倒すと、+z へ進む = 向き π/2。
		expect(facingTarget({ x: 0, y: 1 }, 0)).toBeCloseTo(Math.PI / 2, 9);
	});

	it("倒していなければ null（向きを変えない）", () => {
		expect(facingTarget({ x: 0, y: 0 }, 1.2)).toBeNull();
	});
});

describe("turnToward - 近い回り方で、なめらかに回す", () => {
	it("回る速さは 720°/秒", () => {
		expect(BODY_TURN_SPEED).toBeCloseTo(deg(720), 12);
	});

	it("1 回に回れる角度より近ければ、目標に合わせる。遠ければ、その角度だけ回る", () => {
		expect(turnToward(0, deg(5), deg(10))).toBeCloseTo(deg(5), 12);
		expect(turnToward(0, deg(90), deg(10))).toBeCloseTo(deg(10), 12);
		expect(turnToward(0, deg(-90), deg(10))).toBeCloseTo(deg(-10), 12);
	});

	it("180° 近くでも、近い回り方で回る", () => {
		expect(turnToward(0, deg(170), deg(10))).toBeCloseTo(deg(10), 12);
		expect(turnToward(0, deg(-170), deg(10))).toBeCloseTo(deg(-10), 12);
		expect(turnToward(deg(10), deg(-170), deg(5))).toBeCloseTo(deg(5), 12);
	});

	it("±180° をまたぐときも、近い向きへ回り、行き過ぎない（結果は -180°〜180°）", () => {
		const next = turnToward(deg(175), deg(-175), deg(4));
		expect(next).toBeCloseTo(deg(179), 12);
		const wrapped = turnToward(deg(178), deg(-175), deg(10));
		expect(wrapped).toBeCloseTo(deg(-175), 12);
		expect(Math.abs(wrapped)).toBeLessThanOrEqual(Math.PI);
	});
});

describe("stepFacing - 毎コマの体の向き（時間は dt で注入）", () => {
	it("横へ倒し続けると、進む向きを向く（回る速さで少しずつ）", () => {
		let facing = facingOfYaw(0);
		const target = facingTarget({ x: 1, y: 0 }, 0) as number;
		facing = stepFacing(facing, { x: 1, y: 0 }, 0, 1 / 60);
		expect(facing).not.toBeCloseTo(target, 3);
		for (let i = 0; i < 60; i++)
			facing = stepFacing(facing, { x: 1, y: 0 }, 0, 1 / 60);
		expect(facing).toBeCloseTo(target, 9);
	});

	it("止まると（倒していないと）、最後の向きを保つ", () => {
		expect(stepFacing(1.3, { x: 0, y: 0 }, 2.0, 0.5)).toBe(1.3);
	});
});
