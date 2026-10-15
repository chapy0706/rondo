import type { VeryareWaitingMember } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import membersFixture from "../../../../../packages/contracts/src/fixtures/veryare-members.json";
import {
	MAX_VISIBLE_MEMBERS,
	MEMBER_DELAY_MS,
	MEMBER_RESEAT,
	type Members,
	NO_MEMBERS,
	applyMembersNotice,
	membersInPhase,
	membersSummary,
	parseMembersNotice,
	sampleMembers,
} from "./members";

const m = (
	playerId: string,
	x: number,
	z: number,
	pose: VeryareWaitingMember["pose"] = null,
	facing: number | null = 0,
): VeryareWaitingMember => ({ playerId, x, z, facing, pose });

const selection = (self: string, at: number) => ({
	self,
	at,
	phase: "oni-selection" as const,
});

describe("parseMembersNotice - 待機ルームのメンバーの通知の境界の検証（issue-59）", () => {
	it("共有の見本の valid を読み、invalid を拒む", () => {
		for (const sample of membersFixture.membersNotice.valid) {
			expect(parseMembersNotice(sample)).toEqual(sample.members);
		}
		for (const sample of membersFixture.membersNotice.invalid) {
			expect(parseMembersNotice(sample)).toBeNull();
		}
	});

	it("数でない位置・無限大は拒む", () => {
		expect(
			parseMembersNotice({
				type: "members",
				members: [{ ...m("p", 0, 0), x: Number.POSITIVE_INFINITY }],
			}),
		).toBeNull();
	});
});

describe("applyMembersNotice - メンバーの追加・更新・削除（issue-59）", () => {
	it("自分を除いて、メンバーごとに時刻つきの通知を足す", () => {
		const next = applyMembersNotice(
			NO_MEMBERS,
			[m("me", 0, 0), m("p-1", 1, 2, "femaleDance")],
			selection("me", 1000),
		);
		expect([...next.keys()]).toEqual(["p-1"]);
		expect(next.get("p-1")).toEqual({
			track: [{ at: 1000, x: 1, z: 2, facing: 0 }],
			pose: "femaleDance",
		});
	});

	it("一覧に載らなくなった人（出ていった人）は消す", () => {
		const two = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 1, 0), m("p-2", 2, 0)],
			selection("me", 0),
		);
		const one = applyMembersNotice(two, [m("p-2", 2, 0)], selection("me", 150));
		expect([...one.keys()]).toEqual(["p-2"]);
	});

	it("止まった人は、最後の位置を保つ（更新が無いことを理由に消さない）", () => {
		const first = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 1, 0)],
			selection("me", 0),
		);
		const [view] = sampleMembers(first, 60_000, new Map());
		expect(view).toMatchObject({ id: "p-1", x: 1, z: 0 });
	});

	it("長く止まっていたあと動き出したときは、前の位置を置き直す（大きく補間しない）", () => {
		const first = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 0, 0)],
			selection("me", 0),
		);
		const moved = applyMembersNotice(
			first,
			[m("p-1", 1, 0)],
			selection("me", 10_000),
		);
		expect(moved.get("p-1")?.track).toEqual([
			{ at: 10_000 - MEMBER_RESEAT.reseatMs, x: 0, z: 0, facing: 0 },
			{ at: 10_000, x: 1, z: 0, facing: 0 },
		]);
	});

	it("向きが null なら、前の向き（無ければ 0）を使う", () => {
		const first = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 0, 0, null, 1.5)],
			selection("me", 0),
		);
		const next = applyMembersNotice(
			first,
			[m("p-1", 0.1, 0, null, null)],
			selection("me", 150),
		);
		expect(next.get("p-1")?.track.at(-1)?.facing).toBe(1.5);
		const fresh = applyMembersNotice(
			NO_MEMBERS,
			[m("p-2", 0, 0, null, null)],
			selection("me", 0),
		);
		expect(fresh.get("p-2")?.track.at(-1)?.facing).toBe(0);
	});

	it(`他のメンバーは最大 ${MAX_VISIBLE_MEMBERS} 人（通知の順）`, () => {
		const next = applyMembersNotice(
			NO_MEMBERS,
			["a", "b", "c", "d", "e", "f"].map((id) => m(id, 0, 0)),
			selection("me", 0),
		);
		expect([...next.keys()]).toEqual(["a", "b", "c", "d"]);
	});
});

describe("フェーズによる破棄（issue-59）", () => {
	it("クライアントのフェーズが鬼選出でなければ、遅れて届いた通知を捨てる", () => {
		const current = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 1, 0)],
			selection("me", 0),
		);
		for (const phase of [
			"preparation",
			"painting",
			"exploration",
			"reveal",
			"ended",
		] as const) {
			expect(
				applyMembersNotice(current, [m("p-1", 2, 0), m("p-2", 0, 0)], {
					self: "me",
					at: 100,
					phase,
				}),
			).toBe(current);
		}
	});

	it("ステージに移ったら（鬼選出でなければ）、他のメンバーを消す", () => {
		const current: Members = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 1, 0)],
			selection("me", 0),
		);
		expect(membersInPhase(current, "oni-selection")).toBe(current);
		expect(membersInPhase(current, "preparation").size).toBe(0);
	});
});

describe("sampleMembers - 少し遅らせた時刻の位置を補間する", () => {
	it(`遅れは ${MEMBER_DELAY_MS} ms（送る間隔 150 ms の 1.5 倍）。名前は参加者の一覧から引く`, () => {
		expect(MEMBER_DELAY_MS).toBe(225);
		const first = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 0, 0, "idle")],
			selection("me", 0),
		);
		const next = applyMembersNotice(
			first,
			[m("p-1", 1, 0, "idle")],
			selection("me", 150),
		);
		const [view] = sampleMembers(
			next,
			75 + MEMBER_DELAY_MS,
			new Map([["p-1", "はな"]]),
		);
		expect(view).toEqual({
			id: "p-1",
			name: "はな",
			x: 0.5,
			z: 0,
			facing: 0,
			pose: "idle",
		});
	});

	it("参加者の一覧に無い人の名前は空", () => {
		const one = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 0, 0)],
			selection("me", 0),
		);
		expect(sampleMembers(one, 0, new Map())[0]?.name).toBe("");
	});
});

describe("membersSummary - 画面の属性に出す、見えている他のメンバー（E2E 用）", () => {
	it("人数と、通知の順の待機ポーズ（選んでいなければ -）", () => {
		const current = applyMembersNotice(
			NO_MEMBERS,
			[m("p-1", 0, 0, "femaleDance"), m("p-2", 1, 0)],
			selection("me", 0),
		);
		expect(membersSummary(current)).toEqual({
			count: 2,
			poses: "femaleDance,-",
		});
		expect(membersSummary(NO_MEMBERS)).toEqual({ count: 0, poses: "" });
	});
});
