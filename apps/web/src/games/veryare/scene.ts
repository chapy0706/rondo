/**
 * veryare の 3D シーン（three.js）。
 *
 * 1つのシーンの中に、待機ルームとステージを別々のグループとして持ち、自分がいる空間の
 * グループだけを表示する（ADR 0024）。待機ルームは半径2mの円柱形の部屋で、中央に
 * 同心円の鬼希望エリアを置く。エリアの色は赤（待機）/ 緑（開始）/ 青（鬼希望）。ステージは、ステージの通知から組む床・壁・襖の箱（stageBoxes.ts / issue-29c）。
 *
 * 平屋（issue-46）: 平屋の glb（屋内本体・屋外の飾り・屋根と天井）が待機ルームの間に読めていれば、
 * 箱の代わりに glb を、glb の座標のまま置く。箱は見えなくするだけで残し、ペイントのスポイト
 * （サーバーの判定と同じ代表色）の当たりに使う。屋根と天井は既定で隠す（TPS のカメラを遮るため）。
 * 襖は、開いていれば内側の板を外側の板に重ね、閉じていれば元の位置に戻す（hiraya.ts）。
 * いつも開いている片開き戸は、丁番で 90 度回して置く。読めなければ、箱の表示のまま（移動の規則は同じ）。
 * 平屋の床は地面より高い（畳 0.6 m など）。glb を表示している間は、体（自分・鬼・隠れ側・CPU）の
 * 足もとを、立っているマスの床の高さ（hiraya.ts の floorHeight）に合わせる。自分と鬼は、段差で
 * 跳ねないよう、なめらかに寄せる（feet.ts）。カメラは体の高さについて行く（camera.ts の cameraPose）。
 * ステージのカメラは、体のいる領域の外に出さない（ADR 0043 / cameraRig.ts）。ペイント画面と待機ルームでは、
 * これまでどおり（setCameraClamp で切り替える）。
 * 判定は持たない。何を表示するかは rules.ts とサーバーの通知が決める。
 *
 * 観戦（issue-28）: 鬼と隠れ側（探索開始時の一括配信）も描く。カメラは自分か鬼を中央に
 * 固定した周回カメラ（ADR 0034）で、向きは視点パッドだけで変わり、鬼の向きには引きずられ
 * ない。ほかの人の画面の鬼は、届いた通知の間を補間した位置で描く（oniTrack.ts。Veryare.tsx が計算）。
 * 鬼本人の画面では、通知の位置の鬼は描かず、自分の体を鬼の体（赤いカプセルと正面の印）にして、
 * 手元の位置と向きで動かす（setSelfOni）。
 */

import type { VeryarePaint } from "@rondo/contracts";
import * as THREE from "three";
import type { SwapSlot } from "../../infrastructure/assets";
import type { HirayaModel } from "./assetSlots";
import { type AssetEvent, stageDisplayEvent } from "./assetTrace";
import {
	type BodyKit,
	type PaintSurface,
	createPaintSurface,
	paintedMaterial,
	placeholderBodyKit,
} from "./body";
import { CAMERA_PITCH, CAMERA_WALL_MARGIN, cameraPose } from "./camera";
import {
	CAMERA_FULL_REACH,
	cameraReach,
	followCameraReach,
	reachedPose,
} from "./cameraRig";
import { followFloor } from "./feet";
import { createFusumaView, panelsOf, worldCenter } from "./fusumaView";
import {
	HINGED_SWING,
	floorHeight,
	isHingedAxis,
	isHirayaStage,
	swingAngle,
} from "./hiraya";
import { intersectCylinder } from "./paint";
import type { View } from "./rules";
import {
	type AreaState,
	ONI_AREA_RADIUS,
	type Point,
	type Space,
	WAITING_ROOM_RADIUS,
	areaLook,
} from "./rules";
import type { StageGrid } from "./stage";
import { type StageBox, stageBoxes } from "./stageBoxes";

/** テーマの色（globals.css のトークンと揃える）。 */
const COLORS = {
	ink: 0x13111f,
	surface: 0x1e1b2e,
	line: 0x2e2a45,
	accent: 0xf5b841,
	sub: 0x5fd3c4,
} as const;

/** 鬼希望エリアの色（ADR 0024）。 */
const AREA_COLORS = {
	red: 0xef4444,
	green: 0x22c55e,
	blue: 0x3b82f6,
} as const;

