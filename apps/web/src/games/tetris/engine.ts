/**
 * テトリスの純粋なゲームロジック（ADR 0004 のソロゲーム本体）。
 *
 * DOM・React・乱数の副作用を持たず、状態 -> 状態の純粋関数だけで盤面規則を表す。
 * 判定ロジックはテストファーストで扱う方針のため、描画や入力から切り離す。
 * 乱数は seed を状態に持ち、同じ seed からは同じ列が出る（テストで固定できる）。
 */

/** 盤面の幅（列）。 */
export const WIDTH = 10;
/** 盤面の高さ（行）。 */
export const HEIGHT = 20;

/** テトリミノの種類。色分けと形の識別を兼ねる。 */
export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

/** 盤面のセル。空は null、埋まっていれば由来のピース種別を持つ。 */
export type Cell = PieceType | null;

/** 落下中のピース。matrix の左上を (x, y) として盤面に重ねる。y は負（盤面上端より上）を許す。 */
export interface Piece {
	readonly type: PieceType;
	readonly rotation: number;
	readonly x: number;
	readonly y: number;
}

/** ゲーム全体の状態。すべて不変。操作関数は新しい状態を返す。 */
export interface GameState {
	readonly board: readonly (readonly Cell[])[];
	readonly current: Piece;
	readonly next: PieceType;
	readonly bag: readonly PieceType[];
	readonly seed: number;
	readonly score: number;
	readonly lines: number;
	readonly level: number;
	readonly gameOver: boolean;
}

/** 消したライン数ごとの得点。level を掛けて加算する。 */
const LINE_SCORES = [0, 100, 300, 500, 800] as const;

const ALL_TYPES: readonly PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

/** 各ピースの回転 0 の形。1 が埋まりを表す。正方行列で持ち、回転は行列を回す。 */
const SHAPES: Record<PieceType, readonly (readonly number[])[]> = {
	I: [
		[0, 0, 0, 0],
		[1, 1, 1, 1],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
	],
	O: [
		[1, 1],
		[1, 1],
	],
	T: [
		[0, 1, 0],
		[1, 1, 1],
		[0, 0, 0],
	],
	S: [
		[0, 1, 1],
		[1, 1, 0],
		[0, 0, 0],
	],
	Z: [
		[1, 1, 0],
		[0, 1, 1],
		[0, 0, 0],
	],
	J: [
		[1, 0, 0],
		[1, 1, 1],
		[0, 0, 0],
	],
	L: [
		[0, 0, 1],
		[1, 1, 1],
		[0, 0, 0],
	],
};

/** 行列を時計回りに 90 度回す。 */
function rotateCW(matrix: readonly (readonly number[])[]): number[][] {
	const size = matrix.length;
	const width = matrix[0]?.length ?? 0;
	const out: number[][] = [];
	for (let x = 0; x < width; x++) {
		const row: number[] = [];
		for (let y = size - 1; y >= 0; y--) {
			row.push(matrix[y]?.[x] ?? 0);
		}
		out.push(row);
	}
	return out;
}

/** 種別と回転から形の行列を得る。 */
function matrixFor(type: PieceType, rotation: number): number[][] {
	let matrix: number[][] = SHAPES[type].map((row) => [...row]);
	const times = ((rotation % 4) + 4) % 4;
	for (let i = 0; i < times; i++) {
		matrix = rotateCW(matrix);
	}
	return matrix;
}

/** ピースが盤面上で占めるセルの絶対座標。 */
function cellsOf(piece: Piece): { x: number; y: number }[] {
	const matrix = matrixFor(piece.type, piece.rotation);
	const cells: { x: number; y: number }[] = [];
	for (let r = 0; r < matrix.length; r++) {
		const row = matrix[r] ?? [];
		for (let c = 0; c < row.length; c++) {
			if (row[c]) cells.push({ x: piece.x + c, y: piece.y + r });
		}
	}
	return cells;
}

/** ピースが壁・床・既存ブロックと衝突するか。上端より上（y < 0）は衝突扱いにしない。 */
function collides(board: readonly (readonly Cell[])[], piece: Piece): boolean {
	for (const { x, y } of cellsOf(piece)) {
		if (x < 0 || x >= WIDTH || y >= HEIGHT) return true;
		if (y >= 0 && board[y]?.[x]) return true;
	}
	return false;
}

function emptyBoard(): Cell[][] {
	return Array.from({ length: HEIGHT }, () =>
		Array.from({ length: WIDTH }, () => null as Cell),
	);
}

/** seed から次の乱数（0..1）と後続 seed を返す（mulberry32）。 */
function nextRandom(seed: number): { value: number; seed: number } {
	let s = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(s ^ (s >>> 15), 1 | s);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	s = t | 0;
	return { value, seed: s };
}

/** 7 種を 1 巡ずつ含む袋を、seed で決まる順に並べて返す（7-bag）。 */
function refillBag(seed: number): { bag: PieceType[]; seed: number } {
	const bag = [...ALL_TYPES];
	let s = seed;
	for (let i = bag.length - 1; i > 0; i--) {
		const r = nextRandom(s);
		s = r.seed;
		const j = Math.floor(r.value * (i + 1));
		const a = bag[i] ?? "I";
		const b = bag[j] ?? "I";
		bag[i] = b;
		bag[j] = a;
	}
	return { bag, seed: s };
}

