import { describe, expect, it } from "vitest";
import {
	HUD_GAP,
	HUD_MARGIN,
	type HudInput,
	type HudPart,
	type HudRect,
	TAP_MIN,
	hudLayout,
} from "./hudLayout";
import { controlSizes, paintSheetMaxHeight } from "./viewLayout";

/**
 * iPhone の 5 つの大きさ（e2e/tests/layout.ts の LAYOUT_SIZES）の、3D の画面の大きさ。上部バーと
 * 状態の行（1 行で 88 px、2 行で 104 px）を除いた残り。
 */
const VIEWS = [
	{ name: "SE", width: 375, height: 553 },
	{ name: "12-14", width: 390, height: 675 },
	{ name: "15-16", width: 393, height: 682 },
	{ name: "Plus-ProMax", width: 430, height: 745 },
	{ name: "16Pro-全高", width: 402, height: 874 },
].flatMap((size) =>
	[88, 104].map((chrome) => ({
		name: `${size.name}（状態の行 ${chrome === 88 ? 1 : 2} 行）`,
		width: size.width,
		height: size.height - chrome,
	})),
);

/** 押す部品（高さと幅が 44 px 以上）。表示だけの部品（ポーズの名前・観戦の説明・板）は除く。 */
const TAPPABLE: readonly HudPart[] = [
	"pose",
	"oni-view",
	"roof",
	"settings",
	"sheet-open",
	"move-pad",
	"look-pad",
	"open-door",
	"shoot",
];

type Scene = Omit<HudInput, "width" | "height" | "pad" | "shoot">;

/** 重なりが出うる状態（動ける規則の隠れ側・鬼・従来の規則・観戦）。 */
const SCENES: readonly { readonly name: string; readonly scene: Scene }[] = [
	{
		name: "動ける規則・探索の隠れ側・板を閉じる・鬼の視点・ポーズ（素材の体）",
		scene: {
			top: HUD_MARGIN,
			row: ["pose", "oni-view"],
			settings: true,
			movePad: true,
			door: false,
			shootButton: false,
			sheet: { place: "top", open: false },
		},
	},
	{
		name: "動ける規則・探索の隠れ側・板を開く・鬼の視点・ポーズの名前",
		scene: {
			top: HUD_MARGIN,
			row: ["oni-view", "pose-notice"],
			settings: true,
			movePad: true,
			door: false,
			shootButton: false,
			sheet: { place: "top", open: true },
		},
	},
	{
		name: "動ける規則・ペイントの隠れ側・板を開く・ポーズの名前・屋根（開発用）",
		scene: {
			top: HUD_MARGIN,
			row: ["pose-notice", "roof"],
			settings: true,
			movePad: true,
			door: false,
			shootButton: false,
			sheet: { place: "top", open: true },
		},
	},
	{
		name: "準備移動の隠れ側・ポーズ・屋根（開発用）",
		scene: {
			top: HUD_MARGIN,
			row: ["pose", "pose-notice", "roof"],
			settings: true,
			movePad: true,
			door: false,
			shootButton: false,
			sheet: null,
		},
	},
	{
		name: "準備移動の鬼・待つ間の色",
		scene: {
			top: HUD_MARGIN,
			row: ["waiting-colors"],
			settings: true,
			movePad: true,
			door: true,
			shootButton: false,
			sheet: null,
		},
	},
	{
		name: "探索の鬼・襖・撃つ",
		scene: {
			top: HUD_MARGIN,
			row: [],
			settings: true,
			movePad: true,
			door: true,
			shootButton: true,
			sheet: null,
		},
	},
	{
		name: "従来の規則・ペイントの隠れ側・板を開く・ポーズの名前",
		scene: {
			top: HUD_MARGIN,
			row: ["pose-notice"],
			settings: true,
			movePad: false,
			door: false,
			shootButton: false,
			sheet: { place: "bottom", open: true },
		},
	},
	{
		name: "従来の規則・ペイントの隠れ側・板を閉じる",
		scene: {
			top: HUD_MARGIN,
			row: [],
			settings: true,
			movePad: false,
			door: false,
			shootButton: false,
			sheet: { place: "bottom", open: false },
		},
	},
	{
		name: "従来の規則・探索の隠れ側・鬼の視点",
		scene: {
			top: HUD_MARGIN,
			row: ["oni-view"],
			settings: true,
			movePad: false,
			door: false,
			shootButton: false,
			sheet: null,
		},
	},
	{
		name: "観戦・屋根（開発用）",
		scene: {
			top: HUD_MARGIN,
			row: ["spectator-note", "roof"],
			settings: true,
			movePad: false,
			door: false,
			shootButton: false,
			sheet: null,
		},
	},
	{
		name: "答え合わせ（勝敗の帯）・切り替えのシート",
		scene: {
			top: 48,
			row: [],
			settings: true,
			movePad: false,
			door: false,
			shootButton: false,
			sheet: { place: "bottom", open: true },
		},
	},
];