const WALL_HEIGHT = 1.2;

export interface VeryareScene {
	/** 表示する空間を切り替える。もう一方のグループは描かない。 */
	setSpace(space: Space): void;
	/** ステージの地図と、開いている襖（edgeKey）。地図が null なら何も描かない（issue-29c）。 */
	setStage(grid: StageGrid | null, open: ReadonlySet<string>): void;
	/**
	 * 平屋の glb の差し替え口（issue-46）。待機ルームにいる間だけ take() し、ステージへ移ったら
	 * lock() する。null なら差し替えない（箱の表示）。
	 */
	setStageModel(slot: SwapSlot<HirayaModel> | null): void;
	/** 平屋の glb を表示しているか（屋根の切り替えのボタンを出すかに使う）。 */
	stageModelShown(): boolean;
	/** 屋根と天井を表示するか（既定は隠す / issue-46）。 */
	setRoofVisible(visible: boolean): void;
	/**
	 * カメラを、体のいる領域の外に出さないか（ADR 0043）。ステージの準備移動・探索・答え合わせ・観戦で
	 * true、ペイント画面と待機ルームでは false。
	 */
	setCameraClamp(enabled: boolean): void;
	/** 鬼希望エリアの状態（鬼選出中だけ。null ならエリアを隠す）。 */
	setArea(area: AreaState | null): void;
	/** 自分のアバターの位置と色。 */
	/**
	 * 自分のアバターの位置と色。color は塗っていない部分の色、paint は自分のペイント
	 * （ペイントフェーズで描いている途中を含む / issue-25）。
	 */
	setAvatar(position: Point, color: string, paint: VeryarePaint | null): void;
	/** 三人称カメラの向き（yaw: Y 軸まわり、pitch: 見下ろす角度）。 */
	setCamera(yaw: number, pitch: number): void;
	/** カメラの中心。self は自分、oni は鬼（ADR 0034）。 */
	setView(view: View): void;
	/**
	 * ほかの人の画面の鬼（探索中だけ。null なら隠す）。位置は補間済みのものを、そのまま置く。
	 * facing はサーバーの向き（x 軸から z 軸へ）。
	 */
	setOni(oni: SceneOni | null): void;
	/**
	 * 鬼本人の画面（issue-46）。facing が数なら、自分の体の代わりに鬼の体を、手元の位置とその向きで
	 * 描く。null なら、ふつうの自分の体。
	 */
	setSelfOni(facing: number | null): void;
	/** 隠れ側（自分を除く）。color は "#rrggbb"。 */
	setHiders(hiders: readonly SceneHider[]): void;
	/**
	 * 答え合わせの赤い点滅（ADR 0033 / issue-29d）。ids の隠れ側と、self なら自分の体を、
	 * level（0〜1）の強さで赤く光らせる。ids が空で self が false なら、光らせない。
	 */
	setBlink(ids: readonly string[], self: boolean, level: number): void;
	/**
	 * ペイント画面のタップ（画面の正規化座標 -1〜1）が当たったもの（issue-25）。自分の体に
	 * 当たれば描き込み面の u・v（壁より先）、当たらなければステージの箱の色（スポイト）。
	 * 何にも当たらなければ null。
	 */
	pickPaint(x: number, y: number): PaintPick | null;
	/** 画面の中央（照準）に重なっている隠れ側の ID。重なっていなければ null（issue-27）。 */
	pickHider(): string | null;
	resize(width: number, height: number): void;
	render(): void;
	dispose(): void;
}

export interface SceneOni {
	readonly x: number;
	readonly z: number;
	readonly facing: number;
}

export interface SceneHider {
	readonly id: string;
	readonly x: number;
	readonly z: number;
	/** 塗っていない部分の色。 */
	readonly color: string;
	/** 探索の開始に届いたペイント（issue-25）。無ければ null。 */
	readonly paint: VeryarePaint | null;
}

export type PaintPick =
	| { readonly kind: "body"; readonly u: number; readonly v: number }
	| { readonly kind: "stage"; readonly color: string };

export interface SceneOptions {
	/**
	 * 体を作る口の差し替え（素材の X Bot / issue-25・issue-43）。待機ルームにいる間だけ take() し、
	 * ステージへ移ったら lock() する。無ければ、ずっと仮のカプセル。
	 */
	readonly bodies?: SwapSlot<BodyKit>;
	/** 素材の流れの記録（差し替えた・ステージに入ったときの表示と理由 / 開発中だけ Console へ）。 */
	readonly trace?: (event: AssetEvent) => void;
}

