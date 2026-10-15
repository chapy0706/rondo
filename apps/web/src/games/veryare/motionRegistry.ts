/**
 * 動きのある体の登録所（issue-57 の後半）。画面に出る体（自分の体、鬼本人の体、ほかの人の画面の鬼、
 * 待機ルームのほかのメンバー）を、すべてここに登録し、毎フレームの更新は、登録所を回すだけにする
 * （体の種類ごとに更新を呼ぶ書き方をやめる。鬼の体だけ更新が抜けていた / issue-57 の後半）。
 *
 * 毎フレーム、登録した体ごとに:
 * 1. 体が差し替わっていれば（素材の読み込み）、いまの動きを新しい体に当てて、寄せずに合わせる
 * 2. 描く位置（見えていなければ null）の変化から速さを求め、待機・歩く・走る・ポーズを決める
 *    （motionState.ts の stepBodyMotion。どの体も同じ切り替え）
 * 3. 見えている体だけ、動きを当てて進める（見えていない体の AnimationMixer は進めない）
 * 4. 見張り（motionWatch.ts）があれば、状態・再生の時間・骨の回転を渡す
 *
 * three は使わない（体は BodyInstance の口だけを使う）。体を作る・消すのは、呼び出し側（scene.ts）。
 */

import type { VeryareModelPose } from "@rondo/contracts";
import type { BodyInstance, MotionStatus } from "./body";
import {
	type BodyAction,
	type BodyMotion,
	INITIAL_BODY_MOTION,
	stepBodyMotion,
} from "./motionState";
import type { MotionWatch } from "./motionWatch";

/** 登録する体1つ。値は毎フレーム読む。 */
export interface MotionSource {
	/** 体の名前（見張りの記録とテスト用の口に出す。登録所の中で重ならない）。 */
	readonly name: string;
	/** いまの体（差し替わることがある）。 */
	body(): BodyInstance;
	/** 描く位置（体の座標の x, z）。見えていなければ null。 */
	where(): { readonly x: number; readonly z: number } | null;
	/** 選んだポーズ（選んでいなければ null）。 */
	chosen(): VeryareModelPose | null;
	/** 静止の指定（ペイントフェーズ・確定のあと）。 */
	fixed(): boolean;
}

/** 体1つの動きの状態（テスト用の口と、開発中の Console に出す）。 */
export interface BodyMotionInfo {
	readonly name: string;
	/** idle・walk・run・pose:<識別子>。 */
	readonly state: string;
	/** ならした速さ（m/秒）。 */
	readonly speed: number;
	/** 再生の速さ（標準の速さとの比）。 */
	readonly rate: number;
	/** 動きごとの名前・再生の時間・重み（体の motionStatus）。 */
	readonly clips: readonly MotionStatus[];
}

export interface MotionRegistry {
	/** 登録する。返り値は取り消し。 */
	add(source: MotionSource): () => void;
	/** 1フレーム進める。jumped は空間が変わった直後。at は描画の時刻（ミリ秒。見張りの記録に使う）。 */
	update(
		dt: number,
		frame: { readonly jumped: boolean; readonly at: number },
	): void;
	/** 登録した体1つの動きの状態（無ければ null）。 */
	info(name: string): BodyMotionInfo | null;
	/** 前のフレームで見えていた体の動きの状態（登録の順）。 */
	infos(): readonly BodyMotionInfo[];
}

interface Entry {
	readonly source: MotionSource;
	motion: BodyMotion;
	action: BodyAction;
	rate: number;
	visible: boolean;
	/** 前のフレームで動きを当てた体（差し替えを見分ける）。 */
	body: BodyInstance | null;
}

const stateOf = (action: BodyAction): string =>
	action.kind === "pose" ? `pose:${action.pose}` : action.kind;

export function createMotionRegistry(options: {
	/** 歩く・走るの標準の速さ（体を作る口の motionSpeeds。動きの素材が無ければ null）。 */
	readonly speeds: () => { readonly walk: number; readonly run: number } | null;
	/** 見張り（テスト用の口・開発用の合図のときだけ）。 */
	readonly watch?: MotionWatch | null;
}): MotionRegistry {
	const entries = new Map<string, Entry>();
	/** 見張りの時計（dt を足した秒）。 */
	let clock = 0;

	const infoOf = (entry: Entry): BodyMotionInfo => ({
		name: entry.source.name,
		state: stateOf(entry.action),
		speed: entry.motion.speed,
		rate: entry.rate,
		clips: entry.source.body().motionStatus(),
	});

	return {
		add(source) {
			if (entries.has(source.name)) {
				throw new Error(`体の名前が重なっている: ${source.name}`);
			}
			const entry: Entry = {
				source,
				motion: INITIAL_BODY_MOTION,
				action: { kind: "idle" },
				rate: 1,
				visible: false,
				body: null,
			};
			entries.set(source.name, entry);
			return () => {
				if (entries.get(source.name) !== entry) return;
				entries.delete(source.name);
				options.watch?.forget(source.name);
			};
		},
		update(dt, { jumped, at }) {
			clock += Math.max(0, dt);
			const speeds = options.speeds();
			for (const entry of entries.values()) {
				const { source } = entry;
				const here = source.where();
				const step = stepBodyMotion(entry.motion, {
					here,
					dt,
					chosen: source.chosen(),
					fixed: source.fixed(),
					jumped,
					speeds,
				});
				entry.motion = step.state;
				entry.visible = here !== null;
				const body = source.body();
				// 差し替わった体（素材の読み込み）には、いまの動きを当てて、寄せずに合わせる。
				if (body !== entry.body) {
					body.setAction(entry.action, entry.rate);
					body.snap();
					entry.body = body;
				}
				// 見えていない体は進めない（描く体だけを更新する。同時に最大 5 つ）。見張りの数えも捨てる
				// （見え始めに、見えなくなる前からの時間を、止まりと数えない）。
				if (here === null) {
					options.watch?.forget(source.name);
					continue;
				}
				entry.action = step.action;
				entry.rate = step.rate;
				body.setAction(step.action, step.rate);
				body.update(dt);
				const watch = options.watch;
				if (watch == null) continue;
				const state = stateOf(step.action);
				const clips = body.motionStatus();
				watch.observe(
					{
						body: source.name,
						state,
						animated: step.action.kind !== "pose" && clips.length > 0,
						clipTime: clips.find((clip) => clip.name === state)?.time ?? null,
						bones: body.boneRotations(),
					},
					{ clock, at },
				);
			}
		},
		info(name) {
			const entry = entries.get(name);
			return entry === undefined ? null : infoOf(entry);
		},
		infos: () =>
			[...entries.values()].filter((entry) => entry.visible).map(infoOf),
	};
}
