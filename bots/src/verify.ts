/**
 * デプロイ後の自動確認（issue-50）。公開 URL に対して、外から確かめる。手元の Mac からも、
 * A1 からも実行できる（tools/verify.sh から呼ぶ。deploy/a1-deploy.sh --verify からも呼ばれる）。
 * 利用者に影響しない操作だけを行い、作ったルームは必ず退出する。
 *
 *   node src/verify.ts [--urls-from <env ファイル>] [--web <URL>] [--ws <URL>] [--assets <URL>]
 *                      [--origin <URL>] [--title <文字列>] [--retries N] [--interval-ms N]
 *                      [--ping-timeout-ms N] [--skip-ping]
 *
 * tools/verify.sh の --env-file は、ここでは --urls-from になる（node 自身が、スクリプトの後ろの
 * --env-file も拾って、ファイルの全部の値を環境変数に読み込んでしまうため、名前を分ける）。
 *
 * URL の受け取り（前ほど優先）: 引数 > env ファイル > 環境変数。名前は
 *   web:    RONDO_VERIFY_WEB_URL
 *   ws:     RONDO_VERIFY_WS_URL、無ければ NEXT_PUBLIC_RONDO_WS_URL
 *   素材:   NEXT_PUBLIC_ASSET_BASE_URL（空なら素材の確認を省く）
 *   origin: ASSET_ALLOWED_ORIGIN、無ければ web のオリジン
 * env ファイルからは、上の名前の行だけを読む（ほかの行は読まない・出さない）。
 *
 * 終了コード: 全項目が通れば 0、1つでも失敗すれば 1、使い方の誤り・実行できないときは 2。
 */

import { readFileSync } from "node:fs";
import {
	type Targets,
	assetGlbCheck,
	assetManifestCheck,
	assetPathForCheck,
	pingCheck,
	roomCheck,
	webCheck,
	wsCheck,
} from "./verify/checks.ts";
import { readEnvValues } from "./verify/judge.ts";
import {
	type Attempt,
	type CheckResult,
	exitCode,
	formatReport,
	toCheckResult,
	withRetry,
} from "./verify/report.ts";

const VALUE_FLAGS = [
	"--urls-from",
	"--web",
	"--ws",
	"--assets",
	"--origin",
	"--title",
	"--retries",
	"--interval-ms",
	"--ping-timeout-ms",
] as const;
const BOOLEAN_FLAGS = ["--skip-ping"] as const;
const ENV_NAMES = [
	"RONDO_VERIFY_WEB_URL",
	"RONDO_VERIFY_WS_URL",
	"NEXT_PUBLIC_RONDO_WS_URL",
	"NEXT_PUBLIC_ASSET_BASE_URL",
	"ASSET_ALLOWED_ORIGIN",
] as const;

function usage(problem: string): never {
	console.error(`停止: ${problem}`);
	console.error(
		"使い方: tools/verify.sh [--env-file <ファイル>] [--web <URL>] [--ws <URL>] [--assets <URL>] [--origin <URL>] [--title <文字列>] [--retries N] [--interval-ms N] [--ping-timeout-ms N] [--skip-ping]",
	);
	process.exit(2);
}

// 引数を読む。知らない引数は止める（打ち間違いで確認が黙って省かれないように）。
const flags = new Map<string, string>();
const switches = new Set<string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i] ?? "";
	if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
		const value = argv[i + 1];
		if (value === undefined || value.startsWith("--"))
			usage(`${arg} の後に値を書く`);
		flags.set(arg, value);
		i++;
	} else if ((BOOLEAN_FLAGS as readonly string[]).includes(arg)) {
		switches.add(arg);
	} else {
		usage(`知らない引数: ${arg}`);
	}
}

// env ファイル（リポジトリの外）から、決まった名前の値だけを取り出す。
let fileValues: Record<string, string> = {};
const envFile = flags.get("--urls-from");
if (envFile !== undefined) {
	try {
		fileValues = readEnvValues(readFileSync(envFile, "utf8"), ENV_NAMES);
	} catch {
		usage(`env ファイルを読めない: ${envFile}`);
	}
}

