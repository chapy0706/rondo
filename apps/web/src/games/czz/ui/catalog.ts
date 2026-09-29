// czz の apps/user/src/lib/command-builder/commandCatalog.ts から、初心者向けラベルと
// 数値パラメータの定義だけを抜いたもの。UNIX 表記・非表示の column パラメータ・
// 編集モード用の設定は持たない。FILTER_NOT_EQUALS は czz の catalog に無く、
// 出題対象のお題も使わないため載せない。
import type { DslCommand } from "../core/schema";

export type CommandType = DslCommand["type"];
export type ParamKey = "value" | "min" | "max";

export type ParamSpec = {
	key: ParamKey;
	label: string;
	placeholder: string;
};

export type CatalogItem = {
	type: CommandType;
	label: string;
	params: readonly ParamSpec[];
};

export const catalog: readonly CatalogItem[] = [
	{
		type: "FILTER_EQUALS",
		label: "同じものだけのこす",
		params: [{ key: "value", label: "どの値？", placeholder: "例: 10" }],
	},
	{
		type: "FILTER_GT",
		label: "大きいものだけのこす",
		params: [
			{ key: "value", label: "いくつより大きい？", placeholder: "例: 50" },
		],
	},
	{
		type: "FILTER_LT",
		label: "小さいものだけのこす",
		params: [
			{ key: "value", label: "いくつより小さい？", placeholder: "例: 10" },
		],
	},
	{
		type: "FILTER_BETWEEN",
		label: "範囲でしぼる",
		params: [
			{ key: "min", label: "いくつから？", placeholder: "例: 10" },
			{ key: "max", label: "いくつまで？", placeholder: "例: 50" },
		],
	},
	{
		type: "MAP_ADD",
		label: "数字を足す",
		params: [{ key: "value", label: "いくつ足す？", placeholder: "例: 3" }],
	},
	{
		type: "MAP_MULTIPLY",
		label: "数字をかける",
		params: [{ key: "value", label: "いくつかける？", placeholder: "例: 2" }],
	},
	{ type: "SORT_ASC", label: "小さい順に並べる", params: [] },
	{ type: "SORT_DESC", label: "大きい順に並べる", params: [] },
	{ type: "OUTPUT_FIRST", label: "先頭だけ出す", params: [] },
	{ type: "OUTPUT_LAST", label: "末尾だけ出す", params: [] },
	{ type: "OUTPUT_SUM", label: "合計を出す", params: [] },
	{ type: "OUTPUT_COUNT", label: "数をかぞえる", params: [] },
];

export function getCatalogItem(type: CommandType): CatalogItem | undefined {
	return catalog.find((item) => item.type === type);
}

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** 入力欄の文字列を数値にする。空や数値として読めないものは null。 */
export function parseParam(raw: string): number | null {
	const text = raw.trim();
	return NUMBER_PATTERN.test(text) ? Number(text) : null;
}
