/**
 * 3D の画面の上に重ねる操作部品の置き場所（純粋関数。three と React を使わない）。
 *
 * 部品ごとの位置と大きさ（3D の画面の左上からの px）を、ここ 1 つで決める（Veryare.tsx は、この結果の
 * とおりに置く）。部品どうしが重ならず、押す部品は 44 px 以上になるように決める（hudLayout.test.ts で、
 * iPhone の 5 つの大きさを確かめる）。
 *
 * - 左上: ポーズ・鬼の視点・屋根・ポーズの名前・待つ間の色・観戦の説明を、この順で横に並べる（入りきら
 *   なければ次の行）。右上の「設定」とは重ねない
 * - 下: 左に移動パッド、右に視点パッド。その間（下の中央）に、下から撃つ（か、動ける規則で板を閉じた
 *   ときの「塗る」）、襖を開ける
 * - 板（ペイントの板・答え合わせの切り替え）: 動ける規則のペイントの板は左上、ほかは左下。どちらも視点
 *   パッドの分を右に空ける。上に出す板を開いている間は、左上の鬼の視点とポーズの名前を、板の見出しに
 *   入れる（inSheetHeader）。見出しに入らない部品は、板の下に置く
 * - 従来の規則の閉じた板の「開く」は、これまでどおり左下
 *
 * 開いた「設定」のメニューと、つまみで動かした板は、ここでは決めない（押した人が、一時的に重ねるもの）。
 */

/** 3D の画面の端と部品の間（px）。 */
export const HUD_MARGIN = 8;
/** 部品どうしの間（px）。 */
export const HUD_GAP = 8;
/** 押す部品の、高さと幅の下限（px）。 */
export const TAP_MIN = 44;
/** パッドの下の名前（「移動」「視点」）の高さ（px）。 */
export const PAD_LABEL = 18;

/** 置く部品。 */
export type HudPart =
	| "pose"
	| "oni-view"
	| "roof"
	| "pose-notice"
	| "waiting-colors"
	| "spectator-note"
	| "settings"
	| "sheet"
	| "sheet-open"
	| "move-pad"
	| "look-pad"
	| "open-door"
	| "shoot";

/** 左上に並べる部品。 */
export type HudRowPart = Extract<
	HudPart,
	| "pose"
	| "oni-view"
	| "roof"
	| "pose-notice"
	| "waiting-colors"
	| "spectator-note"
>;

export interface HudRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** 部品の大きさ（px）。文字は、この幅に収まる長さにする（Veryare.tsx）。 */
export const HUD_SIZES = {
	pose: { width: 128, height: TAP_MIN },
	"oni-view": { width: 136, height: TAP_MIN },
	roof: { width: 128, height: TAP_MIN },
	"pose-notice": { width: 128, height: 36 },
	// 色の丸 6 つ（44 px・間 4 px）と、上の説明の 1 行。
	"waiting-colors": { width: 300, height: 76 },
	// 幅は、左上の行の幅いっぱい（3 行まで）。
	"spectator-note": { width: Number.POSITIVE_INFINITY, height: 64 },
	settings: { width: TAP_MIN, height: TAP_MIN },
	"open-door": { width: 104, height: TAP_MIN },
	// 動ける規則の、閉じた板の「塗る」（下の中央）。
	paint: { width: 88, height: TAP_MIN },
	// 従来の規則の、閉じた板の「ペイントを開く」「答え合わせを開く」（左下）。
	open: { width: 144, height: TAP_MIN },
} as const;

/** 上に出す板を開いている間、板の見出しに入れる部品。 */
const SHEET_HEADER: readonly HudRowPart[] = ["oni-view", "pose-notice"];

export interface HudInput {
	/** 3D の画面の大きさ（px）。 */
	readonly width: number;
	readonly height: number;
	/** パッドと撃つボタンの大きさ（viewLayout.ts の controlSizes）。 */
	readonly pad: number;
	readonly shoot: number;
	/** 左上と右上の部品の上端（答え合わせの勝敗の帯が出ている間は、その下）。 */
	readonly top: number;
	/** 左上に出す部品（出すものだけ）。 */
	readonly row: readonly HudRowPart[];
	/** 右上の「設定」を出すか（ステージ）。 */
	readonly settings: boolean;
	/** 左下に移動パッド（か、「接続中」）を出すか。 */
	readonly movePad: boolean;
	readonly door: boolean;
	readonly shootButton: boolean;
	/**
	 * 板。place は、動ける規則のペイントの板なら top。maxHeight は、上に出す板の高さの上限
	 * （viewLayout.ts の paintSheetMaxHeight）。
	 */
	readonly sheet: {
		readonly place: "top" | "bottom";
		readonly open: boolean;
		readonly maxHeight?: number | null;
	} | null;
}