/** 引数 > env ファイル > 環境変数。空は無いものとして扱う。 */
function pick(flag: string | null, ...names: string[]): string | undefined {
	const fromFlag = flag === null ? undefined : flags.get(flag);
	if (fromFlag) return fromFlag;
	for (const name of names) {
		const value = fileValues[name] ?? process.env[name];
		if (value) return value;
	}
	return undefined;
}

function url(
	label: string,
	raw: string | undefined,
	protocols: string[],
): string {
	if (raw === undefined) usage(`${label} の URL が無い`);
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		usage(`${label} の URL の形が違う: ${raw}`);
	}
	if (!protocols.includes(parsed.protocol))
		usage(`${label} の URL は ${protocols.join(" / ")} にする: ${raw}`);
	return raw.replace(/\/+$/, "");
}

function count(flag: string, fallback: number): number {
	const raw = flags.get(flag);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0)
		usage(`${flag} は 0 以上の整数にする: ${raw}`);
	return value;
}

const webUrl = url("web", pick("--web", "RONDO_VERIFY_WEB_URL"), [
	"https:",
	"http:",
]);
const wsUrl = url(
	"WebSocket",
	pick("--ws", "RONDO_VERIFY_WS_URL", "NEXT_PUBLIC_RONDO_WS_URL"),
	["wss:", "ws:"],
);
const rawAssets = pick("--assets", "NEXT_PUBLIC_ASSET_BASE_URL");
const assetBaseUrl =
	rawAssets === undefined
		? undefined
		: url("素材", rawAssets, ["https:", "http:"]);
const assetOrigin =
	pick("--origin", "ASSET_ALLOWED_ORIGIN") ?? new URL(webUrl).origin;

const targets: Targets = {
	webUrl,
	webTitle: flags.get("--title") ?? "rondo",
	wsUrl,
	assetBaseUrl,
	assetOrigin,
	pingTimeoutMs: count("--ping-timeout-ms", 25_000),
};

const retry = {
	retries: count("--retries", 3),
	intervalMs: count("--interval-ms", 3_000),
	sleep: (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** 1項目を、再試行つきで確かめて CheckResult にする。 */
async function run(
	name: string,
	attempt: () => Promise<Attempt>,
): Promise<CheckResult> {
	console.log(`確認中: ${name}`);
	return toCheckResult(name, await withRetry(attempt, retry));
}

const results: CheckResult[] = [];
results.push(await run("web の応答", webCheck(targets)));
results.push(await run("WebSocket の接続と session", wsCheck(targets)));
results.push(await run("ルームの作成と退出", roomCheck(targets)));
if (switches.has("--skip-ping")) {
	results.push({
		name: "ping の受信",
		status: "skipped",
		detail: "--skip-ping を指定",
	});
} else {
	results.push(await run("ping の受信", pingCheck(targets)));
}

if (assetBaseUrl === undefined) {
	results.push({
		name: "素材の配信",
		status: "skipped",
		detail:
			"NEXT_PUBLIC_ASSET_BASE_URL（--assets）が未設定。素材を使わない環境として省いた",
	});
} else {
	results.push(
		await run(
			"素材の manifest.json",
			assetManifestCheck(targets, assetBaseUrl),
		),
	);
	const path = await assetPathForCheck(assetBaseUrl);
	if (path === null) {
		results.push({
			name: "素材の glb とキャッシュ",
			status: "failed",
			detail: "manifest.json から、版付きの glb のパスを取れない",
		});
	} else {
		results.push(
			await run("素材の glb とキャッシュ", assetGlbCheck(assetBaseUrl, path)),
		);
	}
}

console.log(formatReport(results, `${webUrl} / ${wsUrl}`, new Date()));
process.exit(exitCode(results));