const ONI_COLOR = 0xef4444;
/** 答え合わせの点滅の色（赤い発光）。 */
const BLINK_COLOR = 0xff1a1a;

interface WaitingRoom {
	readonly group: THREE.Group;
	/** 鬼希望エリア（円と縁）。色を状態に合わせて変える。 */
	readonly area: THREE.Group;
	readonly areaFill: THREE.MeshBasicMaterial;
	readonly areaRim: THREE.MeshBasicMaterial;
}

/** 円柱形の待機ルーム。円い床と、内側から見える円筒の壁。 */
function waitingRoom(): WaitingRoom {
	const group = new THREE.Group();

	const floorDisc = new THREE.Mesh(
		new THREE.CircleGeometry(WAITING_ROOM_RADIUS, 64),
		new THREE.MeshStandardMaterial({ color: COLORS.line }),
	);
	floorDisc.rotation.x = -Math.PI / 2;
	group.add(floorDisc);

	const wall = new THREE.Mesh(
		new THREE.CylinderGeometry(
			WAITING_ROOM_RADIUS,
			WAITING_ROOM_RADIUS,
			WALL_HEIGHT,
			64,
			1,
			true,
		),
		new THREE.MeshStandardMaterial({
			color: COLORS.surface,
			side: THREE.BackSide,
		}),
	);
	wall.position.y = WALL_HEIGHT / 2;
	group.add(wall);

	// 鬼希望エリア（同心円）。床の少し上に置いてちらつきを避ける。
	const area = new THREE.Group();
	const areaFill = new THREE.MeshBasicMaterial({
		color: AREA_COLORS.green,
		transparent: true,
		opacity: 0.25,
	});
	const fill = new THREE.Mesh(
		new THREE.CircleGeometry(ONI_AREA_RADIUS, 48),
		areaFill,
	);
	fill.rotation.x = -Math.PI / 2;
	fill.position.y = 0.005;
	const areaRim = new THREE.MeshBasicMaterial({ color: AREA_COLORS.green });
	const rim = new THREE.Mesh(
		new THREE.RingGeometry(ONI_AREA_RADIUS - 0.05, ONI_AREA_RADIUS, 48),
		areaRim,
	);
	rim.rotation.x = -Math.PI / 2;
	rim.position.y = 0.006;
	area.add(fill, rim);
	group.add(area);

	return { group, area, areaFill, areaRim };
}

/**
 * ステージの箱（stageBoxes.ts の一覧）を、色ごとに1つの InstancedMesh にまとめて描く。
 * 最も大きい骨格でも描画の呼び出しは十数回に収まる。
 */
function stageMeshes(boxes: readonly StageBox[]): THREE.InstancedMesh[] {
	const byColor = new Map<string, StageBox[]>();
	for (const box of boxes) {
		const list = byColor.get(box.color) ?? [];
		list.push(box);
		byColor.set(box.color, list);
	}
	const unit = new THREE.BoxGeometry(1, 1, 1);
	const matrix = new THREE.Matrix4();
	const meshes: THREE.InstancedMesh[] = [];
	for (const [color, list] of byColor) {
		const mesh = new THREE.InstancedMesh(
			unit,
			new THREE.MeshStandardMaterial({ color }),
			list.length,
		);
		list.forEach((box, index) => {
			matrix.makeScale(box.width, box.height, box.depth);
			matrix.setPosition(box.x, box.y, box.z);
			mesh.setMatrixAt(index, matrix);
		});
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		// スポイトで拾う色（表の色そのもの / issue-25）。
		mesh.userData.color = color;
		meshes.push(mesh);
	}
	return meshes;
}

/**
 * いつも開いている片開き戸（室内の3つ）を、丁番を軸に 90 度回して置く。丁番の位置に軸の
 * ノードを置き（pivots の下。ワールドと同じ座標）、板をその子に付け替えて回す。
 */
