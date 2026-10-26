import { describe, expect, it } from "vitest";
import type { SoundEngine } from "../../infrastructure/audio/engine";
import { createSoundHub } from "./hub";
import { DEFAULT_SOUND_SETTINGS, SOUND_SETTINGS_KEY } from "./settings";

/** 呼び出しを記録する偽のエンジン。 */
function fakeEngine(calls: string[]): SoundEngine {
	return {
		unlock: () => calls.push("unlock"),
		preload: (keys) => calls.push(`preload ${keys.join(",")}`),
		setGains: (g) => calls.push(`gains ${g.master}/${g.bgm}/${g.se}`),
		setBgm: (key) => calls.push(`bgm ${key}`),
		play: (key) => {
			calls.push(`play ${key}`);
			return { stop: () => calls.push(`stop ${key}`) };
		},
		loop: (key) => {
			calls.push(`loop ${key}`);
			return { stop: () => calls.push(`stop ${key}`) };
		},
		durationMs: () => 1000,
		suspend: () => calls.push("suspend"),
		resume: () => calls.push("resume"),
		close: () => calls.push("close"),
	};
}

function memory() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
		values,
	};
}

function setup(options: { throwing?: boolean } = {}) {
	const calls: string[] = [];
	let created = 0;
	const storage = memory();
	const hub = createSoundHub({
		createEngine: () => {
			created += 1;
			if (options.throwing) {
				const engine = fakeEngine(calls);
				return new Proxy(engine, {
					get: () => () => {
						throw new Error("壊れた");
					},
				});
			}
			return fakeEngine(calls);
		},
		storage: () => storage,
	});
	return { hub, calls, storage, created: () => created };
}

describe("音の入口（旗と、エンジンの隔離 / issue-63）", () => {
	it("旗が無い間は、エンジンを作らず、どの呼び出しも何もしない", () => {
		const s = setup();
		s.hub.configure(false, "/select");
		s.hub.unlock();
		s.hub.setGameBgm("bgm-game");
		s.hub.setResult(true);
		s.hub.setHidden(true);
		s.hub.play("se-hit").stop();
		s.hub.loop("se-paint").stop(100);
		expect(s.hub.durationMs("se-count")).toBeUndefined();
		expect(s.created()).toBe(0);
		expect(s.calls).toEqual([]);
		expect(s.hub.snapshot().enabled).toBe(false);
	});

	it("旗があれば、エンジンを 1 つ作り、音量・先読み・場面の BGM を渡す", () => {
		const s = setup();
		s.hub.configure(true, "/select");
		s.hub.configure(true, "/lobby/veryare");
		expect(s.created()).toBe(1);
		expect(s.calls).toContain("gains 1/0.35/0.35");
		expect(s.calls).toContain("preload bgm-top,se-count,se-start");
		expect(s.calls).toContain("bgm bgm-top");
	});

	it("場面の変化で BGM を決める（ゲームの知らせ・結果画面）", () => {
		const s = setup();
		s.hub.configure(true, "/play/veryare");
		s.hub.setGameBgm("bgm-game");
		s.hub.setResult(true);
		s.hub.setResult(false);
		s.hub.setGameBgm(undefined);
		const bgm = s.calls.filter((call) => call.startsWith("bgm "));
		expect(bgm).toEqual([
			"bgm bgm-top",
			"bgm bgm-game",
			"bgm null",
			"bgm bgm-game",
			"bgm bgm-top",
		]);
	});

	it("設定: 変えると端末に覚え、音量を渡し、知らせる。ミュートは全体を 0 に", () => {
		const s = setup();
		s.hub.configure(true, "/select");
		let notified = 0;
		const off = s.hub.subscribe(() => {
			notified += 1;
		});
		s.hub.updateSettings({ ...DEFAULT_SOUND_SETTINGS, muted: true });
		expect(s.calls.at(-1)).toBe("gains 0/0.35/0.35");
		expect(s.storage.values.get(SOUND_SETTINGS_KEY)).toContain('"muted":true');
		expect(s.hub.snapshot().settings.muted).toBe(true);
		expect(notified).toBe(1);
		off();
	});

	it("旗を外すと、エンジンを閉じて、以後は何もしない", () => {
		const s = setup();
		s.hub.configure(true, "/select");
		s.hub.configure(false, "/select");
		expect(s.calls.at(-1)).toBe("close");
		const before = s.calls.length;
		s.hub.play("se-hit");
		expect(s.calls.length).toBe(before);
	});

	it("見えなくなったら止め、戻ったら再開する", () => {
		const s = setup();
		s.hub.configure(true, "/select");
		s.hub.setHidden(true);
		s.hub.setHidden(false);
		expect(s.calls.slice(-2)).toEqual(["suspend", "resume"]);
	});

	it("エンジンが例外を投げても、呼び出し側へは出さない", () => {
		const s = setup({ throwing: true });
		expect(() => {
			s.hub.configure(true, "/select");
			s.hub.unlock();
			s.hub.setGameBgm("bgm-game");
			s.hub.play("se-hit").stop();
			s.hub.loop("se-paint").stop(10);
			s.hub.durationMs("se-count");
			s.hub.setHidden(true);
		}).not.toThrow();
	});
});
