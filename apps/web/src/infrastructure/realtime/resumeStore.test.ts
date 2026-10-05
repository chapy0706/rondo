import { describe, expect, it } from "vitest";
import { type StorageLike, createResumeStore } from "./resumeStore";

class MemoryStorage implements StorageLike {
	readonly items = new Map<string, string>();
	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.items.set(key, value);
	}
	removeItem(key: string): void {
		this.items.delete(key);
	}
}

const target = { gameType: "veryare", roomId: "room-1", resumeToken: "t-1" };

describe("createResumeStore - リロードをまたぐ復帰先（issue-40）", () => {
	it("保存した復帰先を読み戻せる", () => {
		const store = createResumeStore(new MemoryStorage());
		store.save(target);
		expect(store.load()).toEqual(target);
	});

	it("消したら null", () => {
		const store = createResumeStore(new MemoryStorage());
		store.save(target);
		store.clear();
		expect(store.load()).toBeNull();
	});

	it("形の違う値・壊れた JSON は null（境界で検証する）", () => {
		const storage = new MemoryStorage();
		const store = createResumeStore(storage);
		for (const raw of [
			"not json",
			"null",
			JSON.stringify({ gameType: "veryare", roomId: "room-1" }),
			JSON.stringify({ ...target, resumeToken: 1 }),
		]) {
			storage.items.set("rondo.resume", raw);
			expect(store.load()).toBeNull();
		}
	});

	it("ストレージが使えない（null や例外）ときも、例外を出さず null として動く", () => {
		expect(createResumeStore(null).load()).toBeNull();
		const broken: StorageLike = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		const store = createResumeStore(broken);
		expect(() => store.save(target)).not.toThrow();
		expect(() => store.clear()).not.toThrow();
		expect(store.load()).toBeNull();
	});
});
