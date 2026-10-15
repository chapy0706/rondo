/**
 * 体の動きが止まる不具合の再現テスト（issue-57 の後半）。シーン全体の毎フレームの体の更新（scene.ts の
 * render が回す登録所 motionRegistry.ts）を、本物の three の AnimationMixer と、素材と同じ構造の偽の動き
 * （待機・歩く・走る・ポーズ / bodyFixture.ts）で、3 分ぶん、種を固定した乱数で状態を切り替えながら回す。
 *
 * 対象の体は、画面に出る体のすべて: 自分の体、鬼本人の体、ほかの人の画面の鬼（人間と CPU）、待機ルームの
 * ほかのメンバー。切り替えるもの: 見えている・見えていない、素材の読み込みによる体の差し替え（仮の
 * カプセル → 素材の体）、空間の切り替え（待機ルーム ⇄ ステージ。位置が飛ぶ）、鬼の通知が届かない間、
 * 歩く・走る・止まる・壁で止まる、ポーズの選び直し。
 *
 * 毎コマ、見えている体（素材の体）について、いまの状態の動きの再生の時間が進み、NaN や無限大がないこと、
 * 骨の回転が 0.5 秒以上止まらないこと（見張り motionWatch.ts）を確かめる。
 */
import type { VeryareModelPose } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import { type BodyInstance, type BodyKit, placeholderBodyKit } from "./body";
import { fixtureBodyKit, random } from "./bodyFixture";
import { MEMBER_DELAY_MS, MEMBER_RESEAT } from "./members";
import { type MotionSource, createMotionRegistry } from "./motionRegistry";
import { createMotionWatch } from "./motionWatch";
import { pushOniSample, sampleOni, trackDelay } from "./oniTrack";
import { type TrackSample, pushSample, sampleTrack } from "./track";

const WALK = 4.5;

interface Mover {
	x: number;
	z: number;
	/** いまの速さ（m/秒）と向き。 */
	speed: number;
	heading: number;
	/** 壁で止まっている（入力はあるが進まない）。 */
	blocked: boolean;
	until: number;
}

function newMover(): Mover {
	return { x: 0, z: 0, speed: 0, heading: 0, blocked: false, until: 0 };
}

/** 歩く・走る・止まる・壁で止まるを、0.3〜3 秒ごとに選び直す。 */
function steer(mover: Mover, time: number, next: () => number): void {
	if (time < mover.until) return;
	const r = next();
	mover.speed = r < 0.3 ? 0 : r < 0.6 ? WALK * 0.3 : WALK;
	mover.blocked = next() < 0.15;
	mover.heading = next() * 2 * Math.PI;
	mover.until = time + 0.3 + next() * 2.7;
}

function move(mover: Mover, dt: number): void {
	if (mover.blocked) return;
	mover.x += Math.cos(mover.heading) * mover.speed * dt;
	mover.z += Math.sin(mover.heading) * mover.speed * dt;
	// 広い所の中で折り返す（端で位置が飛ばないように）。
	if (Math.abs(mover.x) > 20) mover.heading = Math.PI - mover.heading;
	if (Math.abs(mover.z) > 20) mover.heading = -mover.heading;
}

/** 登録する体1つ（テストの中の画面の状態）。 */
interface Figure {
	readonly name: string;
	body: BodyInstance;
	visible: boolean;
	where: { x: number; z: number } | null;
	chosen: VeryareModelPose | null;
	fixed: boolean;
}

function source(figure: Figure): MotionSource {
	return {
		name: figure.name,
		body: () => figure.body,
		where: () => (figure.visible ? figure.where : null),
		chosen: () => figure.chosen,
		fixed: () => figure.fixed,
	};
}

const POSES: readonly (VeryareModelPose | null)[] = [
	null,
	"maleCrouch",
	"femaleDance",
];

