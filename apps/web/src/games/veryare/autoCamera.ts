/**
 * 視点の自動追従（オートカメラ）。視点パッドを触っていないとき、カメラの向き（yaw）を、進む向きの
 * 背後へ、ゆっくり回す。見た目と操作だけで、サーバー・契約・勝敗の判定には関わらない。
 *
 * - 動かすのは yaw だけ。カメラの距離・角度・壁際の守り（ADR 0043）・高さの上限・狙いは変えない
 * - 回す強さは、スティックの向きとカメラの前向きの角度の、横の成分（sin）に比例する。前へ倒して
 *   いれば回さず、角度が maxAngle（100°）を超える（後ろへ倒している）ときも回さない
 * - 回す速さは、目標の速さへ指数で寄せる（急に始めず、急に止めない）。上限は maxRate（毎秒 75°）
 * - 視点パッドを触っている間と、離してから lookDelaySeconds（1.2 秒）は回さない（すぐ止める）
 * - あり・なしは、画面の隅の設定。既定は「あり」で、端末の prefers-reduced-motion がオンなら「なし」。
 *   選んだ値は、その端末に覚える（ADR 0019 の追記。読み書きできなくても動く）
 *
 * three を使わない純粋な関数で、時間は dt（秒）で受け取る。
 */

import { devUrlParams, urlNumber } from "./camera";
import type { SettingStorage } from "./ceilingSetting";
import type { Phase } from "./rules";

/** 追従の定数（開発中だけ URL で変えられる / autoCameraSettings）。 */
export interface AutoCameraSettings {
	/** 回す速さの上限（ラジアン/秒）。 */
	readonly maxRate: number;
	/** 視点パッドを離してから、追従を再開するまでの時間（秒）。 */
	readonly lookDelaySeconds: number;
	/** これより後ろへ倒しているときは回さない、カメラの前向きからの角度（ラジアン）。 */
	readonly maxAngle: number;
	/** 止まっていると見なす速さ（m/秒。これ以下は回さない）。 */
	readonly minSpeed: number;
}

const DEGREE = Math.PI / 180;

export const DEFAULT_AUTO_CAMERA: AutoCameraSettings = {
	maxRate: 75 * DEGREE,
	lookDelaySeconds: 1.2,
	maxAngle: 100 * DEGREE,
	minSpeed: 0.5,
};

/** 回す速さを、目標の速さへ寄せる時定数（秒。約 3 倍の時間で 95%）。 */
export const AUTO_CAMERA_EASE_SECONDS = 0.25;
/** これより遅い回る速さ（ラジアン/秒）は 0 にする（止まりきる）。 */
const RATE_EPSILON = 1e-3;

/** 追従の状態。yaw はカメラの向き（-π〜π）、rate はいまの回る速さ（ラジアン/秒。正で左へ回る）。 */
export interface AutoCameraState {
	readonly yaw: number;
	readonly rate: number;
}

export interface AutoCameraInput {
	/** 移動のスティック（VirtualPad の約束: y は下が正）。上に倒すとカメラの向いている方へ進む。 */
	readonly move: { readonly x: number; readonly y: number };
	/** 進む速さ（m/秒）。 */
	readonly speed: number;
	/** 視点パッドを最後に触ってからの時間（秒。触っている間は 0）。 */
	readonly secondsSinceLook: number;
	/** 追従してよいか（設定が「あり」で、自分が動ける時期 / autoCameraActive）。 */
	readonly enabled: boolean;
	/** 時間の刻み（秒）。 */
	readonly dt: number;
}

/** 角度を -π〜π に直す。 */
function normalize(angle: number): number {
	const turned =
		angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
	return turned === -Math.PI ? Math.PI : turned;
}

/** 目標の回る速さ（ラジアン/秒）。回さないときは 0。 */
function targetRate(
	input: AutoCameraInput,
	settings: AutoCameraSettings,
): number {
	const forward = -input.move.y;
	const right = input.move.x;
	const magnitude = Math.hypot(forward, right);
	if (!Number.isFinite(magnitude) || magnitude === 0) return 0;
	if (!(input.speed > settings.minSpeed)) return 0;
	// カメラの前向きからの角度（0 で前、正で右）。
	if (Math.abs(Math.atan2(right, forward)) > settings.maxAngle) return 0;
	// 右へ進むなら右へ回す（yaw は正で左へ回るので、減らす）。
	return -settings.maxRate * (right / magnitude);
}

