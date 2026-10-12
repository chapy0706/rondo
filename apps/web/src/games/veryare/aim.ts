/**
 * 鬼の狙い（issue-46 の続き）。three を使わない。
 *
 * 狙う場所は、画面のタップで決める。タップした点からカメラを通る線を引き、最初に当たったもの
 * （隠れ側の体、壁、床）の位置を「狙う点」として、世界の座標で持つ（線と壁・床の当たりは scene.ts が
 * three で求め、線と体の当たりは、ここの rayHitsBody で求める）。撃つときは、狙う点にいる隠れ側を
 * 申告する（いなければ null。外れでも、間隔はこれまでどおり始まる）。狙う点がまだ無ければ、これまで
 * どおり画面の中央を狙う。射程・見通し・間隔はサーバーが判定する（契約は変えない）。
 *
 * タップとドラッグは、指（pointerId）ごとに分ける。短く、あまり動かないものだけをタップとする。
 */

/** タップとみなす、押してから離すまでの時間の上限（ミリ秒）。 */
export const TAP_MAX_MS = 300;
/** タップとみなす、押してから動いた量の上限（画面の px）。 */
export const TAP_MAX_MOVE_PX = 12;

/** 体（足もと feet から高さ 1 m、半径 0.2 m の円柱。体の描き込み面と同じ大きさ）。 */
const BODY_RADIUS = 0.2;
const BODY_HEIGHT = 1;
/** 狙う点が体の中かを決めるときの、表面からの余裕（メートル）。 */
export const AIM_TOLERANCE = 0.05;

export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface ScreenPoint {
	readonly x: number;
	readonly y: number;
}

/** 隠れ側の体の位置（足もとの高さを含む）。 */
export interface BodyAt {
	readonly id?: string;
	readonly x: number;
	readonly z: number;
	readonly feet: number;
}

export interface TapTracker {
	down(id: number, at: ScreenPoint, time: number): void;
	move(id: number, at: ScreenPoint): void;
	/** 離したとき。タップなら true。 */
	up(id: number, at: ScreenPoint, time: number): boolean;
	cancel(id: number): void;
}

/** 指ごとに、押した時刻と位置、動いた量の最大を持つ。 */
export function createTapTracker(): TapTracker {
	const touches = new Map<
		number,
		{ start: ScreenPoint; time: number; moved: number }
	>();
	const distance = (p: ScreenPoint, q: ScreenPoint) =>
		Math.hypot(p.x - q.x, p.y - q.y);
	return {
		down(id, at, time) {
			touches.set(id, { start: at, time, moved: 0 });
		},
		move(id, at) {
			const touch = touches.get(id);
			if (touch !== undefined) {
				touch.moved = Math.max(touch.moved, distance(touch.start, at));
			}
		},
		up(id, at, time) {
			const touch = touches.get(id);
			touches.delete(id);
			if (touch === undefined) return false;
			const moved = Math.max(touch.moved, distance(touch.start, at));
			return time - touch.time <= TAP_MAX_MS && moved <= TAP_MAX_MOVE_PX;
		},
		cancel(id) {
			touches.delete(id);
		},
	};
}

/** 画面の点を、-1〜1 の座標（three の setFromCamera の形）にする。 */
export function toNdc(
	at: ScreenPoint,
	rect: { left: number; top: number; width: number; height: number },
): ScreenPoint {
	return {
		x: ((at.x - rect.left) / rect.width) * 2 - 1,
		y: 1 - ((at.y - rect.top) / rect.height) * 2,
	};
}

/**
 * 線（origin から direction の向き）が、体の円柱に最初に当たる位置（direction の何倍か）。当たらな
 * ければ null。側面と、上下の面を見る（上から斜めに当たる場合も拾う）。
 */
export function rayHitsBody(
	origin: Vec3,
	direction: Vec3,
	body: BodyAt,
): number | null {
	const ox = origin.x - body.x;
	const oz = origin.z - body.z;
	const bottom = body.feet;
	const top = body.feet + BODY_HEIGHT;
	const hits: number[] = [];
	const a = direction.x * direction.x + direction.z * direction.z;
	if (a > 0) {
		const b = 2 * (ox * direction.x + oz * direction.z);
		const c = ox * ox + oz * oz - BODY_RADIUS * BODY_RADIUS;
		const disc = b * b - 4 * a * c;
		if (disc >= 0) {
			const root = Math.sqrt(disc);
			for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
				const y = origin.y + direction.y * t;
				if (t > 0 && y >= bottom && y <= top) hits.push(t);
			}
		}
	}
	if (direction.y !== 0) {
		for (const plane of [bottom, top]) {
			const t = (plane - origin.y) / direction.y;
			const x = ox + direction.x * t;
			const z = oz + direction.z * t;
			if (t > 0 && x * x + z * z <= BODY_RADIUS * BODY_RADIUS) hits.push(t);
		}
	}
	return hits.length === 0 ? null : Math.min(...hits);
}

/** 狙う点にいる隠れ側（体の円柱の中。表面から AIM_TOLERANCE まで）。いなければ null。 */
export function hiderAt(
	point: Vec3,
	hiders: readonly (BodyAt & { readonly id: string })[],
): string | null {
	for (const hider of hiders) {
		const horizontal = Math.hypot(point.x - hider.x, point.z - hider.z);
		if (
			horizontal <= BODY_RADIUS + AIM_TOLERANCE &&
			point.y >= hider.feet - AIM_TOLERANCE &&
			point.y <= hider.feet + BODY_HEIGHT + AIM_TOLERANCE
		) {
			return hider.id;
		}
	}
	return null;
}

/** 撃つときの相手。狙う点があればそこにいる隠れ側、無ければ画面の中央（center）。 */
export function shotTarget(
	aim: Vec3 | null,
	hiders: readonly (BodyAt & { readonly id: string })[],
	center: () => string | null,
): string | null {
	return aim === null ? center() : hiderAt(aim, hiders);
}

/** 開発中だけ Console に出す、申告の1行。 */
export function shotMessage(shot: {
	readonly target: string | null;
	readonly aim: Vec3 | null;
}): string {
	const how =
		shot.aim === null
			? "画面の中央"
			: `狙う点 ${shot.aim.x.toFixed(2)}, ${shot.aim.y.toFixed(2)}, ${shot.aim.z.toFixed(2)}`;
	return `[veryare-shoot] 申告を送った: target=${shot.target ?? "null"}（${how}）`;
}