export interface HudLayout {
	readonly rects: Partial<Record<HudPart, HudRect>>;
	/** 板の見出しに入れた部品（上に出す板を開いている間だけ）。 */
	readonly inSheetHeader: readonly HudRowPart[];
}

/** 部品ごとの置き場所。大きさが分からない間（0）は、何も置かない。 */
export function hudLayout(input: HudInput): HudLayout {
	const { width, height, pad, top } = input;
	if (width <= 0 || height <= 0) return { rects: {}, inSheetHeader: [] };
	const rects: Partial<Record<HudPart, HudRect>> = {};
	const bottom = height - HUD_MARGIN;

	// 下の両端のパッド（名前を含む）。
	const padHeight = pad + PAD_LABEL;
	if (input.movePad) {
		rects["move-pad"] = {
			x: HUD_MARGIN,
			y: bottom - padHeight,
			width: pad,
			height: padHeight,
		};
	}
	rects["look-pad"] = {
		x: width - HUD_MARGIN - pad,
		y: bottom - padHeight,
		width: pad,
		height: padHeight,
	};

	// 板（視点パッドの分を右に空ける）。
	const sheet = input.sheet;
	const sheetWidth = width - pad - 24;
	const topSheetOpen = sheet?.place === "top" && sheet.open;
	if (sheet?.open === true) {
		const half = height / 2 - 16;
		const sheetHeight =
			sheet.place === "top" ? Math.min(sheet.maxHeight ?? half, half) : half;
		rects.sheet = {
			x: HUD_MARGIN,
			y: sheet.place === "top" ? top : bottom - sheetHeight,
			width: sheetWidth,
			height: sheetHeight,
		};
	}

	// 下の中央（下から: 撃つか「塗る」、襖を開ける）。
	const stack: { part: HudPart; width: number; height: number }[] = [];
	if (input.shootButton) {
		stack.push({ part: "shoot", width: input.shoot, height: input.shoot });
	}
	if (sheet?.place === "top" && !sheet.open) {
		stack.push({ part: "sheet-open", ...HUD_SIZES.paint });
	}
	if (input.door) stack.push({ part: "open-door", ...HUD_SIZES["open-door"] });
	let stackBottom = bottom;
	for (const item of stack) {
		rects[item.part] = {
			x: (width - item.width) / 2,
			y: stackBottom - item.height,
			width: item.width,
			height: item.height,
		};
		stackBottom -= item.height + HUD_GAP;
	}

	// 従来の規則の、閉じた板の「開く」（左下。移動パッドがあれば、その上）。
	if (sheet?.place === "bottom" && !sheet.open) {
		const above = input.movePad ? padHeight + HUD_GAP : 0;
		rects["sheet-open"] = {
			x: HUD_MARGIN,
			y: bottom - above - HUD_SIZES.open.height,
			...HUD_SIZES.open,
		};
	}

	// 右上の「設定」。
	if (input.settings) {
		rects.settings = {
			x: width - HUD_MARGIN - HUD_SIZES.settings.width,
			y: top,
			...HUD_SIZES.settings,
		};
	}

	// 左上の行。上に出す板を開いている間は、鬼の視点とポーズの名前を板の見出しに入れ、残りを板の下に置く。
	const inSheetHeader = topSheetOpen
		? input.row.filter((part) => SHEET_HEADER.includes(part))
		: [];
	const rowRight =
		width -
		HUD_MARGIN -
		(input.settings ? HUD_SIZES.settings.width + HUD_GAP : 0);
	let x = HUD_MARGIN;
	let y =
		topSheetOpen && rects.sheet !== undefined
			? rects.sheet.y + rects.sheet.height + HUD_GAP
			: top;
	let lineHeight = 0;
	for (const part of input.row) {
		if (inSheetHeader.includes(part)) continue;
		const size = HUD_SIZES[part];
		const partWidth = Math.min(size.width, rowRight - HUD_MARGIN);
		if (x > HUD_MARGIN && x + partWidth > rowRight) {
			x = HUD_MARGIN;
			y += lineHeight + HUD_GAP;
			lineHeight = 0;
		}
		rects[part] = { x, y, width: partWidth, height: size.height };
		x += partWidth + HUD_GAP;
		lineHeight = Math.max(lineHeight, size.height);
	}

	return { rects, inSheetHeader };
}
