/**
 * 出題画面（issue-20 のコマンド選択 UI）。
 *
 * 命令ボタンをタップして命令列を組み立て、数値を入れて採点する。採点は core/grade の
 * 純粋関数をブラウザ内で呼ぶだけで、通信も保存もしない（ADR 0019）。3問で終わると
 * onFinish で結果を親（Czz）に渡す。基盤への返却（reportResult）は親が行う。
 * 色は czz の配色（theme.ts）に揃え、初心者モードではマスコットが採点に反応する。
 */

import type { PlayResult } from "@rondo/contracts";
import { useEffect, useReducer, useRef, useState } from "react";
import { type GradeResult, grade } from "../core/grade";
import type { CzzTask } from "../core/task";
import { type UiMode, mascotFor } from "../presentation";
import { sessionReducer, sessionResult, startSession } from "../session";
import { Mascot } from "./Mascot";
import { catalog, getCatalogItem, parseParam } from "./catalog";
import {
	type DraftCommand,
	type ProgramAction,
	initialProgramDraft,
	programReducer,
	toProgram,
} from "./program";
import { T } from "./theme";

const BUTTON = `min-h-11 px-3 text-sm ${T.radius} disabled:opacity-40`;

function formatNumbers(values: readonly number[]): string {
	return values.length === 0 ? "（なし）" : values.join(", ");
}

export function Play({
	tasks,
	mode,
	onTaskChange,
	onGraded,
	onFinish,
}: {
	tasks: readonly CzzTask[];
	mode: UiMode;
	/** 今の問題が変わった（BGM をお題ごとに選ぶため）。 */
	onTaskChange: (task: CzzTask) => void;
	/** 採点した（効果音のため）。 */
	onGraded: (passed: boolean) => void;
	onFinish: (result: PlayResult) => void;
}) {
	const [session, dispatch] = useReducer(sessionReducer, tasks, startSession);
	const [lastPassed, setLastPassed] = useState<boolean | null>(null);

	const task = session.tasks[session.index];
	useEffect(() => {
		if (task !== undefined) onTaskChange(task);
	}, [task, onTaskChange]);

	// 終了したら一度だけ結果を親へ渡す。
	const finished = useRef(false);
	useEffect(() => {
		if (!session.finished || finished.current) return;
		finished.current = true;
		onFinish(sessionResult(session));
	}, [session, onFinish]);

	if (session.finished || task === undefined) return null;

	const isLast = session.index === session.tasks.length - 1;

	return (
		<div className="flex w-full flex-col gap-4 py-4">
			<p className={`text-xs ${T.muted}`}>
				{session.index + 1} / {session.tasks.length} 問目
			</p>
			{mode === "beginner" ? <Mascot mood={mascotFor(lastPassed)} /> : null}
			{/* 問題が変わったら命令列と採点結果を作り直す */}
			<TaskPlay
				key={session.index}
				task={task}
				onGraded={(passed) => {
					setLastPassed(passed);
					onGraded(passed);
					dispatch({ type: "graded", allPassed: passed });
				}}
				onEdit={() => setLastPassed(null)}
			/>
			{session.graded ? (
				<button
					type="button"
					className={`${BUTTON} ${T.primary} font-semibold active:opacity-80`}
					onClick={() => {
						setLastPassed(null);
						dispatch({ type: "next" });
					}}
				>
					{isLast ? "結果を見る" : "次の問題へ"}
				</button>
			) : null}
		</div>
	);
}

function TaskPlay({
	task,
	onGraded,
	onEdit,
}: {
	task: CzzTask;
	onGraded: (passed: boolean) => void;
	onEdit: () => void;
}) {
	const [draft, dispatch] = useReducer(programReducer, initialProgramDraft);
	const [result, setResult] = useState<GradeResult | null>(null);
	const program = toProgram(draft);

	const edit = (action: ProgramAction) => {
		dispatch(action);
		setResult(null);
		onEdit();
	};

	const submit = () => {
		const graded = grade(program, task);
		setResult(graded);
		onGraded(graded.valid && graded.allPassed);
	};

	return (
		<>
			<TaskCard task={task} />

			<section className="flex flex-col gap-2">
				<h2 className={`text-xs ${T.muted}`}>命令（上から順に動く）</h2>
				{draft.commands.length === 0 ? (
					<p className={`p-3 text-sm ${T.radius} ${T.mutedBg} ${T.muted}`}>
						下のボタンで命令を追加してね
					</p>
				) : (
					<ol className="flex flex-col gap-2">
						{draft.commands.map((command, index) => (
							<CommandRow
								key={command.id}
								command={command}
								index={index}
								dispatch={edit}
							/>
						))}
					</ol>
				)}
			</section>

			<section className="grid grid-cols-2 gap-2">
				{catalog.map((item) => (
					<button
						key={item.type}
						type="button"
						className={`${BUTTON} ${T.card} ${T.ring} active:bg-[var(--czz-muted)]`}
						onClick={() => edit({ type: "add", commandType: item.type })}
					>
						{item.label}
					</button>
				))}
			</section>

			<section className="flex flex-col gap-2">
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						className={`${BUTTON} ${T.card} ${T.ring} active:bg-[var(--czz-muted)]`}
						onClick={() => edit({ type: "clear" })}
						disabled={draft.commands.length === 0}
					>
						ぜんぶ消す
					</button>
					<button
						type="button"
						className={`${BUTTON} ${T.accent} ${T.ring} font-semibold active:opacity-80`}
						onClick={submit}
						disabled={program === null}
					>
						採点
					</button>
				</div>
				{program === null ? (
					<p className="text-[var(--czz-destructive)] text-xs">
						数字が入っていない命令があります
					</p>
				) : null}
			</section>

			{result !== null ? <GradeView result={result} /> : null}
		</>
	);
}