function layoutOf(view: (typeof VIEWS)[number], scene: Scene) {
	const { pad, shoot } = controlSizes(view.width, view.height);
	const maxHeight =
		scene.sheet?.place === "top"
			? paintSheetMaxHeight(view.width, view.height)
			: null;
	return hudLayout({
		...scene,
		sheet: scene.sheet === null ? null : { ...scene.sheet, maxHeight },
		width: view.width,
		height: view.height,
		pad,
		shoot,
	});
}

function overlap(a: HudRect, b: HudRect): boolean {
	return (
		Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0 &&
		Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0
	);
}

describe("hudLayout - 3D の画面の上の操作部品の置き場所", () => {
	for (const view of VIEWS) {
		describe(`${view.name} ${view.width}×${view.height}`, () => {
			for (const { name, scene } of SCENES) {
				it(`${name}: 部品どうしが重ならず、画面の内側に収まる`, () => {
					const { rects } = layoutOf(view, scene);
					const entries = Object.entries(rects) as [HudPart, HudRect][];
					for (const [part, r] of entries) {
						expect(r.x, part).toBeGreaterThanOrEqual(HUD_MARGIN);
						expect(r.y, part).toBeGreaterThanOrEqual(HUD_MARGIN);
						expect(r.x + r.width, part).toBeLessThanOrEqual(
							view.width - HUD_MARGIN,
						);
						expect(r.y + r.height, part).toBeLessThanOrEqual(
							view.height - HUD_MARGIN,
						);
					}
					for (let i = 0; i < entries.length; i++) {
						for (let j = i + 1; j < entries.length; j++) {
							const [pa, a] = entries[i] as [HudPart, HudRect];
							const [pb, b] = entries[j] as [HudPart, HudRect];
							expect(overlap(a, b), `${pa} × ${pb}`).toBe(false);
						}
					}
				});

				it(`${name}: 押す部品は、高さと幅が 44 px 以上`, () => {
					const { rects } = layoutOf(view, scene);
					for (const part of TAPPABLE) {
						const r = rects[part];
						if (r === undefined) continue;
						expect(r.width, part).toBeGreaterThanOrEqual(TAP_MIN);
						expect(r.height, part).toBeGreaterThanOrEqual(TAP_MIN);
					}
				});
			}

			it("左上の「ポーズ」と「鬼の視点」は、横に並び、間は 8 px 以上", () => {
				const { rects } = layoutOf(view, SCENES[0]?.scene as Scene);
				const pose = rects.pose;
				const oni = rects["oni-view"];
				if (pose === undefined || oni === undefined) throw new Error("無い");
				expect(pose.x).toBe(HUD_MARGIN);
				expect(pose.y).toBe(HUD_MARGIN);
				expect(oni.y).toBe(pose.y);
				expect(oni.x - (pose.x + pose.width)).toBeGreaterThanOrEqual(HUD_GAP);
			});

			it("動ける規則で板を閉じると、「塗る」は画面の下の中央（移動パッドと視点パッドの間）", () => {
				const { rects } = layoutOf(view, SCENES[0]?.scene as Scene);
				const open = rects["sheet-open"];
				const move = rects["move-pad"];
				const look = rects["look-pad"];
				if (open === undefined || move === undefined || look === undefined) {
					throw new Error("無い");
				}
				expect(open.x).toBeGreaterThanOrEqual(move.x + move.width + HUD_GAP);
				expect(open.x + open.width).toBeLessThanOrEqual(look.x - HUD_GAP);
				expect(open.x + open.width / 2).toBeCloseTo(view.width / 2, 0);
				expect(open.y + open.height).toBe(view.height - HUD_MARGIN);
			});

			it("撃つ・襖・「塗る」は同じ段（画面の下の中央）。襖は撃つの上", () => {
				const { rects } = layoutOf(view, SCENES[5]?.scene as Scene);
				const shoot = rects.shoot;
				const door = rects["open-door"];
				if (shoot === undefined || door === undefined) throw new Error("無い");
				expect(shoot.y + shoot.height).toBe(view.height - HUD_MARGIN);
				expect(shoot.x + shoot.width / 2).toBeCloseTo(view.width / 2, 0);
				expect(door.y + door.height).toBeLessThanOrEqual(shoot.y - HUD_GAP);
			});

			it("動ける規則で板を開くと、「塗る」は無く、鬼の視点とポーズの名前は板の見出しに入る（板はパッドを隠さない）", () => {
				const layout = layoutOf(view, SCENES[1]?.scene as Scene);
				expect(layout.rects["sheet-open"]).toBeUndefined();
				expect(layout.rects["oni-view"]).toBeUndefined();
				expect(layout.rects["pose-notice"]).toBeUndefined();
				expect(layout.inSheetHeader).toEqual(["oni-view", "pose-notice"]);
				const sheet = layout.rects.sheet;
				if (sheet === undefined) throw new Error("無い");
				expect(sheet.x).toBe(HUD_MARGIN);
				expect(sheet.y).toBe(HUD_MARGIN);
			});

			it("板の見出しに入らない部品（屋根）は、上に出す板の下に置く", () => {
				const { rects } = layoutOf(view, SCENES[2]?.scene as Scene);
				const sheet = rects.sheet;
				const roof = rects.roof;
				if (sheet === undefined || roof === undefined) throw new Error("無い");
				expect(roof.y).toBeGreaterThanOrEqual(sheet.y + sheet.height + HUD_GAP);
			});
		});
	}

	it("従来の規則の部品の置き場所は、これまでと同じ（板は左下、閉じた板の「開く」も左下、鬼の視点は左上）", () => {
		const view = { name: "SE", width: 375, height: 465 };
		const { pad } = controlSizes(view.width, view.height);
		const open = layoutOf(view, SCENES[6]?.scene as Scene).rects.sheet;
		expect(open).toEqual({
			x: HUD_MARGIN,
			y: view.height / 2 + 16 - HUD_MARGIN,
			width: view.width - pad - 24,
			height: view.height / 2 - 16,
		});
		const closed = layoutOf(view, SCENES[7]?.scene as Scene).rects[
			"sheet-open"
		];
		expect(closed?.x).toBe(HUD_MARGIN);
		expect((closed?.y ?? 0) + (closed?.height ?? 0)).toBe(
			view.height - HUD_MARGIN,
		);
		const oni = layoutOf(view, SCENES[8]?.scene as Scene).rects["oni-view"];
		expect(oni?.x).toBe(HUD_MARGIN);
		expect(oni?.y).toBe(HUD_MARGIN);
	});

	it("大きさが分からない間（0）は、何も置かない", () => {
		const layout = hudLayout({
			...(SCENES[0]?.scene as Scene),
			width: 0,
			height: 0,
			pad: 120,
			shoot: 80,
		});
		expect(layout.rects).toEqual({});
		expect(layout.inSheetHeader).toEqual([]);
	});
});
