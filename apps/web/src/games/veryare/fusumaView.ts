/**
 * 平屋の glb の襖の板の表示（issue-46）。three の部品だけを使い、描画（WebGL）は使わない。
 *
 * 地図と開いている襖（update）を状態として持ち、glb を差し替えたとき（attach）にも、その時点の
 * 状態を全部当て直す。襖の通知が glb の差し替えより先に届いても、後から届いても、板は同じ位置になる。
 * 開いた襖は、板（内側も外側も、操作軸の直下の「本体」）を全部隠し、枠（鴨居と柱）は残す。判定では
 * 開いた襖の全幅が通れるので、見た目をそろえる。アニメーションはしない。
 */

import * as THREE from "three";
import {
	type Opening,
	isFusumaAxis,
	isOpenOpening,
	matchFusuma,
} from "./hiraya";
import type { StageGrid } from "./stage";

/** 平屋の glb の襖1組（操作軸のノード）。edges は対応する通知の襖の辺（地図が届いてから決める）。 */
interface FusumaNode {
	readonly opening: Opening;
	/** 開いたら隠す板（操作軸の直下の「本体」）。 */
	readonly panels: readonly THREE.Object3D[];
	edges: readonly string[];
}

export const worldCenter = (object: THREE.Object3D): THREE.Vector3 =>
	new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

/**
 * glb のノードの元の名前。three の GLTFLoader は、name の空白を _ にし、[ ] . : / を取り除く
 * （PropertyBinding.sanitizeNodeName）。元の名前は userData.name に残るので、そちらを使う。
 */
export const originalName = (node: THREE.Object3D): string => {
	const name: unknown = node.userData.name;
	return typeof name === "string" ? name : node.name;
};

/** 操作軸の直下の板（名前に「本体」を含む子。枠は含めない）。 */
export const panelsOf = (axis: THREE.Object3D): THREE.Object3D[] =>
	axis.children.filter((child) => originalName(child).includes("本体"));

/**
 * 平屋の glb の襖を集める。開口（中心・幅・向き）は操作軸の外接箱、隠す板は操作軸の直下の「本体」。
 */
function collectFusuma(root: THREE.Object3D): FusumaNode[] {
	root.updateMatrixWorld(true);
	const axes: THREE.Object3D[] = [];
	root.traverse((node) => {
		if (isFusumaAxis(originalName(node))) axes.push(node);
	});
	return axes.map((axis) => {
		const size = new THREE.Box3()
			.setFromObject(axis)
			.getSize(new THREE.Vector3());
		const center = worldCenter(axis);
		const along: "x" | "z" = size.x >= size.z ? "x" : "z";
		const opening: Opening = {
			name: originalName(axis),
			axis: along,
			x: center.x,
			z: center.z,
			width: Math.max(size.x, size.z),
		};
		return { opening, panels: panelsOf(axis), edges: [] };
	});
}

export interface FusumaView {
	/** 地図と開いている襖。どちらかが null の間は、板を動かさない。 */
	update(grid: StageGrid | null, open: ReadonlySet<string> | null): void;
	/** glb の屋内本体を受け取り、襖を集めて、いまの状態を当てる。 */
	attach(root: THREE.Object3D): void;
	/** 見つけた襖の組の数と、対応づけた辺の数（確かめの記録に使う）。 */
	summary(): { readonly nodes: number; readonly edges: number };
}

export function createFusumaView(): FusumaView {
	let grid: StageGrid | null = null;
	let open: ReadonlySet<string> | null = null;
	let nodes: FusumaNode[] = [];
	/** 襖の辺を対応づけた地図（地図が変わったら、対応づけ直す）。 */
	let matched: StageGrid | null = null;

	const apply = () => {
		if (grid === null || nodes.length === 0) return;
		if (matched !== grid) {
			const edges = matchFusuma(
				nodes.map((node) => node.opening),
				grid,
			);
			for (const node of nodes) node.edges = edges.get(node.opening.name) ?? [];
			matched = grid;
		}
		if (open === null) return;
		for (const node of nodes) {
			const isOpen = isOpenOpening(node.edges, open);
			for (const panel of node.panels) panel.visible = !isOpen;
		}
	};

	return {
		update(nextGrid, nextOpen) {
			grid = nextGrid;
			open = nextOpen;
			apply();
		},
		attach(root) {
			nodes = collectFusuma(root);
			matched = null;
			apply();
		},
		summary() {
			return {
				nodes: nodes.length,
				edges: nodes.reduce((sum, node) => sum + node.edges.length, 0),
			};
		},
	};
}