/**
 * 1 コマぶん、カメラの向きを回す。追従しないとき（設定が「なし」、動けない時期、視点パッドを触って
 * いる・離してすぐ）は、回る速さを 0 にして、向きをそのまま返す。入力が壊れていても NaN を出さない。
 */
export function stepAutoCamera(
	state: AutoCameraState,
	input: AutoCameraInput,
	settings: AutoCameraSettings = DEFAULT_AUTO_CAMERA,
): AutoCameraState {
	const yaw = Number.isFinite(state.yaw) ? normalize(state.yaw) : 0;
	const rate = Number.isFinite(state.rate) ? state.rate : 0;
	const lookFree = input.secondsSinceLook >= settings.lookDelaySeconds;
	if (!input.enabled || !lookFree) return { yaw, rate: 0 };
	const dt = input.dt;
	if (!Number.isFinite(dt) || dt <= 0) return { yaw, rate };
	const target = targetRate(input, settings);
	const eased =
		target + (rate - target) * Math.exp(-dt / AUTO_CAMERA_EASE_SECONDS);
	const limited = Math.max(
		-settings.maxRate,
		Math.min(settings.maxRate, eased),
	);
	const next = target === 0 && Math.abs(limited) < RATE_EPSILON ? 0 : limited;
	return { yaw: normalize(yaw + next * dt), rate: next };
}

/**
 * 追従する時期か。自分が動けるとき（待機ルーム、準備移動、鬼の探索）だけ。ペイントフェーズ（鬼は
 * 待機ルームで動けるが、対象外）と、動けないとき（観戦中・確定後）は追従しない。
 */
export function autoCameraActive(phase: Phase, movable: boolean): boolean {
	return movable && phase !== "painting";
}

/** URL の名前と、受け付ける範囲（角度は度で受け取る）。 */
const URL_KEYS: readonly [
	keyof AutoCameraSettings,
	string,
	number,
	number,
	number,
][] = [
	["maxRate", "camFollowDeg", 0, 360, DEGREE],
	["lookDelaySeconds", "camFollowDelay", 0, 10, 1],
	["maxAngle", "camFollowAngleDeg", 0, 180, DEGREE],
	["minSpeed", "camFollowMinSpeed", 0, 5, 1],
];

/**
 * 追従の定数。開発用の合図（camera.ts の cameraSettings と同じ）があるときだけ、URL の指定
 * （例: ?roof=1&camFollowDeg=90&camFollowDelay=2）で変える。本番の既定では、いつも DEFAULT_AUTO_CAMERA。
 */
export function autoCameraSettings(
	dev: boolean,
	search: string,
): AutoCameraSettings {
	const params = devUrlParams(dev, search);
	if (params === null) return DEFAULT_AUTO_CAMERA;
	const settings: Record<keyof AutoCameraSettings, number> = {
		...DEFAULT_AUTO_CAMERA,
	};
	for (const [key, name, min, max, unit] of URL_KEYS) {
		const value = urlNumber(params, name, min, max);
		if (value !== null) settings[key] = value * unit;
	}
	return settings;
}

export const AUTO_CAMERA_STORAGE_KEY = "rondo.veryare.autoCamera";

/**
 * 覚えた値を読む。無い・読めない・知らない値なら、既定（「あり」。reducedMotion なら「なし」）。
 */
export function loadAutoCamera(
	storage: SettingStorage | null,
	reducedMotion: boolean,
): boolean {
	try {
		const stored = storage?.getItem(AUTO_CAMERA_STORAGE_KEY);
		if (stored === "on") return true;
		if (stored === "off") return false;
	} catch {
		// 読めない端末では、既定。
	}
	return !reducedMotion;
}

/** 選んだ値を覚える。書けなければ何もしない。 */
export function saveAutoCamera(
	storage: SettingStorage | null,
	enabled: boolean,
): void {
	try {
		storage?.setItem(AUTO_CAMERA_STORAGE_KEY, enabled ? "on" : "off");
	} catch {
		// 使えない端末（プライベートモードなど）では、覚えない。
	}
}
