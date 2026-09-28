// czz の infra/drizzle/scripts/seed_insert.sql（tasks 20件）を静的データに変換したもの。
// is_published（全件 1）と created_by_user_id は rondo では使わないため持たない。
import type { CzzTask } from "../core/task";

export const czzTasks: readonly CzzTask[] = [
	{
		id: "fa58115b-4b3f-458b-900e-425c5e6cdea0",
		title: "T1: ...（何もしないよ）",
		description: "そのまま出力させてみよう",
		referenceProgram: { commands: [] },
		testCases: [
			{ input: [0], expected: [0] },
			{ input: [0, 0, 0], expected: [0, 0, 0] },
			{ input: [0, 0, 0, 0, 0], expected: [0, 0, 0, 0, 0] },
			{ input: [0, 0, 0, 0, 0, 0, 0, 0], expected: [0, 0, 0, 0, 0, 0, 0, 0] },
			{
				input: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
				expected: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
			},
		],
	},
	{
		id: "e2055c1a-2667-45e1-b2e4-b95d9552bf42",
		title: "T2: 昇順にしよう",
		description: "数字を昇順に並べてみよう(例: 3,1,2 → 1,2,3)",
		referenceProgram: { commands: [{ type: "SORT_ASC" }] },
		testCases: [
			{ input: [3, 1, 2], expected: [1, 2, 3] },
			{ input: [7, 3, 9, 1, 6, 2, 8], expected: [1, 2, 3, 6, 7, 8, 9] },
			{ input: [1, 1, 1], expected: [1, 1, 1] },
			{ input: [-2, 5, 0], expected: [-2, 0, 5] },
			{ input: [2, 1, 2, 0], expected: [0, 1, 2, 2] },
		],
	},
	{
		id: "03b0cdff-dd62-47eb-a216-235dc3b40275",
		title: "T3: 2だけ表示しよう",
		description: "2だけを残そう(例: 1,2,2,3 → 2,2)",
		referenceProgram: { commands: [{ type: "FILTER_EQUALS", value: 2 }] },
		testCases: [
			{ input: [1, 2, 2, 3], expected: [2, 2] },
			{ input: [], expected: [] },
			{ input: [2, 2, 2], expected: [2, 2, 2] },
			{ input: [1, 3, 4], expected: [] },
			{ input: [2, 1, 2, 1, 2], expected: [2, 2, 2] },
		],
	},
	{
		id: "fc812e3b-ffee-4d49-afb3-79e48f3afe2e",
		title: "T4: 全部に10を足そう",
		description: "全部の数字に +10しよう(例: 0,1,2 → 10,11,12)",
		referenceProgram: { commands: [{ type: "MAP_ADD", value: 10 }] },
		testCases: [
			{ input: [0, 1, 2], expected: [10, 11, 12] },
			{ input: [], expected: [] },
			{ input: [-10, 0, 10], expected: [0, 10, 20] },
			{ input: [5], expected: [15] },
			{ input: [1, 1, 1], expected: [11, 11, 11] },
		],
	},
	{
		id: "02acbb93-69dc-4682-a314-64994ee7991b",
		title: "T5: 合計を表示しよう",
		description: "全ての数字の合計を出そう（例: 1,2,3 → 6）。",
		referenceProgram: { commands: [{ type: "OUTPUT_SUM" }] },
		testCases: [
			{ input: [1, 2, 3], expected: [6] },
			{ input: [0], expected: [0] },
			{ input: [-1, 1], expected: [0] },
			{ input: [10], expected: [10] },
			{ input: [2, 2, 2, 2], expected: [8] },
		],
	},
	{
		id: "bf761d18-1c30-4e64-a43f-5de517f58178",
		title: "T6: 昇順に並べ 2",
		description: "数字を小さい順に並べよう",
		referenceProgram: { commands: [{ type: "SORT_ASC" }] },
		testCases: [
			{ input: [3, 1], expected: [1, 3] },
			{ input: [5, 2, 8, 1, 4], expected: [1, 2, 4, 5, 8] },
			{ input: [7, 3, 9, 1, 6, 2, 8], expected: [1, 2, 3, 6, 7, 8, 9] },
			{ input: [1, 1, 1, 1], expected: [1, 1, 1, 1] },
			{ input: [10, 1, 5, 1, 10], expected: [1, 1, 5, 10, 10] },
		],
	},
	{
		id: "fe5d90e2-787b-4739-b2e2-34451771e05c",
		title: "T7: 降順に並べ",
		description: "数字を大きい順に並べよう",
		referenceProgram: { commands: [{ type: "SORT_DESC" }] },
		testCases: [
			{ input: [1, 3], expected: [3, 1] },
			{ input: [2, 5, 1, 8, 4], expected: [8, 5, 4, 2, 1] },
			{ input: [3, 3, 3, 1, 5, 5], expected: [5, 5, 3, 3, 3, 1] },
			{ input: [], expected: [] },
			{ input: [0, -1, 2, -3], expected: [2, 0, -1, -3] },
		],
	},
	{
		id: "ff7242fb-575f-46a3-b30a-ab0cc322e168",
		title: "T8: 合計を表示 2",
		description: "全ての数字を足し算しよう",
		referenceProgram: { commands: [{ type: "OUTPUT_SUM" }] },
		testCases: [
			{ input: [1], expected: [1] },
			{ input: [1, 2, 3, 4, 5], expected: [15] },
			{ input: [-5, 5], expected: [0] },
			{ input: [100, 200, 300], expected: [600] },
			{ input: [0, 0, 0, 0], expected: [0] },
		],
	},
	{
		id: "25b1123f-f971-43ea-95a5-fba675fee6aa",
		title: "T9: 先頭のみ表示",
		description: "一番前の数字だけ取り出そう",
		referenceProgram: { commands: [{ type: "OUTPUT_FIRST" }] },
		testCases: [
			{ input: [7], expected: [7] },
			{ input: [3, 1, 4, 1, 5], expected: [3] },
			{ input: [-1, 0, 1], expected: [-1] },
			{ input: [], expected: [] },
			{ input: [99, 1, 2, 3, 4, 5, 6], expected: [99] },
		],
	},
	{
		id: "eee3780c-47af-4265-a4d3-5bbd2112ae42",
		title: "T10: 末尾のみ表示",
		description: "一番後ろの数字だけ取り出そう",
		referenceProgram: { commands: [{ type: "OUTPUT_LAST" }] },
		testCases: [
			{ input: [7], expected: [7] },
			{ input: [3, 1, 4, 1, 5], expected: [5] },
			{ input: [-1, 0, 1], expected: [1] },
			{ input: [], expected: [] },
			{ input: [1, 2, 3, 4, 5, 99], expected: [99] },
		],
	},
	{
		id: "67a3cf5d-3a67-4b3b-935c-b55e6b3827b6",
		title: "T11: 昇順にして末尾を出して",
		description: "小さい順に並べて一番後ろ（＝最大値）を取り出そう",
		referenceProgram: {
			commands: [{ type: "SORT_ASC" }, { type: "OUTPUT_LAST" }],
		},
		testCases: [
			{ input: [3, 1], expected: [3] },
			{ input: [5, 2, 8, 1, 4], expected: [8] },
			{ input: [7, 7, 7], expected: [7] },
			{ input: [-3, -1, -2], expected: [-1] },
			{ input: [0, 100, 50, 100], expected: [100] },
		],
	},
	{
		id: "28ade238-c36f-4b06-920d-4e293d803663",
		title: "T12: 降順にして先頭を出して",
		description: "大きい順に並べて一番前（＝最大値）を取り出そう",
		referenceProgram: {
			commands: [{ type: "SORT_DESC" }, { type: "OUTPUT_FIRST" }],
		},
		testCases: [
			{ input: [1, 3], expected: [3] },
			{ input: [2, 5, 1, 8, 4], expected: [8] },
			{ input: [9, 9, 9], expected: [9] },
			{ input: [-10, 0, 10], expected: [10] },
			{ input: [42], expected: [42] },
		],
	},
	{
		id: "a82ae13d-c3c2-426b-a8e3-9568b46dcc9b",
		title: "T13: 3より大きいものだけの総和",
		description: "3以下を取り除いてから合計しよう",
		referenceProgram: {
			commands: [{ type: "FILTER_GT", value: 3 }, { type: "OUTPUT_SUM" }],
		},
		testCases: [
			{ input: [1, 2, 3, 4, 5], expected: [9] },
			{ input: [10, 20, 30], expected: [60] },
			{ input: [1, 2, 3], expected: [0] },
			{ input: [4], expected: [4] },
			{ input: [0, 5, 3, 7, 2, 6], expected: [18] },
		],
	},
	{
		id: "d8127939-29fc-44e0-8977-a7d71b0f90bd",
		title: "T14: 10を足して合計",
		description: "全部に10を足してから合計しよう",
		referenceProgram: {
			commands: [{ type: "MAP_ADD", value: 10 }, { type: "OUTPUT_SUM" }],
		},
		testCases: [
			{ input: [0], expected: [10] },
			{ input: [1, 2, 3], expected: [36] },
			{ input: [-10, -10], expected: [0] },
			{ input: [5, 5, 5, 5], expected: [60] },
			{ input: [0, 0, 0, 0, 0], expected: [50] },
		],
	},
	{
		id: "988e2b3a-82ae-4979-b0f6-8ac3aaeb13df",
		title: "T15: 2倍して合計",
		description: "全部を2倍にしてから合計しよう",
		referenceProgram: {
			commands: [{ type: "MAP_MULTIPLY", value: 2 }, { type: "OUTPUT_SUM" }],
		},
		testCases: [
			{ input: [1], expected: [2] },
			{ input: [1, 2, 3], expected: [12] },
			{ input: [0, 0, 0], expected: [0] },
			{ input: [5, 10, 15], expected: [60] },
			{ input: [-1, 1, -2, 2], expected: [0] },
		],
	},
	{
		id: "24ae19df-ef94-4d08-8c2b-d14e8df2efd7",
		title: "T16: 3より大きいものには10を足して合計",
		description: "3以下を除く→10を足す→合計しよう",
		referenceProgram: {
			commands: [
				{ type: "FILTER_GT", value: 3 },
				{ type: "MAP_ADD", value: 10 },
				{ type: "OUTPUT_SUM" },
			],
		},
		testCases: [
			{ input: [1, 2, 3, 4, 5], expected: [29] },
			{ input: [10, 20], expected: [50] },
			{ input: [1, 2, 3], expected: [0] },
			{ input: [4, 5, 6], expected: [45] },
			{ input: [0, 4, 3, 8, 1], expected: [32] },
		],
	},
	{
		id: "3bf4c485-b098-4a71-8691-88a8cd08c2a0",
		title: "T17: 5より大きいものだけ降順にして先頭",
		description: "5以下を除く→大きい順→先頭（＝最大値）",
		referenceProgram: {
			commands: [
				{ type: "FILTER_GT", value: 5 },
				{ type: "SORT_DESC" },
				{ type: "OUTPUT_FIRST" },
			],
		},
		testCases: [
			{ input: [1, 6, 3, 10, 5], expected: [10] },
			{ input: [6, 7, 8], expected: [8] },
			{ input: [100, 6], expected: [100] },
			{ input: [1, 2, 3, 4, 5], expected: [] },
			{ input: [9, 6, 9, 6], expected: [9] },
		],
	},
	{
		id: "3eb54482-a5cb-41f4-bec1-238ac22d565f",
		title: "T18: 2倍して昇順にして末尾",
		description: "全部2倍→小さい順→末尾（＝最大値）",
		referenceProgram: {
			commands: [
				{ type: "MAP_MULTIPLY", value: 2 },
				{ type: "SORT_ASC" },
				{ type: "OUTPUT_LAST" },
			],
		},
		testCases: [
			{ input: [3, 1, 2], expected: [6] },
			{ input: [5], expected: [10] },
			{ input: [0, 0, 0], expected: [0] },
			{ input: [-1, 4, 2], expected: [8] },
			{ input: [10, 1, 5, 3], expected: [20] },
		],
	},
	{
		id: "8f6dd886-2919-4384-a505-5b62223300eb",
		title: "T19: 7を足して昇順にして先頭",
		description: "全部に7を足して→小さい順→先頭（＝最小値）",
		referenceProgram: {
			commands: [
				{ type: "MAP_ADD", value: 7 },
				{ type: "SORT_ASC" },
				{ type: "OUTPUT_FIRST" },
			],
		},
		testCases: [
			{ input: [3, 1, 2], expected: [8] },
			{ input: [0], expected: [7] },
			{ input: [-7, 0, 7], expected: [0] },
			{ input: [10, 10, 10], expected: [17] },
			{ input: [5, 1, 3, 2, 4], expected: [8] },
		],
	},
	{
		id: "08d9a864-8e58-4739-bf13-28d70c80b447",
		title: "T20: 2より大きいものだけ2倍して合計",
		description: "2以下を除いて→2倍→合計",
		referenceProgram: {
			commands: [
				{ type: "FILTER_GT", value: 2 },
				{ type: "MAP_MULTIPLY", value: 2 },
				{ type: "OUTPUT_SUM" },
			],
		},
		testCases: [
			{ input: [1, 2, 3, 4, 5], expected: [24] },
			{ input: [3], expected: [6] },
			{ input: [1, 2], expected: [0] },
			{ input: [10, 20, 30], expected: [120] },
			{ input: [0, 3, 2, 5, 1], expected: [16] },
		],
	},
];