function TaskCard({ task }: { task: CzzTask }) {
	const example = task.testCases[0];
	return (
		<section
			className={`flex flex-col gap-1 p-4 ${T.radius} ${T.card} ${T.ring}`}
		>
			<div className={`text-sm ${T.muted}`}>もんだい</div>
			<h1 className="font-semibold text-lg">{task.title}</h1>
			<p className={`text-sm ${T.muted}`}>{task.description}</p>
			{example !== undefined ? (
				<p className={`mt-1 font-mono text-xs ${T.muted}`}>
					例: {formatNumbers(example.input)} → {formatNumbers(example.expected)}
				</p>
			) : null}
		</section>
	);
}

function CommandRow({
	command,
	index,
	dispatch,
}: {
	command: DraftCommand;
	index: number;
	dispatch: (action: ProgramAction) => void;
}) {
	const item = getCatalogItem(command.type);
	return (
		<li className={`flex flex-col gap-2 p-3 ${T.radius} ${T.card} ${T.ring}`}>
			<div className="flex items-center gap-2">
				<span className={`w-5 text-xs ${T.muted}`}>{index + 1}</span>
				<span className="flex-1 text-sm">{item?.label ?? command.type}</span>
				<button
					type="button"
					className={`${BUTTON} min-w-11 ${T.mutedBg} ${T.ring} active:opacity-80`}
					onClick={() => dispatch({ type: "remove", id: command.id })}
					aria-label={`${index + 1}番目の命令を消す`}
				>
					消す
				</button>
			</div>
			{item?.params.map((param) => {
				const raw = command.params[param.key] ?? "";
				const invalid = raw.trim() !== "" && parseParam(raw) === null;
				return (
					<label key={param.key} className="flex items-center gap-2 pl-7">
						<span className={`flex-1 text-sm ${T.muted}`}>{param.label}</span>
						<input
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							autoComplete="off"
							enterKeyHint="done"
							className={`min-h-11 w-24 bg-[var(--czz-bg)] px-3 text-right text-base ring-1 ring-inset ${T.radius} ${
								invalid
									? "ring-[var(--czz-destructive)]"
									: "ring-[var(--czz-border)]"
							}`}
							placeholder={param.placeholder}
							value={raw}
							onChange={(e) =>
								dispatch({
									type: "setParam",
									id: command.id,
									key: param.key,
									value: e.target.value,
								})
							}
						/>
					</label>
				);
			})}
		</li>
	);
}

function GradeView({ result }: { result: GradeResult }) {
	if (!result.valid) {
		return (
			<p className={`p-3 text-sm ${T.radius} bg-rose-100 text-rose-900`}>
				命令を読み取れませんでした
			</p>
		);
	}
	if (result.allPassed) {
		return (
			<p
				className={`p-3 font-semibold ${T.radius} bg-emerald-100 text-emerald-900`}
			>
				正解！
			</p>
		);
	}
	const failed = result.results.find((r) => !r.passed);
	return (
		<div
			className={`flex flex-col gap-1 p-3 text-sm ${T.radius} bg-rose-100 text-rose-900`}
		>
			<p className="font-semibold">
				不正解（組み直して、もう一度採点できます）
			</p>
			{failed !== undefined ? (
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-xs">
					<dt>入力</dt>
					<dd>{formatNumbers(failed.input)}</dd>
					<dt>期待</dt>
					<dd>{formatNumbers(failed.expected)}</dd>
					<dt>実際</dt>
					<dd>{formatNumbers(failed.actual)}</dd>
				</dl>
			) : null}
		</div>
	);
}
