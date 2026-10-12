import { VERYARE_MODEL_POSES } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import posesFixture from "../../../../../packages/contracts/src/fixtures/veryare-poses.json";
import {
	DEFAULT_POSE,
	POSE_NOTICE_MS,
	RANDOM_POSE_POOL,
	canChangePose,
	modelPoseOf,
	parseModelPose,
	pickNextPose,
	poseLabel,
	poseNoticeVisible,
} from "./poses";

describe("ポーズの一覧と対応（issue-56 / 共有の見本 veryare-poses.json）", () => {
	it("既定は idle。ランダムに選ぶ対象（プール）は、初期は 23 すべて", () => {
		expect(DEFAULT_POSE).toBe("idle");
		expect(DEFAULT_POSE).toBe(posesFixture.default);
		expect([...RANDOM_POSE_POOL]).toEqual([...VERYARE_MODEL_POSES]);
	});

	it("表示名は、見本の label", () => {
		for (const pose of posesFixture.poses) {
			expect(poseLabel(pose.id as (typeof VERYARE_MODEL_POSES)[number])).toBe(
				pose.label,
			);
		}
	});

	it("CPU と鬼のポーズの値は、素材のポーズに対応づく（standing → idle、crouching → maleCrouch、lying → maleLaying1）", () => {
		expect(modelPoseOf("standing")).toBe("idle");
		expect(modelPoseOf("crouching")).toBe("maleCrouch");
		expect(modelPoseOf("lying")).toBe("maleLaying1");
		for (const [cpu, model] of Object.entries(posesFixture.cpu)) {
			expect(modelPoseOf(cpu)).toBe(model);
		}
	});

	it("素材のポーズの識別子は、そのまま。未知の値・null・数でない値は、既定の立ち姿", () => {
		for (const id of VERYARE_MODEL_POSES) expect(modelPoseOf(id)).toBe(id);
		expect(modelPoseOf("moonwalk")).toBe("idle");
		expect(modelPoseOf(null)).toBe("idle");
		expect(modelPoseOf(42)).toBe("idle");
	});

	it("parseModelPose: 一覧の識別子だけを受け付ける（CPU の値・未知の値は null）", () => {
		expect(parseModelPose("maleCrouch")).toBe("maleCrouch");
		expect(parseModelPose("standing")).toBeNull();
		expect(parseModelPose("moonwalk")).toBeNull();
		expect(parseModelPose(undefined)).toBeNull();
	});
});

describe("pickNextPose - ポーズボタン（乱数を注入できる）", () => {
	it("いまと同じポーズは選ばない（乱数がどの値でも）", () => {
		for (const current of RANDOM_POSE_POOL) {
			for (let k = 0; k < 50; k++) {
				const r = k / 50;
				expect(pickNextPose(current, RANDOM_POSE_POOL, () => r)).not.toBe(
					current,
				);
			}
		}
	});

	it("プールのすべてが選ばれうる（いまのポーズ以外）", () => {
		const seen = new Set<string>();
		const n = RANDOM_POSE_POOL.length - 1;
		for (let k = 0; k < n; k++) {
			seen.add(pickNextPose("idle", RANDOM_POSE_POOL, () => (k + 0.5) / n));
		}
		expect(seen.size).toBe(n);
		expect(seen.has("idle")).toBe(false);
		// idle も、ほかのポーズからは選ばれうる。
		const fromOther = new Set<string>();
		for (let k = 0; k < n; k++) {
			fromOther.add(
				pickNextPose("maleCrouch", RANDOM_POSE_POOL, () => (k + 0.5) / n),
			);
		}
		expect(fromOther.has("idle")).toBe(true);
	});

	it("いまのポーズがプールに無いときは、プールのすべてから選ぶ。乱数が 1 に近くても範囲の中", () => {
		const pool = ["walking", "mediumRun"] as const;
		expect(pickNextPose("idle", pool, () => 0)).toBe("walking");
		expect(pickNextPose("idle", pool, () => 0.999999)).toBe("mediumRun");
	});

	it("プールが1つで、いまのポーズと同じなら、そのまま（ほかに選べない）", () => {
		expect(pickNextPose("idle", ["idle"], () => 0.3)).toBe("idle");
	});
});

describe("canChangePose - ポーズボタンを使える時期（issue-57）", () => {
	const base = {
		phase: "preparation" as const,
		role: "hider" as const,
		spectator: false,
		submitted: false,
	};

	it("準備移動とペイントフェーズの隠れ側だけ。確定の電文を送る前まで", () => {
		expect(canChangePose(base)).toBe(true);
		expect(canChangePose({ ...base, phase: "painting" })).toBe(true);
		expect(canChangePose({ ...base, phase: "painting", submitted: true })).toBe(
			false,
		);
	});

	it("待機ルーム（鬼選出）・探索の開始以降・鬼・観戦者は使えない", () => {
		for (const phase of [
			"oni-selection",
			"exploration",
			"reveal",
			"ended",
		] as const) {
			expect(canChangePose({ ...base, phase })).toBe(false);
		}
		expect(canChangePose({ ...base, role: "oni" })).toBe(false);
		expect(canChangePose({ ...base, spectator: true })).toBe(false);
	});
});

describe("poseNoticeVisible - 押したとき、選んだポーズの表示名を短く出す", () => {
	it("押してから 1 秒の間だけ出す。押していなければ出さない", () => {
		expect(POSE_NOTICE_MS).toBe(1000);
		expect(poseNoticeVisible(null, 5000)).toBe(false);
		expect(poseNoticeVisible(1000, 1000)).toBe(true);
		expect(poseNoticeVisible(1000, 1999)).toBe(true);
		expect(poseNoticeVisible(1000, 2000)).toBe(false);
	});
});
