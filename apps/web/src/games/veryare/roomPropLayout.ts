/**
 * ランダム間取りの和室に置く小物の置き方（issue-72 第 1 段階 / ADR 0054）。純粋関数（three と React を
 * 使わない）。サーバーと契約は変えない（置き方は、届いた地図だけから、全員の画面で同じに決まる）。
 *
 * - 置く部屋: 和室系（和室・押し入れ付き・掛け軸付き）の大スロットだけ。押し入れ・廊下・縁側・玄関には
 *   置かない。平屋には置かない（すでに小物がある）
 * - 部屋の座標: u は襖のある辺に沿い、v は襖から奥へ（襖の反対側が奥）。部屋は矩形で、襖は 1 つ
 * - 型（種で選ぶ。左右の反転も種で選ぶ。置かない部屋も出す）:
 *   A 団らん: 奥の中ほどに、ちゃぶ台。両脇に座椅子 2 つ（ちゃぶ台を向く）。ちゃぶ台の上に湯呑み
 *   B 床の間の気配: 奥の隅に壺。手前の、襖から遠い側の隅に、座椅子 1 つ
 *   C 簡素: 奥の中ほどに、ちゃぶ台と、その上の湯呑み
 * - 守る条件: 壁から PROP_WALL_MARGIN 離す。床の小物どうしは重ねない。襖から部屋の中央までの通り道
 *   （幅 PROP_PATH_WIDTH。襖からまっすぐ奥へ、部屋の中ほどの深さで中央へ）をふさがない。条件に合わない
 *   小物は置かず、残りが 2 つより少なければ、その部屋には何も置かない
 * - 置く部屋の数は PROP_MAX_ROOMS まで（三角形の増えを抑える）。部屋の種の小さい順に選ぶ
 * - 部屋の種は、地図の文字列（行）と、部屋の文字から作る（同じ地図なら、全員で同じ）
 *
 * 小物の向き（turn）は、小物の正面（roomProps.ts の PROP_FRONT）が向く方向（0 は部屋の +v、1 は +u、2 は -v、
 * 3 は -u）。世界の座標では、y 軸まわりの回転 yaw（three の rotation.y）にする。
 */

import { isHirayaStage } from "./hiraya";
import { PROP_FRONT, PROP_SIZES, type PropKind } from "./roomProps";
import type { Cell, StageGrid } from "./stage";

/** 壁と小物の間（m）。 */
export const PROP_WALL_MARGIN = 0.3;
/** 襖から部屋の中央までの通り道の幅（m）。 */
export const PROP_PATH_WIDTH = 0.9;
/** 小物を置く部屋の数の上限（三角形の増えを、全体で PROP_TRIANGLE_BUDGET 以下にする）。 */
export const PROP_MAX_ROOMS = 12;
/** ちゃぶ台と、脇の座椅子の間（m）。 */
const CHAIR_GAP = 0.08;
/** 湯呑みの、ちゃぶ台の中心からのずれ（m）。 */
const CUP_OFFSET = { u: 0.2, v: 0.15 };

/** 型の選ばれ方（合計 1。残りは置かない部屋）。 */
const PATTERN_SHARES = { A: 0.375, B: 0.25, C: 0.25 } as const;
export type PropPattern = keyof typeof PATTERN_SHARES;

/** 和室系の部屋タイプ（stageMaterials.ts の WASHITSU と同じ）。 */
const WASHITSU = new Set(["washitsu", "washitsu-oshiire", "washitsu-kakejiku"]);

/** 部屋の形（部屋の座標。width は襖のある辺の長さ、depth は奥行き、door は襖の中心の u）。 */
export interface LocalRoom {
	readonly width: number;
	readonly depth: number;
	readonly door: number;
}

/** 部屋の座標の小物。y は置く高さ（床は 0。湯呑みは、ちゃぶ台の天板の高さ）。 */
export interface LocalProp {
	readonly kind: PropKind;
	readonly u: number;
	readonly v: number;
	readonly y: number;
	readonly turn: 0 | 1 | 2 | 3;
}

/** 軸にそろった矩形（部屋の座標では x = u、z = v）。 */
export interface Rect {
	readonly x0: number;
	readonly z0: number;
	readonly x1: number;
	readonly z1: number;
}

export interface RoomLayout {
	readonly pattern: PropPattern | null;
	readonly mirrored: boolean;
	readonly props: readonly LocalProp[];
}