describe("登録所 - シーン全体の体の更新を数分回しても、どの体の動きも止まらない（本物の AnimationMixer）", () => {
	it.each([3, 11, 2026])("種 %i", (seed) => {
		const next = random(seed);
		const fixture = fixtureBodyKit();
		let kit: BodyKit = placeholderBodyKit;
		const watch = createMotionWatch();
		const registry = createMotionRegistry({
			speeds: () => kit.motionSpeeds,
			watch,
		});
		const make = (name: string): Figure => ({
			name,
			body: kit.create(null, 0xffffff),
			visible: false,
			where: null,
			chosen: null,
			fixed: false,
		});
		const self = make("自分の体");
		const selfOni = make("鬼本人の体");
		const oni = make("鬼");
		const cpu = make("鬼 CPU");
		const members = [make("メンバー a"), make("メンバー b")];
		const figures = [self, selfOni, oni, cpu, ...members];
		for (const figure of figures) registry.add(source(figure));

		// 本当の位置（自分は手元、鬼とメンバーは通知のもと）と、届いた通知。
		const selfMover = newMover();
		const oniMover = newMover();
		const cpuMover = newMover();
		const memberMovers = members.map(() => newMover());
		let oniTrack: readonly TrackSample[] = [];
		let cpuTrack: readonly TrackSample[] = [];
		const memberTracks: (readonly TrackSample[])[] = members.map(() => []);
		let oniOutageUntil = 0;
		let space: "waiting-room" | "stage" = "waiting-room";
		let spaceUntil = 20;
		let asOni = false;
		let swapped = false;

		const problems: string[] = [];
		const seen = new Map<string, Set<string>>();
		const previous = new Map<string, { state: string; time: number }>();
		const swapAt = 5 + next() * 10;
		let time = 0;
		for (let frame = 0; time < 180 && problems.length < 5; frame++) {
			const dt = next() < 0.03 ? 0.1 : 1 / 60;
			time += dt;
			const ms = time * 1000;
			let jumped = false;

			// 素材の読み込みで、仮のカプセルから素材の体へ差し替える（scene.ts の useBodyKit と同じ）。
			if (!swapped && time >= swapAt) {
				swapped = true;
				kit = fixture;
				for (const figure of figures) {
					figure.body.dispose();
					figure.body = kit.create(null, 0xffffff);
				}
			}
			// 空間の切り替え（待機ルーム ⇄ ステージ）。位置が飛ぶ。
			if (time >= spaceUntil) {
				space = space === "stage" ? "waiting-room" : "stage";
				spaceUntil = time + 10 + next() * 30;
				// 鬼本人の画面と、ほかの人の画面を、ステージに入るたびに入れ替える。
				if (space === "stage") asOni = !asOni;
				jumped = true;
				for (const mover of [selfMover, oniMover, cpuMover, ...memberMovers]) {
					mover.x = (next() - 0.5) * 30;
					mover.z = (next() - 0.5) * 30;
				}
				oniTrack = [];
				cpuTrack = [];
			}
			for (const mover of [selfMover, oniMover, cpuMover, ...memberMovers]) {
				steer(mover, time, next);
				move(mover, dt);
			}
			// 鬼 CPU は、マスの中心からマスの中心へ 0.5 秒ごとに歩くか、止まる。
			// 人間の鬼の通知は 50 ms ごと。ときどき 0.5〜2 秒届かない。
			if (ms >= oniOutageUntil && next() < 0.004) {
				oniOutageUntil = ms + 500 + next() * 1500;
			}
			if (ms >= oniOutageUntil && frame % 3 === 0) {
				oniTrack = pushOniSample(oniTrack, {
					at: ms,
					x: oniMover.x,
					z: oniMover.z,
					facing: oniMover.heading,
				});
			}
			if (frame % 30 === 0) {
				cpuTrack = pushOniSample(cpuTrack, {
					at: ms,
					x: cpuMover.x,
					z: cpuMover.z,
					facing: cpuMover.heading,
				});
			}
			if (frame % 9 === 0) {
				members.forEach((_, i) => {
					const mover = memberMovers[i] as Mover;
					memberTracks[i] = pushSample(
						memberTracks[i] ?? [],
						{ at: ms, x: mover.x, z: mover.z, facing: mover.heading },
						MEMBER_RESEAT,
					);
				});
			}
			// ポーズの選び直し（自分の体と、メンバーの待機ポーズ）。
			if (next() < 0.003) {
				self.chosen = POSES[Math.floor(next() * POSES.length)] ?? null;
			}
			for (const member of members) {
				if (next() < 0.003) {
					member.chosen = POSES[Math.floor(next() * POSES.length)] ?? null;
				}
			}

			// 画面の状態（Veryare.tsx と scene.ts の見え方の決まりと同じ）。
			const here = { x: selfMover.x, z: selfMover.z };
			self.visible = !(space === "stage" && asOni);
			self.where = here;
			selfOni.visible = space === "stage" && asOni;
			selfOni.where = here;
			const oniAt =
				space === "stage" && !asOni
					? sampleOni(oniTrack, ms - trackDelay(oniTrack))
					: null;
			oni.visible = oniAt !== null;
			oni.where = oniAt;
			const cpuAt =
				space === "stage"
					? sampleOni(cpuTrack, ms - trackDelay(cpuTrack))
					: null;
			cpu.visible = cpuAt !== null;
			cpu.where = cpuAt;
			members.forEach((member, i) => {
				const at =
					space === "waiting-room"
						? sampleTrack(memberTracks[i] ?? [], ms - MEMBER_DELAY_MS)
						: null;
				member.visible = at !== null;
				member.where = at;
			});

			registry.update(dt, { jumped, at: ms });

			if (!swapped) continue;
			for (const figure of figures) {
				if (!figure.visible) {
					previous.delete(figure.name);
					continue;
				}
				const info = registry.info(figure.name);
				const where = `種 ${seed}・${time.toFixed(2)} 秒・${figure.name}`;
				if (info === null) {
					problems.push(`${where}: 登録所に無い`);
					continue;
				}
				const states = seen.get(figure.name) ?? new Set();
				states.add(info.state);
				seen.set(figure.name, states);
				const clip = info.clips.find((c) => c.name === info.state);
				if (clip === undefined) {
					problems.push(`${where}: ${info.state} の動きが再生されていない`);
					continue;
				}
				if (!Number.isFinite(clip.time) || !Number.isFinite(info.rate)) {
					problems.push(`${where}: 時間・再生の速さが数でない`);
				}
				const before = previous.get(figure.name);
				if (before?.state === info.state && before.time === clip.time) {
					problems.push(
						`${where}: ${info.state} の時間が進まない（${clip.time}）`,
					);
				}
				previous.set(figure.name, { state: info.state, time: clip.time });
			}
		}
		expect(problems).toEqual([]);
		expect(watch.stalls()).toEqual([]);
		// どの体も、待機と、歩くか走るを通った（確かめが空回りしていない）。
		for (const figure of figures) {
			const states = seen.get(figure.name) ?? new Set();
			expect([...states], figure.name).toContain("idle");
			expect(
				states.has("walk") || states.has("run"),
				`${figure.name}: ${[...states].join(",")}`,
			).toBe(true);
		}
		for (const name of ["自分の体", "鬼本人の体", "鬼"]) {
			const states = seen.get(name) ?? new Set();
			expect([...states], name).toEqual(
				expect.arrayContaining(["idle", "walk", "run"]),
			);
		}
	});
});

