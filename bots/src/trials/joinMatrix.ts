/**
 * 参加・復帰の組み合わせ表（途中参加の人に、いまの状態が届くか）の、純粋な部分。サーバーには
 * つながない（join.ts が、この表を実際のサーバーで回す）。
 *
 * 不具合: ランダム間取りで CPU を加えたルームに 2 人目が入ると、フェーズの通知（エリアの色を含む）が
 * 2 人目に届かず、移動パッドと鬼希望エリアの円が出なかった（サーバーの room.gleam の
 * subscriber_snapshot で直した）。同じ種類の見落としを、組み合わせで見つける。
 *
 * 軸: CPU（なし・隠れ側 1 体・隠れ側 2 体・鬼 CPU）、参加の順番（作った人・2 人目・3 人目）、参加の
 * 時機（待機・鬼選出のカウント中・準備移動・ペイント・探索・答え合わせ・結果のあと / issue-70）。実際に起こりうる組み合わせ
 * だけを並べる（カウントは 2 人以上でしか始まらない。鬼選出の後の参加は、サーバーが断る）。
 */

export type CpuSetup = "none" | "hider-1" | "hider-2" | "oni";
export type Order = "creator" | "second" | "third";
export type Moment =
	| "waiting"
	| "counting"
	| "preparation"
	| "painting"
	| "exploration"
	| "reveal"
	/** 結果が確定したあと、ルームが閉じる前（issue-70）。 */
	| "ended";

/** ルーム作成の設定の cpu の値（サーバーの room.gleam と揃える）。 */
export const CPU_SETTING: Readonly<Record<CpuSetup, number>> = {
	none: 0,
	"hider-1": 1,
	"hider-2": 2,
	oni: 4,
};

const CPU_COUNT: Readonly<Record<CpuSetup, number>> = {
	none: 0,
	"hider-1": 1,
	"hider-2": 2,
	oni: 1,
};

const CPU_LABEL: Readonly<Record<CpuSetup, string>> = {
	none: "CPU なし",
	"hider-1": "隠れ側 CPU 1 体",
	"hider-2": "隠れ側 CPU 2 体",
	oni: "鬼 CPU",
};

const ORDER_LABEL: Readonly<Record<Order, string>> = {
	creator: "作った人",
	second: "2 人目",
	third: "3 人目",
};

export const MOMENT_LABEL: Readonly<Record<Moment, string>> = {
	waiting: "待機",
	counting: "カウント中",
	preparation: "準備移動",
	painting: "ペイント",
	exploration: "探索",
	reveal: "答え合わせ",
	ended: "結果のあと",
};

/** サーバーのフェーズの名前（phase の通知の phase）。 */
export const MOMENT_PHASE: Readonly<Record<Moment, string>> = {
	waiting: "oni-selection",
	counting: "oni-selection",
	preparation: "preparation",
	painting: "painting",
	exploration: "exploration",
	reveal: "reveal",
	ended: "ended",
};

export interface JoinCase {
	readonly name: string;
	readonly cpu: CpuSetup;
	readonly order: Order;
	readonly moment: Moment;
	/** 参加の直前のエリアの色（鬼選出の間だけ）。 */
	readonly areaBefore: "waiting" | "ready" | "counting" | null;
	/** same-state: 最初の参加者と同じ状態が届く。refused: サーバーが断る（game-already-started）。 */
	readonly outcome: "same-state" | "refused";
	/** ルーム作成の設定の stage（0 = ふつうだけ、3 = 広い屋敷だけ / issue-65）。 */
	readonly stage: number;
	/** 届くべき、いちばん新しいルーム情報の探索時間（秒）。広い屋敷は、既定の 40 秒に +80 秒。 */
	readonly explorationSeconds: number;
}

/** ルーム作成の探索時間の既定（秒。サーバーの room.gleam の default_exploration_seconds）。 */
export const DEFAULT_EXPLORATION_SECONDS = 40;

/** 広い屋敷で、探索の時間に足す秒数（サーバーの stage_timing.wide_extra_exploration_seconds）。 */
export const WIDE_EXTRA_EXPLORATION_SECONDS = 80;