/** 小物の、部屋の座標での半分の大きさ（u と v の向き）。小物の x（幅）が u に沿うかは、正面と向きで決まる。 */
export function halfExtents(
	kind: PropKind,
	turn: LocalProp["turn"],
): { readonly u: number; readonly v: number } {
	const size = PROP_SIZES[kind];
	const frontAlongV = turn % 2 === 0;
	const widthAlongU = PROP_FRONT[kind] === "z" ? frontAlongV : !frontAlongV;
	return widthAlongU
		? { u: size.width / 2, v: size.depth / 2 }
		: { u: size.depth / 2, v: size.width / 2 };
}

/** 小物の、上から見た矩形（部屋の座標）。 */
export function localFootprint(prop: LocalProp): Rect {
	const half = halfExtents(prop.kind, prop.turn);
	return {
		x0: prop.u - half.u,
		z0: prop.v - half.v,
		x1: prop.u + half.u,
		z1: prop.v + half.v,
	};
}

/** 襖から部屋の中央までの通り道（部屋の座標の矩形 2 つ: 奥へ向かう道と、中央へ曲がる道）。 */
export function pathRects(room: LocalRoom): readonly [Rect, Rect] {
	const half = PROP_PATH_WIDTH / 2;
	const middle = room.depth / 2;
	const center = room.width / 2;
	return [
		{
			x0: room.door - half,
			z0: 0,
			x1: room.door + half,
			z1: middle + half,
		},
		{
			x0: Math.min(room.door, center) - half,
			z0: middle - half,
			x1: Math.max(room.door, center) + half,
			z1: middle + half,
		},
	];
}

const EPS = 1e-9;
const overlaps = (a: Rect, b: Rect) =>
	Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > EPS &&
	Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > EPS;
const within = (inner: Rect, outer: Rect) =>
	inner.x0 >= outer.x0 - EPS &&
	inner.z0 >= outer.z0 - EPS &&
	inner.x1 <= outer.x1 + EPS &&
	inner.z1 <= outer.z1 + EPS;

/** 種 seed の k 番目の、0 以上 1 未満の値（決定的）。 */
function unit(seed: number, k: number): number {
	let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
	h = (h ^ (h >>> 16)) >>> 0;
	return h / 2 ** 32;
}

function pickPattern(value: number): PropPattern | null {
	let sum = 0;
	for (const pattern of ["A", "B", "C"] as const) {
		sum += PATTERN_SHARES[pattern];
		if (value < sum) return pattern;
	}
	return null;
}

/** 型の小物（反転の前）。ちゃぶ台は、奥の中ほど。 */
function template(
	pattern: PropPattern,
	room: LocalRoom,
	mirrored: boolean,
): LocalProp[] {
	const table = PROP_SIZES.chabudai;
	const tableAt = {
		u: room.width / 2,
		v: room.depth - PROP_WALL_MARGIN - table.depth / 2,
	};
	const cup = (sign: number): LocalProp => ({
		kind: "yunomi",
		u: tableAt.u + sign * CUP_OFFSET.u,
		v: tableAt.v + CUP_OFFSET.v,
		y: table.height,
		turn: 0,
	});
	const chabudai: LocalProp = { kind: "chabudai", ...tableAt, y: 0, turn: 0 };
	const sign = mirrored ? -1 : 1;
	switch (pattern) {
		case "A": {
			const reach = table.width / 2 + CHAIR_GAP + halfExtents("zaisu", 1).u;
			return [
				chabudai,
				{ kind: "zaisu", u: tableAt.u - reach, v: tableAt.v, y: 0, turn: 1 },
				{ kind: "zaisu", u: tableAt.u + reach, v: tableAt.v, y: 0, turn: 3 },
				cup(-sign),
			];
		}
		case "B": {
			const pot = halfExtents("tsubo", 0);
			const chair = halfExtents("zaisu", 0);
			// 壺は奥の隅（反転で左右を選ぶ）。座椅子は手前の、襖から遠い側の隅（奥を向く）。
			const potU = PROP_WALL_MARGIN + pot.u;
			const chairU = PROP_WALL_MARGIN + chair.u;
			const farFromDoor = room.door <= room.width / 2;
			return [
				{
					kind: "tsubo",
					u: mirrored ? room.width - potU : potU,
					v: room.depth - PROP_WALL_MARGIN - pot.v,
					y: 0,
					turn: 0,
				},
				{
					kind: "zaisu",
					u: farFromDoor ? room.width - chairU : chairU,
					v: PROP_WALL_MARGIN + chair.v,
					y: 0,
					turn: 0,
				},
			];
		}
		case "C":
			return [chabudai, cup(sign)];
	}
}

