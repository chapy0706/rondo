"use client";

/**
 * czz 本体（ソロゲーム / ADR 0004）。
 *
 * 命令ボタンをタップして命令列を組み立て、数値を入れて採点する。入力は独自の
 * コマンド選択 UI で、VirtualPad は使わない（ADR 0018 は独自 UI を禁じない）。
 * 採点は core/grade の純粋関数をブラウザ内で呼ぶだけで、通信も保存もしない（ADR 0019）。
 */

import { useSoloGame } from "@rondo/game-sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { type GradeResult, grade } from "./core/grade";
import type { CzzTask } from "./core/task";
import { czzTasks } from "./data/tasks";
import { czzManifest } from "./manifest";
import {
	TASKS_PER_SESSION,
	eligibleTasks,
	pickTasks,
	sessionReducer,
	sessionResult,
	startSession,
} from "./session";
import { catalog, getCatalogItem, parseParam } from "./ui/catalog";
import {
	type DraftCommand,
	type ProgramAction,
	initialProgramDraft,
	programReducer,
	toProgram,
} from "./ui/program";

const BUTTON =
	"min-h-11 rounded-lg px-3 text-sm ring-1 ring-inset transition-colors disabled:opacity-40";

function formatNumbers(values: readonly number[]): string {
	return values.length === 0 ? "（なし）" : values.join(", ");
}

export default function Czz() {
	// 乱数で選ぶため、サーバー描画との食い違いを避けてマウント後に決める
	const [tasks, setTasks] = useState<readonly CzzTask[] | null>(null);
	useEffect(() => {
		setTasks(
			pickTasks(eligibleTasks(czzTasks), TASKS_PER_SESSION, Math.random),
		);
	}, []);

	if (tasks === null) {
		return <p className="text-slate-400 text-sm">お題を準備しています…</p>;
	}
	return <Session tasks={tasks} />;
}

function Session({ tasks }: { tasks: readonly CzzTask[] }) {
	const { reportResult } = useSoloGame(czzManifest);
	const [session, dispatch] = useReducer(sessionReducer, tasks, startSession);

	// 終了時に一度だけ結果を基盤へ返す
	const reported = useRef(false);
	useEffect(() => {
		if (!session.finished || reported.current) return;
		reported.current = true;
		reportResult(sessionResult(session));
	}, [session, reportResult]);

	const task = session.tasks[session.index];
	if (session.finished || task === undefined) {
		return <p className="text-slate-400 text-sm">おつかれさま！</p>;
	}

	const isLast = session.index === session.tasks.length - 1;

	return (
		<div className="flex w-full max-w-md flex-col gap-4 px-4 pb-8 text-slate-200">
			<p className="text-slate-400 text-xs">
				{session.index + 1} / {session.tasks.length} 問目
			</p>
			{/* 問題が変わったら命令列と採点結果を作り直す */}
			<TaskPlay
				key={session.index}
				task={task}
				onGraded={(allPassed) => dispatch({ type: "graded", allPassed })}
			/>
			{session.graded ? (
				<button
					type="button"
					className={`${BUTTON} bg-slate-100 font-semibold text-slate-900 ring-slate-300 active:bg-slate-300`}
					onClick={() => dispatch({ type: "next" })}
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
}: {
	task: CzzTask;
	onGraded: (allPassed: boolean) => void;
}) {
	const [draft, dispatch] = useReducer(programReducer, initialProgramDraft);
	const [result, setResult] = useState<GradeResult | null>(null);
	const program = toProgram(draft);

	const edit = (action: ProgramAction) => {
		dispatch(action);
		setResult(null);
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
				<h2 className="text-slate-400 text-xs">命令（上から順に動く）</h2>
				{draft.commands.length === 0 ? (
					<p className="rounded-lg bg-slate-800/60 p-3 text-slate-400 text-sm">
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
						className={`${BUTTON} bg-slate-800 ring-slate-700 active:bg-slate-700`}
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
						className={`${BUTTON} bg-slate-800 ring-slate-700 active:bg-slate-700`}
						onClick={() => edit({ type: "clear" })}
						disabled={draft.commands.length === 0}
					>
						ぜんぶ消す
					</button>
					<button
						type="button"
						className={`${BUTTON} bg-sky-600 font-semibold text-white ring-sky-500 active:bg-sky-500`}
						onClick={submit}
						disabled={program === null}
					>
						採点
					</button>
				</div>
				{program === null ? (
					<p className="text-amber-300 text-xs">
						数字が入っていない命令があります
					</p>
				) : null}
			</section>

			{result !== null ? <ResultView result={result} /> : null}
		</>
	);
}

function TaskCard({ task }: { task: CzzTask }) {
	const example = task.testCases[0];
	return (
		<section className="flex flex-col gap-1 rounded-lg bg-slate-800/60 p-4">
			<h1 className="font-semibold text-base">{task.title}</h1>
			<p className="text-slate-300 text-sm">{task.description}</p>
			{example !== undefined ? (
				<p className="mt-1 font-mono text-slate-400 text-xs">
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
		<li className="flex flex-col gap-2 rounded-lg bg-slate-800 p-3 ring-1 ring-slate-700 ring-inset">
			<div className="flex items-center gap-2">
				<span className="w-5 text-slate-500 text-xs">{index + 1}</span>
				<span className="flex-1 text-sm">{item?.label ?? command.type}</span>
				<button
					type="button"
					className={`${BUTTON} min-w-11 bg-slate-900 text-slate-300 ring-slate-700 active:bg-slate-700`}
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
						<span className="flex-1 text-slate-300 text-sm">{param.label}</span>
						<input
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							autoComplete="off"
							enterKeyHint="done"
							className={`min-h-11 w-24 rounded-lg bg-slate-900 px-3 text-right text-base ring-1 ring-inset ${
								invalid ? "ring-rose-500" : "ring-slate-600"
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

function ResultView({ result }: { result: GradeResult }) {
	if (!result.valid) {
		return (
			<p className="rounded-lg bg-rose-950/60 p-3 text-rose-200 text-sm">
				命令を読み取れませんでした
			</p>
		);
	}
	if (result.allPassed) {
		return (
			<p className="rounded-lg bg-emerald-950/60 p-3 font-semibold text-emerald-200">
				正解！
			</p>
		);
	}
	const failed = result.results.find((r) => !r.passed);
	return (
		<div className="flex flex-col gap-1 rounded-lg bg-rose-950/60 p-3 text-sm">
			<p className="font-semibold text-rose-200">
				不正解（組み直して、もう一度採点できます）
			</p>
			{failed !== undefined ? (
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-rose-100/80 text-xs">
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