/** 袋から 1 つ引く。空なら詰め直してから引く。 */
function draw(
	bag: readonly PieceType[],
	seed: number,
): { type: PieceType; bag: PieceType[]; seed: number } {
	let current = [...bag];
	let s = seed;
	if (current.length === 0) {
		const filled = refillBag(s);
		current = filled.bag;
		s = filled.seed;
	}
	const type = current[0] ?? "I";
	return { type, bag: current.slice(1), seed: s };
}

/** 種別から、盤面上端の中央に置いた初期ピースを作る。 */
function spawnPiece(type: PieceType): Piece {
	const size = SHAPES[type].length;
	return { type, rotation: 0, x: Math.floor((WIDTH - size) / 2), y: 0 };
}

/** 新しいゲームを作る。seed を省くと実行ごとに変わる。 */
export function createGame(seed: number = Date.now()): GameState {
	const first = draw([], seed);
	const second = draw(first.bag, first.seed);
	return {
		board: emptyBoard(),
		current: spawnPiece(first.type),
		next: second.type,
		bag: second.bag,
		seed: second.seed,
		score: 0,
		lines: 0,
		level: 1,
		gameOver: false,
	};
}

function tryShift(state: GameState, dx: number, dy: number): GameState | null {
	const moved: Piece = {
		...state.current,
		x: state.current.x + dx,
		y: state.current.y + dy,
	};
	if (collides(state.board, moved)) return null;
	return { ...state, current: moved };
}

/** 左へ 1。壁・ブロックに当たれば動かさない。 */
export function moveLeft(state: GameState): GameState {
	if (state.gameOver) return state;
	return tryShift(state, -1, 0) ?? state;
}

/** 右へ 1。壁・ブロックに当たれば動かさない。 */
export function moveRight(state: GameState): GameState {
	if (state.gameOver) return state;
	return tryShift(state, 1, 0) ?? state;
}

/**
 * 1 段落とす。重力（自動落下）とソフトドロップの両方に使う。
 * これ以上落とせなければ、その場で固定して次のピースへ進める。
 */
export function step(state: GameState): GameState {
	if (state.gameOver) return state;
	return tryShift(state, 0, 1) ?? lockAndAdvance(state);
}

/** 時計回りに回転。当たる場合は左右に寄せて入るか試す（簡易ウォールキック）。 */
export function rotate(state: GameState): GameState {
	if (state.gameOver) return state;
	const rotated: Piece = {
		...state.current,
		rotation: (state.current.rotation + 1) % 4,
	};
	for (const dx of [0, -1, 1, -2, 2]) {
		const kicked: Piece = { ...rotated, x: rotated.x + dx };
		if (!collides(state.board, kicked)) return { ...state, current: kicked };
	}
	return state;
}

/** 一気に底まで落として固定する。 */
export function hardDrop(state: GameState): GameState {
	if (state.gameOver) return state;
	let piece = state.current;
	let distance = 0;
	while (!collides(state.board, { ...piece, y: piece.y + 1 })) {
		piece = { ...piece, y: piece.y + 1 };
		distance += 1;
	}
	return lockAndAdvance({
		...state,
		current: piece,
		score: state.score + distance * 2,
	});
}

/** 現在ピースを盤面に固定し、ライン消去・加点をして次のピースを出す。 */
function lockAndAdvance(state: GameState): GameState {
	const board: Cell[][] = state.board.map((row) => [...row]);
	for (const { x, y } of cellsOf(state.current)) {
		if (y < 0 || y >= HEIGHT || x < 0 || x >= WIDTH) continue;
		const row = board[y];
		if (row) row[x] = state.current.type;
	}

	const { cleared, board: cleaned } = clearLines(board);
	const lines = state.lines + cleared;
	const score = state.score + (LINE_SCORES[cleared] ?? 0) * state.level;
	const level = 1 + Math.floor(lines / 10);

	const spawned = spawnPiece(state.next);
	const drawn = draw(state.bag, state.seed);
	const advanced: GameState = {
		...state,
		board: cleaned,
		current: spawned,
		next: drawn.type,
		bag: drawn.bag,
		seed: drawn.seed,
		score,
		lines,
		level,
	};
	if (collides(cleaned, spawned)) return { ...advanced, gameOver: true };
	return advanced;
}

/** 埋まった行を消し、消した数だけ空行を上に足す。 */
function clearLines(board: Cell[][]): { cleared: number; board: Cell[][] } {
	const kept = board.filter((row) => row.some((cell) => cell === null));
	const cleared = HEIGHT - kept.length;
	const empties: Cell[][] = Array.from({ length: cleared }, () =>
		Array.from({ length: WIDTH }, () => null as Cell),
	);
	return { cleared, board: [...empties, ...kept] };
}

/**
 * 描画のために、現在ピースを重ねた盤面のスナップショットを返す。
 * ゲームオーバー時は落下ピースを重ねない。
 */
export function renderBoard(state: GameState): readonly (readonly Cell[])[] {
	const board: Cell[][] = state.board.map((row) => [...row]);
	if (!state.gameOver) {
		for (const { x, y } of cellsOf(state.current)) {
			if (y < 0 || y >= HEIGHT || x < 0 || x >= WIDTH) continue;
			const row = board[y];
			if (row) row[x] = state.current.type;
		}
	}
	return board;
}

/** level に応じた自動落下の間隔（ミリ秒）。上がるほど速くなる。 */
export function gravityInterval(level: number): number {
	return Math.max(90, 800 - (level - 1) * 80);
}