/** 条件（部屋の内側・重ならない・通り道をふさがない）に合う小物だけを残す。 */
function keepAllowed(
	room: LocalRoom,
	props: readonly LocalProp[],
): LocalProp[] {
	const bounds: Rect = {
		x0: PROP_WALL_MARGIN,
		z0: PROP_WALL_MARGIN,
		x1: room.width - PROP_WALL_MARGIN,
		z1: room.depth - PROP_WALL_MARGIN,
	};
	const paths = pathRects(room);
	const kept: LocalProp[] = [];
	for (const prop of props) {
		const rect = localFootprint(prop);
		if (prop.y > 0) {
			// 天板の上の小物は、置いたちゃぶ台の上に収まるときだけ。
			const table = kept.find((p) => p.kind === "chabudai");
			if (table !== undefined && within(rect, localFootprint(table))) {
				kept.push(prop);
			}
			continue;
		}
		if (!within(rect, bounds)) continue;
		if (paths.some((path) => overlaps(rect, path))) continue;
		if (
			kept.some(
				(other) => other.y === 0 && overlaps(rect, localFootprint(other)),
			)
		) {
			continue;
		}
		kept.push(prop);
	}
	return kept;
}

/** 1 部屋の置き方（種 seed で、型と左右の反転を選ぶ）。 */
export function layoutInRoom(room: LocalRoom, seed: number): RoomLayout {
	const pattern = pickPattern(unit(seed, 0));
	const mirrored = unit(seed, 1) < 0.5;
	if (pattern === null) return { pattern: null, mirrored, props: [] };
	const props = keepAllowed(room, template(pattern, room, mirrored));
	return props.length < 2
		? { pattern: null, mirrored, props: [] }
		: { pattern, mirrored, props };
}

/** 部屋の座標から世界の座標への写し（世界 = origin + u × U + v × V）。 */
export interface RoomFrame {
	readonly origin: { readonly x: number; readonly z: number };
	readonly u: { readonly x: number; readonly z: number };
	readonly v: { readonly x: number; readonly z: number };
}

export interface PropRoom {
	/** 部屋のスロットの文字。 */
	readonly id: string;
	readonly local: LocalRoom;
	readonly frame: RoomFrame;
}

const toWorld = (frame: RoomFrame, u: number, v: number) => ({
	x: frame.origin.x + u * frame.u.x + v * frame.v.x,
	z: frame.origin.z + u * frame.u.z + v * frame.v.z,
});

/** 部屋の座標の矩形の、世界の座標の矩形。 */
export function worldRect(frame: RoomFrame, rect: Rect): Rect {
	const a = toWorld(frame, rect.x0, rect.z0);
	const b = toWorld(frame, rect.x1, rect.z1);
	return {
		x0: Math.min(a.x, b.x),
		z0: Math.min(a.z, b.z),
		x1: Math.max(a.x, b.x),
		z1: Math.max(a.z, b.z),
	};
}

/**
 * 小物を置ける部屋（和室系で、矩形で、襖が 1 つ）。部屋の文字の順。平屋は無し。
 */
export function propRooms(grid: StageGrid): PropRoom[] {
	if (isHirayaStage(grid)) return [];
	const cells = new Map<string, Cell[]>();
	grid.rows.forEach((row, z) => {
		row.forEach((char, x) => {
			if (!WASHITSU.has(grid.rooms[char] ?? "")) return;
			const list = cells.get(char) ?? [];
			list.push({ x, z });
			cells.set(char, list);
		});
	});
	const size = grid.cellSize;
	const rooms: PropRoom[] = [];
	for (const id of [...cells.keys()].sort()) {
		const list = cells.get(id) as Cell[];
		const xs = list.map((c) => c.x);
		const zs = list.map((c) => c.z);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minZ = Math.min(...zs);
		const maxZ = Math.max(...zs);
		if ((maxX - minX + 1) * (maxZ - minZ + 1) !== list.length) continue;
		const mine = (c: Cell) => grid.charAt(c) === id;
		const doors = grid.doorList.filter((d) => mine(d.a) !== mine(d.b));
		const door = doors[0];
		if (door === undefined || doors.length !== 1) continue;
		const inner = mine(door.a) ? door.a : door.b;
		const outer = mine(door.a) ? door.b : door.a;
		const x0 = grid.origin.x + minX * size;
		const x1 = grid.origin.x + (maxX + 1) * size;
		const z0 = grid.origin.z + minZ * size;
		const z1 = grid.origin.z + (maxZ + 1) * size;
		const doorX = grid.origin.x + (inner.x + 0.5) * size;
		const doorZ = grid.origin.z + (inner.z + 0.5) * size;
		const alongX = outer.z !== inner.z;
		const frame: RoomFrame = alongX
			? {
					origin: { x: x0, z: outer.z < inner.z ? z0 : z1 },
					u: { x: 1, z: 0 },
					v: { x: 0, z: outer.z < inner.z ? 1 : -1 },
				}
			: {
					origin: { x: outer.x < inner.x ? x0 : x1, z: z0 },
					u: { x: 0, z: 1 },
					v: { x: outer.x < inner.x ? 1 : -1, z: 0 },
				};
		rooms.push({
			id,
			frame,
			local: alongX
				? { width: x1 - x0, depth: z1 - z0, door: doorX - x0 }
				: { width: z1 - z0, depth: x1 - x0, door: doorZ - z0 },
		});
	}
	return rooms;
}

