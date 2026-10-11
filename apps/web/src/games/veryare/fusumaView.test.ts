import * as THREE from "three";
import { describe, expect, it } from "vitest";
import hirayaFixture from "../../../../../packages/contracts/src/fixtures/veryare-hiraya-stage.json";
import { createFusumaView } from "./fusumaView";
import { parseStageNotice } from "./stage";

const grid = parseStageNotice(hirayaFixture.stage);
if (grid === null) throw new Error("平屋の見本が読めない");

const fusuma = new Set(
	hirayaFixture.stage.doors
		.filter((door) => door.kind === "fusuma")
		.map(({ a, b }) => {
			const [p, q] = a.x < b.x || (a.x === b.x && a.z <= b.z) ? [a, b] : [b, a];
			return `${p.x},${p.z}|${q.x},${q.z}`;
		}),
);

/**
 * 和室A-ダイニングの4枚戸（tsv の値: 操作軸の中心 (-0.05, 4.15)、z 方向、幅 3.56。板の中心の z は
 * 内側 3.705・4.595、外側 2.835・5.465）を、glb と同じ名前と親子で組む。
 */
function hiraya4(): {
	root: THREE.Group;
	panel: (name: string) => THREE.Object3D;
} {
	const root = new THREE.Group();
	const axis = new THREE.Group();
	axis.name = "ドア 引違い戸 4枚戸 操作軸-002";
	axis.position.set(-0.05, 0.6, 4.15);
	root.add(axis);
	const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 3.56));
	frame.name = "ドア 引違い戸 4枚戸 枠-002";
	axis.add(frame);
	const panels: Record<string, number> = {
		"ドア 引違い戸 4枚戸 本体 内側001-002": 3.705,
		"ドア 引違い戸 4枚戸 本体 内側002-002": 4.595,
		"ドア 引違い戸 4枚戸 本体 外側001-002": 2.835,
		"ドア 引違い戸 4枚戸 本体 外側002-002": 5.465,
	};
	for (const [name, z] of Object.entries(panels)) {
		const panel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.08, 0.89));
		panel.name = name;
		panel.position.set(0, 0, z - 4.15);
		axis.add(panel);
	}
	root.updateMatrixWorld(true);
	const panel = (name: string) => {
		const found = root.getObjectByName(name);
		if (found === undefined) throw new Error(name);
		return found;
	};
	return { root, panel };
}

const PANELS = [
	"ドア 引違い戸 4枚戸 本体 内側001-002",
	"ドア 引違い戸 4枚戸 本体 内側002-002",
	"ドア 引違い戸 4枚戸 本体 外側001-002",
	"ドア 引違い戸 4枚戸 本体 外側002-002",
];

/** 板が全部見えるか（true）、全部隠れているか（false）。混ざっていれば null。 */
const panelsShown = (panel: (name: string) => THREE.Object3D) => {
	const shown = PANELS.map((name) => panel(name).visible);
	if (shown.every((v) => v)) return true;
	if (shown.every((v) => !v)) return false;
	return null;
};

describe("createFusumaView - 開いた襖は、板を全部隠し、枠は残す（issue-46）", () => {
	it("襖の通知が先に届き、あとから glb を差し替えても、開いている襖の板は全部隠れる", () => {
		const view = createFusumaView();
		view.update(grid, fusuma);
		const { root, panel } = hiraya4();
		view.attach(root);
		expect(panelsShown(panel)).toBe(false);
		expect(panel("ドア 引違い戸 4枚戸 枠-002").visible).toBe(true);
	});

	it("差し替えが先でも、あとから届いた通知で、開けば全部隠れ、閉じれば全部見える", () => {
		const view = createFusumaView();
		const { root, panel } = hiraya4();
		view.update(grid, new Set());
		view.attach(root);
		expect(panelsShown(panel)).toBe(true);
		view.update(grid, fusuma);
		expect(panelsShown(panel)).toBe(false);
		view.update(grid, new Set());
		expect(panelsShown(panel)).toBe(true);
		expect(panel("ドア 引違い戸 4枚戸 枠-002").visible).toBe(true);
	});

	it("地図が後から届いても、届いた時点で対応づけて、状態を当てる", () => {
		const view = createFusumaView();
		const { root, panel } = hiraya4();
		view.attach(root);
		expect(view.summary()).toEqual({ nodes: 1, edges: 0 });
		expect(panelsShown(panel)).toBe(true);
		view.update(grid, fusuma);
		expect(view.summary()).toEqual({ nodes: 1, edges: 12 });
		expect(panelsShown(panel)).toBe(false);
	});

	it("板は動かさない（位置は glb のまま）", () => {
		const view = createFusumaView();
		const { root, panel } = hiraya4();
		view.update(grid, fusuma);
		view.attach(root);
		const inner = panel("ドア 引違い戸 4枚戸 本体 内側001-002");
		expect(inner.position.z).toBeCloseTo(3.705 - 4.15, 6);
	});
});