describe("登録所 - 登録と取り消し、差し替えた体", () => {
	it("取り消した体は更新しない。見えていない体は一覧（infos）に出さない", () => {
		const kit = fixtureBodyKit();
		const registry = createMotionRegistry({ speeds: () => kit.motionSpeeds });
		const body = kit.create(null, 0xffffff);
		const figure: Figure = {
			name: "鬼",
			body,
			visible: true,
			where: { x: 0, z: 0 },
			chosen: null,
			fixed: false,
		};
		const remove = registry.add(source(figure));
		registry.update(1 / 60, { jumped: false, at: 0 });
		expect(registry.infos().map((i) => i.name)).toEqual(["鬼"]);
		figure.visible = false;
		registry.update(1 / 60, { jumped: false, at: 16 });
		expect(registry.infos()).toEqual([]);
		remove();
		expect(registry.info("鬼")).toBeNull();
		const before = body.motionStatus().map((s) => s.time);
		figure.visible = true;
		registry.update(1 / 60, { jumped: false, at: 32 });
		expect(body.motionStatus().map((s) => s.time)).toEqual(before);
	});

	it("見えなくなって、また見えたとき、見えていない間の時間を止まりと数えない（見張り）", () => {
		const kit = fixtureBodyKit();
		const watch = createMotionWatch();
		const registry = createMotionRegistry({
			speeds: () => kit.motionSpeeds,
			watch,
		});
		const figure: Figure = {
			name: "鬼 CPU",
			body: kit.create(null, 0xffffff),
			visible: true,
			where: { x: 0, z: 0 },
			chosen: null,
			fixed: false,
		};
		registry.add(source(figure));
		let at = 0;
		const frames = (n: number) => {
			for (let i = 0; i < n; i++) {
				at += 16;
				registry.update(1 / 60, { jumped: false, at });
			}
		};
		frames(30);
		figure.visible = false;
		frames(120);
		figure.visible = true;
		frames(30);
		expect(watch.stalls()).toEqual([]);
	});

	it("体が差し替わったら、いまの動きを新しい体に当てて合わせ、続けて進める", () => {
		const kit = fixtureBodyKit();
		const registry = createMotionRegistry({ speeds: () => kit.motionSpeeds });
		const figure: Figure = {
			name: "鬼本人の体",
			body: kit.create(null, 0xffffff),
			visible: true,
			where: { x: 0, z: 0 },
			chosen: null,
			fixed: false,
		};
		registry.add(source(figure));
		// 走らせる（1 フレーム 7.5 cm ≒ 4.5 m/秒）。
		for (let i = 0; i < 40; i++) {
			figure.where = { x: i * 0.075, z: 0 };
			registry.update(1 / 60, { jumped: false, at: i * 16 });
		}
		expect(registry.info("鬼本人の体")?.state).toBe("run");
		figure.body = kit.create(null, 0xffffff);
		figure.where = { x: 40 * 0.075, z: 0 };
		registry.update(1 / 60, { jumped: false, at: 640 });
		const run = figure.body.motionStatus().find((s) => s.name === "run");
		expect(run?.weight).toBe(1);
		expect(run?.time).toBeGreaterThan(0);
	});
});