/** 部屋の種（地図の行と、部屋の文字から。FNV-1a）。 */
export function roomSeed(grid: StageGrid, id: string): number {
	const text = `${grid.rows.map((row) => row.join("")).join("\n")}#${id}`;
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
	}
	return hash;
}

/**
 * 置いた小物（世界の座標）。yaw は y 軸まわりの回転（three の rotation.y。四半回転の倍数）。回転で、小物の
 * +z は (sin yaw, cos yaw)、+x は (cos yaw, -sin yaw) を向く。
 */
export interface PlacedProp {
	readonly room: string;
	readonly kind: PropKind;
	readonly x: number;
	readonly z: number;
	readonly y: number;
	readonly yaw: number;
}

/** 部屋の座標の向き（正面の向く方向）の、世界の yaw。部屋の座標が裏返し（鏡）でも、正面は向く方向を向く。 */
function worldYaw(
	frame: RoomFrame,
	kind: PropKind,
	turn: LocalProp["turn"],
): number {
	const local = [
		{ u: 0, v: 1 },
		{ u: 1, v: 0 },
		{ u: 0, v: -1 },
		{ u: -1, v: 0 },
	][turn] as { u: number; v: number };
	const x = local.u * frame.u.x + local.v * frame.v.x;
	const z = local.u * frame.u.z + local.v * frame.v.z;
	// 正面が +z の小物は +z を、+x の小物は +x を、(x, z) へ向ける。
	return PROP_FRONT[kind] === "z" ? Math.atan2(x, z) : Math.atan2(-z, x);
}

/** 置いた小物の、上から見た矩形（世界の座標。yaw は四半回転の倍数）。 */
export function worldFootprint(prop: PlacedProp): Rect {
	const size = PROP_SIZES[prop.kind];
	// 小物の x（幅）が、世界の x に沿うか（yaw が 0 か半回転）。
	const widthAlongX = Math.abs(Math.cos(prop.yaw)) > 0.5;
	const halfX = (widthAlongX ? size.width : size.depth) / 2;
	const halfZ = (widthAlongX ? size.depth : size.width) / 2;
	return {
		x0: prop.x - halfX,
		z0: prop.z - halfZ,
		x1: prop.x + halfX,
		z1: prop.z + halfZ,
	};
}

/** 地図の小物の置き方（部屋の文字の順）。 */
export function placeRoomProps(grid: StageGrid): PlacedProp[] {
	const chosen = propRooms(grid)
		.map((room) => {
			const seed = roomSeed(grid, room.id);
			return { room, seed, layout: layoutInRoom(room.local, seed) };
		})
		.filter((entry) => entry.layout.props.length > 0)
		.sort((a, b) => a.seed - b.seed || a.room.id.localeCompare(b.room.id))
		.slice(0, PROP_MAX_ROOMS)
		.sort((a, b) => a.room.id.localeCompare(b.room.id));
	return chosen.flatMap(({ room, layout }) =>
		layout.props.map((prop) => {
			const at = toWorld(room.frame, prop.u, prop.v);
			return {
				room: room.id,
				kind: prop.kind,
				x: at.x,
				z: at.z,
				y: prop.y,
				yaw: worldYaw(room.frame, prop.kind, prop.turn),
			};
		}),
	);
}
