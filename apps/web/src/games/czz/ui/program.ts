// 命令列の組み立て状態。czz では zustand の commandBuilderStore が持っていたものを、
// useReducer で使う純粋関数にした。入力欄の値は文字列のまま持ち、採点の直前に数値にする。
import { type DslProgram, dslCommandSchema } from "../core/schema";
import {
	type CommandType,
	type ParamKey,
	getCatalogItem,
	parseParam,
} from "./catalog";

export type DraftCommand = {
	id: number;
	type: CommandType;
	params: Readonly<Partial<Record<ParamKey, string>>>;
};

export type ProgramDraft = {
	commands: readonly DraftCommand[];
	/** 次に振る id。削除しても戻さないので、id は重複しない。 */
	nextId: number;
};

export type ProgramAction =
	| { type: "add"; commandType: CommandType }
	| { type: "remove"; id: number }
	| { type: "setParam"; id: number; key: ParamKey; value: string }
	| { type: "clear" };

export const initialProgramDraft: ProgramDraft = { commands: [], nextId: 0 };

export function programReducer(
	state: ProgramDraft,
	action: ProgramAction,
): ProgramDraft {
	switch (action.type) {
		case "add": {
			const params = Object.fromEntries(
				(getCatalogItem(action.commandType)?.params ?? []).map((p) => [
					p.key,
					"",
				]),
			);
			return {
				commands: [
					...state.commands,
					{ id: state.nextId, type: action.commandType, params },
				],
				nextId: state.nextId + 1,
			};
		}

		case "remove":
			return {
				...state,
				commands: state.commands.filter((c) => c.id !== action.id),
			};

		case "setParam":
			return {
				...state,
				commands: state.commands.map((c) =>
					c.id === action.id && action.key in c.params
						? { ...c, params: { ...c.params, [action.key]: action.value } }
						: c,
				),
			};

		case "clear":
			return { ...state, commands: [] };

		default: {
			const exhaustive: never = action;
			return exhaustive;
		}
	}
}

/** 採点に渡せる DslProgram にする。パラメータが1つでも数値にならなければ null。 */
export function toProgram(draft: ProgramDraft): DslProgram | null {
	const commands: DslProgram["commands"] = [];

	for (const draftCommand of draft.commands) {
		const command: Record<string, unknown> = { type: draftCommand.type };
		for (const [key, raw] of Object.entries(draftCommand.params)) {
			const value = parseParam(raw ?? "");
			if (value === null) return null;
			command[key] = value;
		}

		const parsed = dslCommandSchema.safeParse(command);
		if (!parsed.success) return null;
		commands.push(parsed.data);
	}

	return { commands };
}
