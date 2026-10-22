/**
 * 音の素材を測り、配信するフォルダへ写し、manifest.json の audio 欄を作る（issue-63）。
 *
 * 使い方:
 *   node tools/audio_assets.mjs                       # assets-src/audio → assets-src/delivery
 *   node tools/audio_assets.mjs --src <元のフォルダ> --out <配信するフォルダ>
 *
 * - 元のファイル（SOURCES の file）を測る: 長さ（ffprobe。無ければ MP3 のフレームを数える）、
 *   BGM の音量（ffmpeg の loudnorm。無ければ倍率 1 のまま、警告を出す）
 * - <配信するフォルダ>/v<VERSION>/audio/<key>.mp3 に写す（素材は作り直さない。変換もしない）
 * - <配信するフォルダ>/manifest.json の audio 欄を、作り直す（assets 欄はそのまま残す。
 *   manifest.json が無ければ、assets を空にして作る）
 *
 * 倍率（gain）: BGM は、目標の音量（BGM_TARGET_LUFS）に合わせて計算する。効果音は SOURCES の値。
 * 繰り返し（loop）: SOURCES の値（素材を作り直さず、ここの定数で継ぎ目を変える）。
 *
 * 素材の規約で、再配布は禁止。素材（mp3）と、変換した物は、公開リポジトリに入れない。リポジトリの
 * 中では、assets-src/ の下だけに書く（.gitignore で除いている）。
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 素材の版（パスに入れる。中身を変えるときは上げる）。 */
const VERSION = 1;
/** BGM の目標の音量（LUFS）。 */
const BGM_TARGET_LUFS = -18;

/**
 * 素材の一覧。key はアプリが引く名前（apps/web/src/platform/sound/keys.ts）。
 * loop の値は、耳で決め直せるように、ここで変える（top の最後の 2.1 秒は、いまは使わない）。
 */
const SOURCES = [
	{
		key: "bgm-top",
		file: "top.mp3",
		kind: "bgm",
		loop: { startMs: 20, endMs: 61_940, crossfadeMs: 1000 },
	},
	{
		key: "bgm-game",
		file: "game.mp3",
		kind: "bgm",
		loop: { startMs: 20, endMs: 106_100, crossfadeMs: 2500 },
	},
	{ key: "se-hit", file: "hit.mp3", kind: "se", gain: 0.8 },
	{ key: "se-miss", file: "miss.mp3", kind: "se", gain: 1.0 },
	{ key: "se-count", file: "count.mp3", kind: "se", gain: 1.0 },
	{ key: "se-start", file: "start.mp3", kind: "se", gain: 1.3 },
	{
		key: "se-paint",
		file: "paint.mp3",
		kind: "se",
		gain: 1.75,
		// 末尾の無音（6.85 秒以降）を除いて繰り返す。
		loop: { startMs: 0, endMs: 6850, crossfadeMs: 0 },
	},
];

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
	const options = {
		src: join(repo, "assets-src/audio"),
		out: join(repo, "assets-src/delivery"),
	};
	for (let i = 0; i < argv.length; i += 2) {
		const [name, value] = [argv[i], argv[i + 1]];
		if (value === undefined) throw new Error(`${name} の後に値を書く`);
		if (name === "--src") options.src = resolve(value);
		else if (name === "--out") options.out = resolve(value);
		else throw new Error(`知らない引数: ${name}`);
	}
	return options;
}

function has(command) {
	try {
		execFileSync(command, ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** 元のファイル。名前の前後の空白だけが違うファイルも見つける（警告を出す）。 */
function findSource(dir, file) {
	const exact = join(dir, file);
	if (existsSync(exact)) return exact;
	const near = readdirSync(dir).find((name) => name.trim() === file);
	if (near === undefined) return null;
	console.warn(
		`注意: ${JSON.stringify(near)} を ${file} として使う（名前を直すとよい）`,
	);
	return join(dir, near);
}

// --- MP3 のフレームを数える（ffprobe が無いときの長さ） ---------------------------------

const BITRATES = {
	1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = {
	3: [44100, 48000, 32000],
	2: [22050, 24000, 16000],
	0: [11025, 12000, 8000],
};

/** MPEG の Layer III のフレームを数えて、長さ（ミリ秒）を出す。読めなければ null。 */
export function mp3DurationMs(data) {
	let offset = 0;
	if (data.length >= 10 && data.toString("latin1", 0, 3) === "ID3") {
		const size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9];
		offset = 10 + size;
	}
	let seconds = 0;
	let frames = 0;
	while (offset + 4 <= data.length) {
		if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
			offset += 1;
			continue;
		}
		const version = (data[offset + 1] >> 3) & 3; // 3: MPEG1, 2: MPEG2, 0: MPEG2.5
		const layer = (data[offset + 1] >> 1) & 3; // 1: Layer III
		const bitrateIndex = data[offset + 2] >> 4;
		const rateIndex = (data[offset + 2] >> 2) & 3;
		const padding = (data[offset + 2] >> 1) & 1;
		if (
			version === 1 ||
			layer !== 1 ||
			bitrateIndex === 0 ||
			bitrateIndex === 15 ||
			rateIndex === 3
		) {
			offset += 1;
			continue;
		}
		const bitrate = BITRATES[version === 3 ? 1 : 2][bitrateIndex] * 1000;
		const rate = RATES[version][rateIndex];
		const samples = version === 3 ? 1152 : 576;
		const length = Math.floor(((samples / 8) * bitrate) / rate) + padding;
		if (length <= 4) break;
		seconds += samples / rate;
		frames += 1;
		offset += length;
	}
	return frames === 0 ? null : Math.round(seconds * 1000);
}

// --- 測る -------------------------------------------------------------------------------

function probeDurationMs(path, ffprobe) {
	if (ffprobe) {
		const out = execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=nw=1:nk=1",
				path,
			],
			{ encoding: "utf8" },
		);
		const seconds = Number(out.trim());
		if (Number.isFinite(seconds) && seconds > 0)
			return Math.round(seconds * 1000);
	}
	return mp3DurationMs(readFileSync(path));
}

