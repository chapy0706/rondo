import { describe, expect, it } from "vitest";
import {
	LOBBY_REFRESH_MS,
	type RefreshDeps,
	startListRefresh,
} from "./listRefresh";

/** 偽の時計（every）と偽の可視状態。 */
function fake(options: { visible?: boolean; busy?: boolean } = {}) {
	let visible = options.visible ?? true;
	let busy = options.busy ?? false;
	let requests = 0;
	const timers: { ms: number; cb: () => void }[] = [];
	const listeners = new Set<() => void>();
	const deps: RefreshDeps = {
		request: () => {
			requests += 1;
		},
		visible: () => visible,
		busy: () => busy,
		onVisibilityChange: (cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		every: (cb, ms) => {
			const timer = { ms, cb };
			timers.push(timer);
			return () => {
				timers.splice(timers.indexOf(timer), 1);
			};
		},
	};
	return {
		deps,
		tick: () => {
			for (const timer of [...timers]) timer.cb();
		},
		setVisible: (next: boolean) => {
			visible = next;
			for (const cb of [...listeners]) cb();
		},
		setBusy: (next: boolean) => {
			busy = next;
		},
		requests: () => requests,
		timers: () => timers.length,
		listeners: () => listeners.size,
	};
}

describe("startListRefresh - ロビーの一覧の自動更新（issue-60）", () => {
	it("間隔は 5 秒。見えている間、間隔ごとに一覧を頼む", () => {
		expect(LOBBY_REFRESH_MS).toBe(5000);
		const f = fake();
		startListRefresh(f.deps);
		expect(f.requests()).toBe(0);
		f.tick();
		f.tick();
		expect(f.requests()).toBe(2);
	});

	it("画面が見えない間は止め、見えるようになったら、すぐ 1 回頼む", () => {
		const f = fake();
		startListRefresh(f.deps);
		f.setVisible(false);
		f.tick();
		f.tick();
		expect(f.requests()).toBe(0);
		f.setVisible(true);
		expect(f.requests()).toBe(1);
		f.tick();
		expect(f.requests()).toBe(2);
	});

	it("参加・作成の返事を待っている間（busy）は、頼まない", () => {
		const f = fake({ busy: true });
		startListRefresh(f.deps);
		f.tick();
		f.setVisible(true);
		expect(f.requests()).toBe(0);
		f.setBusy(false);
		f.tick();
		expect(f.requests()).toBe(1);
	});

	it("止めると、時計と可視状態の見張りを外す", () => {
		const f = fake();
		const stop = startListRefresh(f.deps);
		expect(f.timers()).toBe(1);
		expect(f.listeners()).toBe(1);
		stop();
		expect(f.timers()).toBe(0);
		expect(f.listeners()).toBe(0);
	});
});