const MOMENTS: readonly Moment[] = [
	"waiting",
	"counting",
	"preparation",
	"painting",
	"exploration",
	"reveal",
	"ended",
];

/** 実際に起こりうる組み合わせ。 */
export function joinCases(): JoinCase[] {
	const cases: JoinCase[] = [];
	for (const cpu of ["none", "hider-1", "hider-2", "oni"] as const) {
		cases.push({
			name: `${CPU_LABEL[cpu]}・${ORDER_LABEL.creator}・${MOMENT_LABEL.waiting}`,
			cpu,
			order: "creator",
			moment: "waiting",
			areaBefore: null,
			outcome: "same-state",
			stage: 0,
			explorationSeconds: DEFAULT_EXPLORATION_SECONDS,
		});
		for (const order of ["second", "third"] as const) {
			// 参加の直前にいる人数（人間と CPU。CPU も人数に数える）。
			const before = (order === "second" ? 1 : 2) + CPU_COUNT[cpu];
			for (const moment of MOMENTS) {
				// カウントも、鬼選出の後も、2 人以上でなければ起こらない。
				if (moment !== "waiting" && before < 2) continue;
				const selecting = moment === "waiting" || moment === "counting";
				cases.push({
					name: `${CPU_LABEL[cpu]}・${ORDER_LABEL[order]}・${MOMENT_LABEL[moment]}`,
					cpu,
					order,
					moment,
					areaBefore:
						moment === "counting"
							? "counting"
							: moment === "waiting"
								? before >= 2
									? "ready"
									: "waiting"
								: null,
					outcome: selecting ? "same-state" : "refused",
					stage: 0,
					explorationSeconds: DEFAULT_EXPLORATION_SECONDS,
				});
			}
		}
	}
	return cases;
}

/**
 * 広い屋敷（issue-65）の構成を 1 つ。CPU なしの組み合わせ（joinCases と同じ順番・時機）を、広い屋敷だけ
 * （stage 3）のルームで回す。広い屋敷では、骨格が決まったときに、ルーム情報の探索時間が +80 秒で
 * 送り直されるので、途中参加・復帰の人にも、その値が届くことを確かめる。サーバーは RONDO_WIDE_DEV=1 で
 * 動かす（tools/load.sh）。
 */
export function wideJoinCases(): JoinCase[] {
	return joinCases()
		.filter((c) => c.cpu === "none")
		.map((c) => ({
			...c,
			name: `広い屋敷・${c.name}`,
			stage: 3,
			explorationSeconds:
				DEFAULT_EXPLORATION_SECONDS + WIDE_EXTRA_EXPLORATION_SECONDS,
		}));
}

/** いちばん新しいルーム情報（room-info）の探索時間（秒）。届いていなければ null。 */
export function latestExplorationSeconds(
	payloads: readonly unknown[],
): number | null {
	for (let i = payloads.length - 1; i >= 0; i--) {
		const p = payloads[i];
		if (
			isRecord(p) &&
			p.type === "room-info" &&
			typeof p.explorationSeconds === "number"
		) {
			return p.explorationSeconds;
		}
	}
	return null;
}

/**
 * その時機（フェーズ）に、購読者へ届くべき状態の種類（名前の順）。
 *
 * atCreation は、作った人の、作成の時点（まだ 1 人だけ）。メンバーの通知は、変わったときだけ送る
 * （ADR 0044）ので、作成の時点では届かない。作った人しか載らない一覧で、画面は自分を除くので、
 * 届いても空と同じ。2 人目が入ると、作った人にも、2 人が載ったメンバーの通知が届く（join.ts と、
 * サーバーの join_snapshot_test で確かめる）。
 */