/** 積分ラウドネス（LUFS）。ffmpeg が無い・測れないなら null。 */
function loudness(path) {
	// ffmpeg は結果を stderr に出す。
	const result = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostats",
			"-i",
			path,
			"-af",
			"loudnorm=print_format=summary",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" },
	);
	return parseIntegrated(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

function parseIntegrated(text) {
	const match = /Input Integrated:\s+(-?[0-9.]+) LUFS/.exec(text);
	return match === null ? null : Number(match[1]);
}

function round(value, digits) {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
}

// --- 本体 -------------------------------------------------------------------------------

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`停止: ${error.message}`);
		console.error(
			"使い方: node tools/audio_assets.mjs [--src <元のフォルダ>] [--out <配信するフォルダ>]",
		);
		process.exit(2);
	}
	const inRepo = options.out === repo || options.out.startsWith(repo + sep);
	if (inRepo && !options.out.startsWith(join(repo, "assets-src") + sep)) {
		console.error(
			`停止: リポジトリの中では assets-src/ の下だけに書く（素材をコミットしないため）: ${options.out}`,
		);
		process.exit(2);
	}
	if (!existsSync(options.src)) {
		console.error(`停止: 元のフォルダが無い: ${options.src}`);
		process.exit(2);
	}
	const ffprobe = has("ffprobe");
	const ffmpeg = has("ffmpeg");
	if (!ffprobe)
		console.warn("注意: ffprobe が無いので、MP3 のフレームを数えて長さを出す");
	if (!ffmpeg)
		console.warn(
			"注意: ffmpeg が無いので、BGM の倍率は 1 のまま（音量をそろえない）",
		);

	const problems = [];
	const audio = [];
	const audioDir = join(options.out, `v${VERSION}`, "audio");
	mkdirSync(audioDir, { recursive: true });
	for (const source of SOURCES) {
		const path = findSource(options.src, source.file);
		if (path === null) {
			problems.push(`${source.file} が無い（${options.src}）`);
			continue;
		}
		const durationMs = probeDurationMs(path, ffprobe);
		if (durationMs === null) {
			problems.push(`${source.file} の長さを測れない（MP3 でない？）`);
			continue;
		}
		let gain = source.gain ?? 1;
		let lufs = null;
		if (source.kind === "bgm" && ffmpeg) {
			lufs = loudness(path);
			if (lufs !== null) gain = 10 ** ((BGM_TARGET_LUFS - lufs) / 20);
		}
		const entry = {
			key: source.key,
			kind: source.kind,
			version: VERSION,
			path: `v${VERSION}/audio/${source.key}.mp3`,
			bytes: statSync(path).size,
			durationMs,
			gain: round(gain, 2),
		};
		if (source.loop !== undefined) {
			const loop = {
				...source.loop,
				endMs: Math.min(source.loop.endMs, durationMs),
			};
			if (loop.endMs <= loop.startMs + loop.crossfadeMs) {
				problems.push(
					`${source.file} の loop が長さ（${durationMs} ms）に合わない`,
				);
				continue;
			}
			if (loop.endMs !== source.loop.endMs) {
				console.warn(
					`注意: ${source.file} の loop の終わりを、長さ ${durationMs} ms に縮めた`,
				);
			}
			entry.loop = loop;
		}
		copyFileSync(path, join(options.out, entry.path));
		audio.push({ ...entry, lufs });
	}
	if (problems.length > 0) {
		console.error("停止: manifest.json は書いていない");
		for (const problem of problems) console.error(`  - ${problem}`);
		process.exit(2);
	}

	const manifestPath = join(options.out, "manifest.json");
	const manifest = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, "utf8"))
		: { version: 1, assets: [] };
	manifest.audio = audio.map(({ lufs: _lufs, ...entry }) => entry);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

	console.log(`書いた: ${manifestPath}（audio 欄 ${audio.length} 件）`);
	console.log("key\tkind\tms\tbytes\tLUFS\tgain\tloop");
	for (const a of audio) {
		const loop =
			a.loop === undefined
				? "-"
				: `${a.loop.startMs}-${a.loop.endMs}/${a.loop.crossfadeMs}`;
		console.log(
			`${a.key}\t${a.kind}\t${a.durationMs}\t${a.bytes}\t${a.lufs ?? "-"}\t${a.gain}\t${loop}`,
		);
	}
	const total = audio.reduce((sum, a) => sum + a.bytes, 0);
	console.log(
		`合計: ${total} バイト（${(total / 1_000_000).toFixed(2)} MB。目標 3.7 MB 以下）`,
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
