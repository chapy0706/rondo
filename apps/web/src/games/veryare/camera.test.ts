import { describe, expect, it } from "vitest";
import {
	BODY_FADE_END,
	BODY_FADE_START,
	BODY_MIN_OPACITY,
	CAMERA_PITCH_MAX,
	DEFAULT_CAMERA,
	cameraSettings,
	selfBodyOpacity,
} from "./camera";
import { cameraLogMessage, fullReach, reachedPose } from "./cameraRig";

describe("CAMERA_PITCH_MAX - 壁に近づいたときの、見下ろす角度の上限", () => {
	it("0.45 rad（約 26°）。見る点を前へずらす量の既定は 1.0 m", () => {
		expect(CAMERA_PITCH_MAX).toBe(0.45);
		expect(DEFAULT_CAMERA.pitchMax).toBe(0.45);
		expect(DEFAULT_CAMERA.lookAhead).toBe(1.0);
	});
});

describe("cameraSettings - 開発中だけ、URL でカメラの定数を変えられる", () => {
	const all =
		"?camDistance=3&camPitch=0.4&camPitchMax=0.8&camMargin=0.3&camSettle=0.2&camMinHeight=0.5&camLookAhead=1.5&camMaxHeight=2";

	it("本番の既定（開発用の合図なし）では、URL の指定を無視する", () => {
		expect(cameraSettings(false, all)).toEqual(DEFAULT_CAMERA);
	});

	it("開発用の変数か ?roof=1 のとき、指定した値を使う", () => {
		const expected = {
			distance: 3,
			pitch: 0.4,
			pitchMax: 0.8,
			wallMargin: 0.3,
			settleSeconds: 0.2,
			minHeight: 0.5,
			lookAhead: 1.5,
			maxHeight: 2,
		};
		expect(cameraSettings(true, all)).toEqual(expected);
		expect(cameraSettings(false, `${all}&roof=1`)).toEqual(expected);
	});

	it("指定の無い値・数でない値・範囲の外の値は、既定のまま", () => {
		const s = cameraSettings(
			true,
			"?camPitchMax=0.5&camMargin=abc&camDistance=-1&camSettle=100",
		);
		expect(s).toEqual({ ...DEFAULT_CAMERA, pitchMax: 0.5 });
	});

	it("角度の上限が既定の角度より小さいときは、既定の角度にそろえる（近づいて角度が下がらない）", () => {
		expect(cameraSettings(true, "?camPitch=0.5&camPitchMax=0.3").pitchMax).toBe(
			0.5,
		);
	});
});

describe("reachedPose / fullReach - 設定を渡せる", () => {
	it("水平の距離 0 のときの角度は、設定の上限", () => {
		const settings = { ...DEFAULT_CAMERA, pitchMax: 0.8 };
		expect(
			reachedPose({ x: 0, z: 0, feet: 0 }, 0, 0, settings).pitch,
		).toBeCloseTo(0.8, 9);
		expect(reachedPose({ x: 0, z: 0, feet: 0 }, 0, 0).pitch).toBeCloseTo(
			0.45,
			9,
		);
	});

	it("開けた所の水平の距離は、設定の距離と角度から決まる", () => {
		expect(fullReach({ ...DEFAULT_CAMERA, distance: 3, pitch: 0 })).toBeCloseTo(
			3,
			9,
		);
	});
});

describe("selfBodyOpacity - カメラが近いほど、自分の体を半透明にする", () => {
	it("しきい値（1.0 m）以上なら不透明、0.3 m 以下なら最小（0.25）", () => {
		expect(BODY_FADE_START).toBe(1.0);
		expect(BODY_FADE_END).toBe(0.3);
		expect(BODY_MIN_OPACITY).toBe(0.25);
		expect(selfBodyOpacity(2.4)).toBe(1);
		expect(selfBodyOpacity(1.0)).toBe(1);
		expect(selfBodyOpacity(0.3)).toBe(0.25);
		expect(selfBodyOpacity(0)).toBe(0.25);
	});

	it("間は、距離に比例して変わる（近いほど薄い）", () => {
		expect(selfBodyOpacity(0.65)).toBeCloseTo(0.625, 9);
		expect(selfBodyOpacity(0.5)).toBeLessThan(selfBodyOpacity(0.8));
	});
});

describe("cameraLogMessage - 開発中だけ Console に出す、カメラの高さの1行", () => {
	it("床の高さ、床からのカメラの高さ、水平の距離、見下ろす角度を出す", () => {
		expect(
			cameraLogMessage({
				feet: 0.6,
				cameraY: 2.2,
				reach: 1.25,
				lookDown: (30 * Math.PI) / 180,
			}),
		).toBe(
			"[veryare-camera] 床 0.60 m・カメラは床から 1.60 m（世界の y 2.20）・水平の距離 1.25 m・見下ろす角度 30°",
		);
	});
});