function openHingedDoors(root: THREE.Object3D, pivots: THREE.Object3D): void {
	root.updateMatrixWorld(true);
	const axes: THREE.Object3D[] = [];
	root.traverse((node) => {
		if (isHingedAxis(node.name)) axes.push(node);
	});
	for (const axis of axes) {
		const [panel] = panelsOf(axis);
		if (panel === undefined) continue;
		const hinges: THREE.Object3D[] = [];
		panel.traverse((node) => {
			if (node.name.includes("本体丁番")) hinges.push(node);
		});
		const [hinge] = hinges;
		if (hinge === undefined) continue;
		const hingeAt = worldCenter(hinge);
		const center = worldCenter(panel);
		const pivot = new THREE.Object3D();
		pivot.position.copy(hingeAt);
		pivots.add(pivot);
		pivot.updateMatrixWorld(true);
		pivot.attach(panel);
		pivot.rotation.y = swingAngle(
			{ x: hingeAt.x, z: hingeAt.z },
			{ x: center.x, z: center.z },
			HINGED_SWING[axis.name] ?? 1,
		);
	}
}

export function createScene(
	canvas: HTMLCanvasElement,
	options: SceneOptions = {},
): VeryareScene {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(COLORS.ink);
	scene.add(new THREE.HemisphereLight(0xffffff, COLORS.ink, 1.2));
	const sun = new THREE.DirectionalLight(0xffffff, 1.4);
	sun.position.set(3, 6, 2);
	scene.add(sun);

	const room = waitingRoom();
	const spaces: Record<Space, THREE.Group> = {
		"waiting-room": room.group,
		// ステージの通知が届くまでは、何も描かない（setStage で組む）。
		stage: new THREE.Group(),
	};
	scene.add(spaces["waiting-room"], spaces.stage);

	let bodyKit: BodyKit = placeholderBodyKit;
	const avatarSurface = createPaintSurface();
	const avatarMaterial = paintedMaterial(avatarSurface.texture);
	let avatar = bodyKit.create(avatarMaterial);
	avatar.position.y = 0.5;
	scene.add(avatar);
	/** 体を作る口が替わったら、自分の体を作り直す（位置はそのまま）。隠れ側は次の setHiders で作り直す。 */
	const useBodyKit = (kit: BodyKit) => {
		if (kit === bodyKit) return;
		bodyKit = kit;
		const next = kit.create(avatarMaterial);
		next.position.copy(avatar.position);
		scene.remove(avatar);
		avatar.geometry.dispose();
		avatar = next;
		scene.add(avatar);
		hiderKey = "";
	};
	// 隠れ側の描き込み面（作り直すときに捨てる）。
	const hiderSurfaces: PaintSurface[] = [];

	// 鬼の体。正面が分かるよう、前に小さな印を付ける。グループの原点が足もと。
	const oniFigure = (): THREE.Group => {
		const group = new THREE.Group();
		const body = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.2, 0.6, 4, 12),
			new THREE.MeshStandardMaterial({ color: ONI_COLOR }),
		);
		body.position.y = 0.5;
		const nose = new THREE.Mesh(
			new THREE.ConeGeometry(0.08, 0.2, 8),
			new THREE.MeshStandardMaterial({ color: COLORS.accent }),
		);
		nose.rotation.x = Math.PI / 2;
		nose.position.set(0, 0.75, 0.25);
		group.add(body, nose);
		group.visible = false;
		scene.add(group);
		return group;
	};
	/** 正面の印（ローカルの +z）を、サーバーの向き facing の方へ回す角度。 */
	const turnOf = (facing: number) =>
		Math.atan2(Math.cos(facing), Math.sin(facing));
	// ほかの人の画面の鬼（通知の間を補間した位置）と、鬼本人の画面の自分の体。
	const oni = oniFigure();
	const selfOni = oniFigure();

	const hiderGroup = new THREE.Group();
	scene.add(hiderGroup);
	let hiderKey = "";

	const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
	let yaw = 0;
	let pitch = CAMERA_PITCH;
	let view: View = "self";
	let lastRender = performance.now();

	/** 体の足もとの高さ（平屋の床 / issue-46）。自分と鬼は、なめらかに寄せる。 */
	let avatarFeet = 0;
	let oniFeet = 0;
	/** 鬼が見え始めたか（次の描画で、寄せずに床の高さに合わせる）。 */
	let oniAppeared = false;

	/** カメラを領域の中に収めるか（ADR 0043）と、いまの水平の距離（なめらかに寄せる）。 */
	let cameraClamp = false;
	let cameraReachNow = CAMERA_FULL_REACH;
	/** 前の描画のカメラの中心（替わったら、寄せずに合わせる）。 */
	let cameraCenterKind: "self" | "oni" | null = null;

	const cameraCenter = () => {
		const onOni = view === "oni" && oni.visible;
		const body = onOni ? oni.position : avatar.position;
		return {
			kind: onOni ? ("oni" as const) : ("self" as const),
			x: body.x,
			z: body.z,
			feet: onOni ? oniFeet : avatarFeet,
		};
	};

	const placeCamera = () => {
		const center = cameraCenter();
		const pose =
			cameraClamp && stageGrid !== null
				? reachedPose(center, yaw, cameraReachNow)
				: cameraPose(center, yaw, pitch);
		camera.position.set(pose.position.x, pose.position.y, pose.position.z);
		camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
	};

	/** カメラの水平の距離を、体の領域に収まる距離へ寄せる（縮むときは即座）。描画のたびに呼ぶ。 */
	const updateCameraReach = (dt: number, snap: boolean) => {
		const center = cameraCenter();
		const switched = center.kind !== cameraCenterKind;
		cameraCenterKind = center.kind;
		if (!cameraClamp || stageGrid === null) {
			cameraReachNow = CAMERA_FULL_REACH;
			return;
		}
		const want = {
			x: center.x + Math.sin(yaw) * CAMERA_FULL_REACH,
			z: center.z + Math.cos(yaw) * CAMERA_FULL_REACH,
		};
		const allowed = Math.max(
			0,
			Math.min(
				CAMERA_FULL_REACH,
				cameraReach(stageGrid, center, want) * CAMERA_FULL_REACH -
					CAMERA_WALL_MARGIN,
			),
		);
		cameraReachNow =
			snap || switched
				? allowed
				: followCameraReach(cameraReachNow, allowed, dt);
	};

	let stageGrid: StageGrid | null = null;
	let stageOpen: ReadonlySet<string> | null = null;

	// ステージの中身: 箱（地図と襖の状態から組み直す）と、平屋の glb（差し替えたら置いたまま）。
	const boxGroup = new THREE.Group();
	const modelGroup = new THREE.Group();
	spaces.stage.add(boxGroup, modelGroup);
	let stageSlot: SwapSlot<HirayaModel> | null = null;
	let model: HirayaModel | null = null;
	/** glb の襖の板（襖の状態を持ち、差し替えのときにも当て直す / fusumaView.ts）。 */
	const fusumaView = createFusumaView();
	let roofVisible = false;

	/** glb を表示するか（差し替え済みで、地図が平屋のとき）。 */
	const modelShown = () =>
		model !== null && stageGrid !== null && isHirayaStage(stageGrid);

	/** glb の襖の板を、いまの地図と開いている襖に合わせて置く。 */
	const placeFusuma = () => {
		fusumaView.update(stageGrid, stageOpen);
	};

	const showStage = () => {
		const shown = modelShown();
		modelGroup.visible = shown;
		// 箱は、glb を表示している間も見えなくするだけで残す（スポイトの当たりに使う）。
		boxGroup.visible = !shown;
		if (model?.roof != null) model.roof.visible = roofVisible;
	};

	/** 平屋の glb を、glb の座標のまま置く（差し替えは1回だけ）。 */
	const attachModel = (next: HirayaModel) => {
		model = next;
		modelGroup.add(next.indoor);
		if (next.outdoor !== null) modelGroup.add(next.outdoor);
		if (next.roof !== null) modelGroup.add(next.roof);
		// 差し替えの前に届いていた襖の状態も、ここで当て直す（fusumaView が状態を持っている）。
		fusumaView.update(stageGrid, stageOpen);
		fusumaView.attach(next.indoor);
		openHingedDoors(next.indoor, modelGroup);
		options.trace?.({ kind: "fusuma", ...fusumaView.summary() });
		showStage();
		options.trace?.({ kind: "swapped" });
	};
	/** 直前の空間（待機ルームからステージへ移ったときに、表示と理由を1回だけ記録する）。 */
	let lastSpace: Space | null = null;
	/** 前の描画の空間（空間が変わったら、足もとを寄せずに床の高さに合わせる）。 */
	let renderedSpace: Space | null = null;

	/** 立っている位置の床の高さ。ステージで、平屋の glb を表示しているときだけ 0 でない。 */
	const floorAt = (x: number, z: number): number =>
		lastSpace === "stage" && stageGrid !== null
			? floorHeight(stageGrid, { x, z }, modelShown())
			: 0;

	const clearStage = () => {
		const meshes = [...boxGroup.children];
		boxGroup.clear();
		const geometries = new Set<THREE.BufferGeometry>();
		for (const mesh of meshes) {
			if (!(mesh instanceof THREE.InstancedMesh)) continue;
			geometries.add(mesh.geometry);
			(mesh.material as THREE.Material).dispose();
			mesh.dispose();
		}
		for (const geometry of geometries) geometry.dispose();
	};

	return {
		setStage(grid, open) {
			// 地図か襖の状態が変わったときだけ組み直す（襖の通知はまれ）。
			if (grid === stageGrid && open === stageOpen) return;
			stageGrid = grid;
			stageOpen = open;
			clearStage();
			if (grid !== null) {
				for (const mesh of stageMeshes(stageBoxes(grid, open))) {
					boxGroup.add(mesh);
				}
			}
			placeFusuma();
			showStage();
		},
		setStageModel(slot) {
			stageSlot = slot;
		},
		stageModelShown() {
			return modelShown();
		},
		setCameraClamp(enabled) {
			if (enabled && !cameraClamp) cameraCenterKind = null;
			cameraClamp = enabled;
		},
		setRoofVisible(visible) {
			if (visible === roofVisible) return;
			roofVisible = visible;
			showStage();
		},
		setSpace(space) {
			if (space === "waiting-room") {
				const kit = options.bodies?.take();
				if (kit != null) useBodyKit(kit);
				// 平屋の glb の差し替えも、待機ルームにいる間だけ（issue-46）。
				const next = model === null ? stageSlot?.take() : null;
				if (next != null) attachModel(next);
			} else {
				options.bodies?.lock();
				if (lastSpace !== "stage") {
					options.trace?.(
						stageDisplayEvent({
							hasGrid: stageGrid !== null,
							hiraya: stageGrid !== null && isHirayaStage(stageGrid),
							hasSlot: stageSlot !== null,
							swapped: model !== null,
						}),
					);
				}
				stageSlot?.lock();
			}
			lastSpace = space;
			spaces["waiting-room"].visible = space === "waiting-room";
			spaces.stage.visible = space === "stage";
		},
		setArea(area) {
			room.area.visible = area !== null;
			if (area === null) return;
			const color = AREA_COLORS[areaLook(area).color];
			room.areaFill.color.setHex(color);
			room.areaRim.color.setHex(color);
		},
		setAvatar(position, color, paint) {
			avatar.position.x = position.x;
			avatar.position.z = position.z;
			avatarSurface.draw(color, paint);
		},
		setCamera(nextYaw, nextPitch) {
			yaw = nextYaw;
			pitch = nextPitch;
		},
		setView(next) {
			view = next;
		},
		setOni(next) {
			if (next === null) {
				oni.visible = false;
				return;
			}
			// 見え始めたときは、足もとを寄せずに床の高さに合わせる（render）。
			if (!oni.visible) oniAppeared = true;
			oni.visible = true;
			oni.position.x = next.x;
			oni.position.z = next.z;
			oni.rotation.y = turnOf(next.facing);
		},
		setSelfOni(facing) {
			const asOni = facing !== null;
			selfOni.visible = asOni;
			avatar.visible = !asOni;
			if (asOni) selfOni.rotation.y = turnOf(facing);
		},
		setHiders(hiders) {
			const key = hiders
				.map(
					(h) => `${h.id}:${h.x}:${h.z}:${h.color}:${JSON.stringify(h.paint)}`,
				)
				.join("|");
			if (key === hiderKey) return;
			hiderKey = key;
			for (const child of [...hiderGroup.children]) {
				hiderGroup.remove(child);
				if (child instanceof THREE.Mesh) {
					child.geometry.dispose();
					(child.material as THREE.Material).dispose();
				}
			}
			for (const surface of hiderSurfaces.splice(0)) surface.dispose();
			for (const hider of hiders) {
				const surface = createPaintSurface();
				surface.draw(hider.color, hider.paint);
				hiderSurfaces.push(surface);
				const mesh = bodyKit.create(paintedMaterial(surface.texture));
				mesh.position.set(hider.x, 0.5, hider.z);
				mesh.userData.playerId = hider.id;
				hiderGroup.add(mesh);
			}
		},
		setBlink(ids, self, level) {
			const glow = (material: THREE.MeshStandardMaterial, on: boolean) => {
				material.emissive.setHex(BLINK_COLOR);
				material.emissiveIntensity = on ? level : 0;
			};
			glow(avatarMaterial, self);
			const targets = new Set(ids);
			for (const child of hiderGroup.children) {
				if (!(child instanceof THREE.Mesh)) continue;
				const id: unknown = child.userData.playerId;
				glow(
					child.material as THREE.MeshStandardMaterial,
					typeof id === "string" && targets.has(id),
				);
			}
		},
		pickPaint(x, y) {
			placeCamera();
			avatar.updateMatrixWorld();
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
			// 自分の体: 光線を体のローカル座標へ移し、描き込み面の円柱との交差を求める。
			const inverse = avatar.matrixWorld.clone().invert();
			const origin = raycaster.ray.origin.clone().applyMatrix4(inverse);
			const direction = raycaster.ray.direction
				.clone()
				.transformDirection(inverse);
			const body = intersectCylinder({ origin, direction });
			// 体に当たれば、体を先にする（カメラが壁の裏に回っても、自分の体には描ける。
			// カメラの壁へのめり込みは許容している / ADR 0034）。
			if (body !== null) return { kind: "body", u: body.u, v: body.v };
			// ステージの箱（スポイト）。箱の色は、描画の色ではなく、表の色（userData.color）。
			// 平屋の glb を表示している間も、見えない箱に当てて代表色を拾う（issue-46）。
			const [stageHit] = spaces.stage.visible
				? raycaster.intersectObjects(boxGroup.children, false)
				: [];
			const color: unknown = stageHit?.object.userData.color;
			return typeof color === "string" ? { kind: "stage", color } : null;
		},
		pickHider() {
			// 照準は画面の中央。鬼自身の体は当てる対象に入れず、隠れ側だけを見る。
			// 壁越しかどうかはここでは見ない（サーバーの判定に任せる / ADR 0022）。
			placeCamera();
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
			const [hit] = raycaster.intersectObjects(hiderGroup.children, false);
			const id: unknown = hit?.object.userData.playerId;
			return typeof id === "string" ? id : null;
		},
		resize(width, height) {
			renderer.setSize(width, height, false);
			camera.aspect = width / Math.max(height, 1);
			camera.updateProjectionMatrix();
		},
		render() {
			const now = performance.now();
			const dt = Math.min((now - lastRender) / 1000, 0.1);
			lastRender = now;
			// 足もとの高さ（issue-46）。空間が変わったとき・鬼が見え始めたときは、寄せずに合わせる。
			const jumped = renderedSpace !== lastSpace;
			renderedSpace = lastSpace;
			const avatarFloor = floorAt(avatar.position.x, avatar.position.z);
			avatarFeet = jumped
				? avatarFloor
				: followFloor(avatarFeet, avatarFloor, dt);
			avatar.position.y = 0.5 + avatarFeet;
			// 鬼本人の体は、自分の体と同じ位置（手元の位置）に、足もとを合わせて置く。
			selfOni.position.set(avatar.position.x, avatarFeet, avatar.position.z);
			if (oni.visible) {
				const oniFloor = floorAt(oni.position.x, oni.position.z);
				oniFeet =
					jumped || oniAppeared ? oniFloor : followFloor(oniFeet, oniFloor, dt);
				oniAppeared = false;
				oni.position.y = oniFeet;
			}
			// 隠れ側（CPU を含む）は動かないので、立っているマスの床の高さに直に置く。
			for (const child of hiderGroup.children) {
				child.position.y = 0.5 + floorAt(child.position.x, child.position.z);
			}
			updateCameraReach(dt, jumped);
			placeCamera();
			renderer.render(scene, camera);
		},
		dispose() {
			scene.traverse((object) => {
				if (object instanceof THREE.Mesh) {
					object.geometry.dispose();
					const materials = Array.isArray(object.material)
						? object.material
						: [object.material];
					for (const material of materials) material.dispose();
				}
			});
			avatarSurface.dispose();
			for (const surface of hiderSurfaces.splice(0)) surface.dispose();
			renderer.dispose();
		},
	};
}