export function expectedKinds(
	phase: string,
	options: { readonly atCreation?: boolean } = {},
): string[] {
	const always = ["doors", "phase", "room-info", "stage"];
	const extra =
		phase === "oni-selection"
			? options.atCreation === true
				? []
				: ["members"]
			: phase === "exploration" || phase === "reveal"
				? ["hiders", "hiding", "oni"]
				: [];
	return [...always, ...extra].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function typeOf(payload: unknown): string | null {
	return isRecord(payload) && typeof payload.type === "string"
		? payload.type
		: null;
}

export interface PhaseView {
	readonly phase: string;
	readonly area: string | null;
	readonly oni: string | null;
}

/** 最後に届いたフェーズの通知の、フェーズ・エリア・鬼。届いていなければ null。 */
export function latestPhase(payloads: readonly unknown[]): PhaseView | null {
	for (let i = payloads.length - 1; i >= 0; i--) {
		const p = payloads[i];
		if (isRecord(p) && p.type === "phase" && typeof p.phase === "string") {
			return {
				phase: p.phase,
				area: typeof p.area === "string" ? p.area : null,
				oni: typeof p.oni === "string" ? p.oni : null,
			};
		}
	}
	return null;
}

const show = (view: PhaseView | null): string =>
	view === null
		? "なし"
		: `${view.phase}/${view.area ?? "-"}/${view.oni ?? "-"}`;

/**
 * 参加（か復帰）した人に届いた通知 arrived を、最初の参加者に届いた通知 reference と比べる。
 * 届いた最後のフェーズの時機に、届くべき種類がそろい、フェーズの中身（フェーズ・エリア・鬼）が
 * 最初の参加者の最後のものと同じか。問題の一覧を返す（無ければ空）。
 */
export function judgeArrival(input: {
	readonly arrived: readonly unknown[];
	readonly reference: readonly unknown[];
	/** 作った人の、作成の時点（expectedKinds の atCreation）。 */
	readonly atCreation?: boolean;
	/** あれば、いちばん新しいルーム情報の探索時間が、この秒数か（issue-65）。 */
	readonly explorationSeconds?: number;
}): string[] {
	const problems: string[] = [];
	const mine = latestPhase(input.arrived);
	const theirs = latestPhase(input.reference);
	const kinds = new Set(input.arrived.map(typeOf));
	const expected = expectedKinds(
		mine?.phase ?? theirs?.phase ?? "oni-selection",
		{ atCreation: input.atCreation === true },
	);
	const missing = expected.filter((kind) => !kinds.has(kind));
	if (missing.length > 0)
		problems.push(`届いていない種類: ${missing.join(", ")}`);
	if (show(mine) !== show(theirs)) {
		problems.push(
			`フェーズの中身が違う: 届いた ${show(mine)}・最初の参加者 ${show(theirs)}`,
		);
	}
	if (input.explorationSeconds !== undefined) {
		const seconds = latestExplorationSeconds(input.arrived);
		if (seconds !== input.explorationSeconds) {
			problems.push(
				`ルーム情報の探索時間が違う: 届いた ${seconds ?? "なし"}・${input.explorationSeconds} 秒のはず`,
			);
		}
	}
	return problems;
}

/**
 * 結果のあとに戻った人へ、結果（game-ended）が、閉じるまでの残り（closesInMs。0 より大きい数）つきで
 * 送り直されたか（issue-70）。messages は、届いた電文（エンベロープ）。問題が無ければ空。
 */
export function resentResult(messages: readonly unknown[]): string[] {
	const ended = messages.filter(
		(m) => isRecord(m) && m.type === "game-ended",
	) as Record<string, unknown>[];
	if (ended.length === 0) return ["結果（game-ended）が送り直されない"];
	const last = ended[ended.length - 1];
	const closesInMs = last?.closesInMs;
	return typeof closesInMs === "number" && closesInMs > 0
		? []
		: ["結果に、閉じるまでの残り（closesInMs）が無い"];
}

/** 最後に届いたメンバーの通知に、ids の全員が載っているか。メンバーの通知が無ければ false。 */
export function membersListed(
	payloads: readonly unknown[],
	ids: readonly string[],
): boolean {
	const last = [...payloads].reverse().find((p) => typeOf(p) === "members");
	if (!isRecord(last) || !Array.isArray(last.members)) return false;
	const listed = new Set(
		last.members.flatMap((m: unknown) =>
			isRecord(m) && typeof m.playerId === "string" ? [m.playerId] : [],
		),
	);
	return ids.every((id) => listed.has(id));
}
