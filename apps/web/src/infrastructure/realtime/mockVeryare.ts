/**
 * モック用の veryare の台本（開発・動作確認用）。
 *
 * サーバー（server/src/rondo_server/games/veryare/）のフェーズ判定は再実装しない。
 * 「何ミリ秒後に、どの通知を送るか」を固定の台本として並べるだけの、時間で進む簡易な
 * 模擬である。通知の形（phase / room-info）はサーバーの room.gleam に揃える。
 * 鬼は乱数ではなく固定順で決め、自分が鬼の回と隠れ側の回を交互に試せるようにする。
 * 鬼希望エリアの色（赤・待機 → 緑・開始 → 青・鬼希望）も、位置を見ずに時刻で進める
 * （自分がエリアに入っても台本は変わらない）。
 * 発見（issue-27）がまだないため、終わり方は常に「探索の時間切れで隠れ側の勝ち」で、
 * 答え合わせタイム（20秒）を経て終了する。
 *
 * CPU（ADR 0038 / issue-33）を選ぶと、仮のプレイヤーの代わりに CPU N を参加させる。
 * 隠れ側 CPU のときは自分が鬼、鬼 CPU のときは CPU 1 が鬼になる。探索開始時には、
 * 隠れ側の状態の一括配信（type: "hiders"）を、サーバーと同じ形で送る。
 */

import type {
	PlayerId,
	PlayerInfo,
	RoomId,
	ServerMessage,
} from "@rondo/contracts";

export const VERYARE = "veryare";

/** 固定で参加させる仮のプレイヤー。 */
export const MOCK_BOTS: readonly PlayerInfo[] = [
	{ playerId: "bot-1", name: "bot1" },
	{ playerId: "bot-2", name: "bot2" },
	{ playerId: "bot-3", name: "bot3" },
];

/** CPU の選択肢の値。0 = なし、1〜3 = 隠れ側 CPU の数、4 = 鬼 CPU。 */
const ONI_CPU = 4;

/** 隠れ CPU の仮の状態（サーバーでは部屋のマスと代表色から決まる）。 */
const MOCK_CPU_COLOR = "#b5a46a";

/** 作成時の設定から CPU の選択を取り出す。省略時はなし。 */
export function cpuOf(
	settings: Readonly<Record<string, number>> | undefined,
): number {
	return settings?.cpu ?? 0;
}

/** 自分以外の参加者。CPU を選べば CPU N、選ばなければ仮のプレイヤー。 */
export function mockPlayersOf(cpu: number): readonly PlayerInfo[] {
	const count = cpu === ONI_CPU ? 1 : cpu;
	if (count <= 0) return MOCK_BOTS;
	return Array.from({ length: count }, (_, i) => ({
		playerId: `cpu-${i + 1}`,
		name: `CPU ${i + 1}`,
	}));
}

/** 探索時間の既定値（秒）。ルーム作成時に選ばれなかったとき。 */
const DEFAULT_EXPLORATION_SECONDS = 40;

/** 各フェーズの長さ（ミリ秒）。サーバーの game.gleam の値に揃えた模擬用の値。 */
const ONI_SELECTION_MS = 10_000;
const PREPARATION_MS = 20_000;
const PAINTING_MS = 20_000;
const REVEAL_MS = 20_000;

/** 鬼選出の見た目の台本。赤（1人の想定）→ 緑（そろった想定）→ 青（誰かが触れた想定）。 */
const READY_AT_MS = 3_000;
const COUNTING_AT_MS = 6_000;

export interface ScriptedMessage {
	/** 台本の開始からの経過時間。 */
	readonly afterMs: number;
	readonly message: ServerMessage;
}

/** 作成時の設定から探索時間を取り出す。省略時は既定値。 */
export function explorationSecondsOf(
	settings: Readonly<Record<string, number>> | undefined,
): number {
	return settings?.explorationSeconds ?? DEFAULT_EXPLORATION_SECONDS;
}

/** 1回分の台本。入室後の案内に続けて、フェーズ通知を決まった時刻に並べる。 */
export function veryareScript(options: {
	readonly roomId: RoomId;
	readonly self: PlayerId;
	readonly selfIsOni: boolean;
	readonly explorationSeconds: number;
	/** CPU の選択（省略時はなし）。 */
	readonly cpu?: number;
}): ScriptedMessage[] {
	const { roomId, self, selfIsOni, explorationSeconds } = options;
	const cpu = options.cpu ?? 0;
	const others = mockPlayersOf(cpu);
	// 鬼 CPU なら CPU 1。隠れ側 CPU は鬼にならないので自分。どちらも無ければ交互。
	const oni =
		cpu === ONI_CPU
			? (others[0]?.playerId ?? self)
			: cpu > 0 || selfIsOni
				? self
				: (others[0]?.playerId ?? self);
	const hiders = [self, ...others.map((p) => p.playerId)]
		.filter((id) => id !== oni)
		.map((id, index) =>
			id.startsWith("cpu-")
				? {
						playerId: id,
						x: 1.5 + index,
						z: 2.5,
						facing: 0,
						pose: "standing",
						paint: { kind: "uniform", color: MOCK_CPU_COLOR },
					}
				: { playerId: id, x: 0, z: 0, facing: null, pose: null, paint: null },
		);
	const explorationMs = explorationSeconds * 1000;

	const state = (payload: unknown): ServerMessage => ({
		type: "game-state",
		gameType: VERYARE,
		roomId,
		payload,
	});
	const phase = (
		name: string,
		durationMs: number | null,
		chosen: PlayerId | null,
		outcome: string | null = null,
		area: string | null = null,
	) =>
		state({
			type: "phase",
			phase: name,
			durationMs,
			oni: chosen,
			outcome,
			area,
		});

	const preparationAt = COUNTING_AT_MS + ONI_SELECTION_MS;
	const paintingAt = preparationAt + PREPARATION_MS;
	const explorationAt = paintingAt + PAINTING_MS;
	const revealAt = explorationAt + explorationMs;
	const endedAt = revealAt + REVEAL_MS;

	return [
		{ afterMs: 0, message: state({ type: "room-info", explorationSeconds }) },
		{
			afterMs: 0,
			message: phase("oni-selection", null, null, null, "waiting"),
		},
		{
			afterMs: READY_AT_MS,
			message: phase("oni-selection", null, null, null, "ready"),
		},
		{
			afterMs: COUNTING_AT_MS,
			message: phase("oni-selection", ONI_SELECTION_MS, null, null, "counting"),
		},
		{
			afterMs: preparationAt,
			message: phase("preparation", PREPARATION_MS, oni),
		},
		{ afterMs: paintingAt, message: phase("painting", PAINTING_MS, oni) },
		{
			afterMs: explorationAt,
			message: phase("exploration", explorationMs, oni),
		},
		// 探索の開始と同時に、隠れ側の状態を一括で送る（ADR 0025 / 0035）。
		{ afterMs: explorationAt, message: state({ type: "hiders", hiders }) },
		{
			afterMs: revealAt,
			message: phase("reveal", REVEAL_MS, oni, "hiders-win"),
		},
		{ afterMs: endedAt, message: phase("ended", null, oni, "hiders-win") },
	];
}

/** これまでに始めた veryare の回数。ゲームに入るたびにアダプタが作り直されるため、モジュールで数える。 */
let plays = 0;

/** 次の回で自分が鬼か。1回目は自分、2回目は仮のプレイヤー、以降交互。 */
export function nextSelfIsOni(): boolean {
	const selfIsOni = plays % 2 === 0;
	plays += 1;
	return selfIsOni;
}
