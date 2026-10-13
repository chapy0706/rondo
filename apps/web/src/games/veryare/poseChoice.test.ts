import { describe, expect, it } from "vitest";
import {
	NO_POSE_CHOICE,
	WAITING_POSE_INTERVAL_MS,
	avatarPoseOf,
	canChangeWaitingPose,
	chooseGamePose,
	chooseWaitingPose,
	enterSpace,
	waitingPoseEvent,
} from "./poseChoice";

describe("待機ポーズと、ゲームの隠れ側のポーズは別の変数（issue-59 / ADR 0044）", () => {
	it("待機ルームで選んだポーズは、待機の変数だけに入り、ゲーム用は null のまま", () => {
		const choice = chooseWaitingPose(NO_POSE_CHOICE, "femaleDance");
		expect(choice).toEqual({ waiting: "femaleDance", game: null });
	});

	it("ステージに移ったとき、ゲーム用の選んだポーズは null に戻り、待機のポーズを引き継がない", () => {
		const waiting = chooseWaitingPose(NO_POSE_CHOICE, "femaleDance");
		const staged = enterSpace(waiting, "stage");
		expect(staged.game).toBeNull();
		expect(staged.waiting).toBeNull();
		// ゲーム用に選んでいた値があっても（前の対戦の残りなど）、ステージに移れば null。
		const leftover = chooseGamePose(waiting, "maleSitting1");
		expect(enterSpace(leftover, "stage").game).toBeNull();
	});

	it("ステージで選んだポーズは、ゲーム用の変数に入る（待機のポーズは変わらない）", () => {
		const staged = enterSpace(
			chooseWaitingPose(NO_POSE_CHOICE, "femaleDance"),
			"stage",
		);
		expect(chooseGamePose(staged, "maleCrouch")).toEqual({
			waiting: null,
			game: "maleCrouch",
		});
	});

	it("待機ルームに入るときは、待機のポーズを保ち、ゲーム用は null", () => {
		const choice = { waiting: "idle", game: "maleCrouch" } as const;
		expect(enterSpace(choice, "waiting-room")).toEqual({
			waiting: "idle",
			game: null,
		});
	});

	it("自分の体に当てるポーズは、待機ルームでは待機のポーズ、ステージではゲーム用", () => {
		const choice = { waiting: "femaleDance", game: "maleCrouch" } as const;
		expect(avatarPoseOf(choice, "waiting-room")).toBe("femaleDance");
		expect(avatarPoseOf(choice, "stage")).toBe("maleCrouch");
		expect(avatarPoseOf(NO_POSE_CHOICE, "waiting-room")).toBeNull();
	});
});

describe("canChangeWaitingPose - 待機ルームのポーズボタン（issue-59）", () => {
	const base = {
		phase: "oni-selection" as const,
		space: "waiting-room" as const,
		posable: true,
		now: 10_000,
		lastPressedAt: null,
	};

	it("鬼選出の間、待機ルームで、素材の体のときだけ押せる", () => {
		expect(canChangeWaitingPose(base)).toBe(true);
		expect(canChangeWaitingPose({ ...base, posable: false })).toBe(false);
		expect(canChangeWaitingPose({ ...base, phase: "preparation" })).toBe(false);
		expect(canChangeWaitingPose({ ...base, space: "stage" })).toBe(false);
	});

	it(`押したら ${WAITING_POSE_INTERVAL_MS} ms（サーバーの間隔と同じ）だけ押せない`, () => {
		expect(WAITING_POSE_INTERVAL_MS).toBe(300);
		expect(canChangeWaitingPose({ ...base, lastPressedAt: 9_701 })).toBe(false);
		expect(canChangeWaitingPose({ ...base, lastPressedAt: 9_700 })).toBe(true);
	});
});

describe("waitingPoseEvent - 待機ポーズの変更の電文", () => {
	it("契約の VeryareWaitingPoseEvent の形", () => {
		expect(waitingPoseEvent("femaleDance")).toEqual({
			type: "waiting-pose",
			pose: "femaleDance",
		});
	});
});
