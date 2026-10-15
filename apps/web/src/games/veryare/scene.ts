/**
 * veryare の 3D シーン（three.js）。
 *
 * 1つのシーンの中に、待機ルームとステージを別々のグループとして持ち、自分がいる空間の
 * グループだけを表示する（ADR 0024）。待機ルームは半径 3.5 m（ADR 0044）の円柱形の部屋で、中央に
 * 同心円の鬼希望エリアを置く。エリアの色は赤（待機）/ 緑（開始）/ 青（鬼希望）。ステージは、ステージの通知から組む床・壁・襖の箱（stageBoxes.ts / issue-29c）。
 *
 * 平屋（issue-46）: 平屋の glb（屋内本体・屋外の飾り・屋根と天井）が待機ルームの間に読めていれば、
 * 箱の代わりに glb を、glb の座標のまま置く。箱は見えなくするだけで残し、鬼の狙いの壁と床の当たりに
 * 使う。ペイントのスポイトと「ここの色」は、glb の見えている一番手前の面の見た目の色を拾う
 * （surfaceColor.ts）。屋根と天井は既定で隠す（TPS のカメラを遮るため）。
 * 襖は、開いていれば板を全部隠し、閉じていれば見せる（fusumaView.ts）。
 * いつも開いている片開き戸は、丁番で 90 度回して置く。読めなければ、箱の表示のまま（移動の規則は同じ）。
 * ランダム間取り: 材質の素材（stage-materials）が待機ルームの間に読めていれば、箱を材質と寄せる色の組
 * ごとに1つの形にまとめて、平屋の材質を貼って描く（stageSurfaces.ts）。色の箱は見えなくするだけで残し、
 * 狙いの当たりに使う。スポイトは、貼った面の絵の画素 × 材質の色。読めない・形が違うときは、色の箱のまま。
 * 天井（箱の ceiling）は、色の箱でも材質を貼った箱でも別のグループにまとめ、設定（ceilingSetting.ts）の
 * とおりに見せる。天井は、狙いの当たりにもスポイトにも入れない。平屋は、屋根と天井の glb のうち天井の
 * ノードだけを設定で切り替える。光: 半球の光（地面側は暖かい茶色。天井の下面を照らす）と、自分のカメラに
 * 近い部屋の灯り（数は一定 / roomLights.ts）。ステージの背景は、暗い暖色の夜の色。
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

import type {
	VeryareModelPose,
	VeryarePaint,
	VeryarePaintPart,
	VeryarePose,
} from "@rondo/contracts";
import * as THREE from "three";
import type { SwapSlot } from "../../infrastructure/assets";
import { type BodyAt, type Vec3, hiderAt, rayHitsBody } from "./aim";
import { type CharacterParts, type HirayaModel, takeOnce } from "./assetSlots";
import {
	type AssetEvent,
	stageDisplayEvent,
	stageMaterialEvent,
} from "./assetTrace";
import {
	type BodyInstance,
	type BodyKit,
	type PaintSurface,
	createModelBodyKit,
	createPaintSurface,
	placeholderBodyKit,
} from "./body";
import { BODY_HEIGHT } from "./bodySize";
import {
	CAMERA_PITCH,
	type CameraSettings,
	DEFAULT_CAMERA,
	cameraPose,
	selfBodyOpacity,
} from "./camera";
import {
	CAMERA_FOV,
	CAMERA_NEAR,
	type FurnitureBox,
	allowedCameraReach,
	placeGuardedCamera,
} from "./cameraGuard";
import { cameraLogMessage, followCameraReach, fullReach } from "./cameraRig";
import { roofNodeVisible, stageCeilingVisible } from "./ceilingSetting";
import { followFloor } from "./feet";
import { parseFurniture } from "./furniture";
import {
	createFusumaView,
	originalName,
	panelsOf,
	worldCenter,
} from "./fusumaView";
import {
	HINGED_SWING,
	floorHeight,
	isHingedAxis,
	isHirayaStage,
	swingAngle,
} from "./hiraya";
import {
	type BodyMotionInfo,
	type MotionSource,
	createMotionRegistry,
} from "./motionRegistry";
import { motionLogMessage } from "./motionState";
import type { MotionWatch, Stall } from "./motionWatch";
import { parseMotionSet } from "./motions";
import { modelPoseOf } from "./poses";
import {
	ROOM_LIGHT_COUNT,
	type Spot,
	nearestSpots,
	roomLightSpots,
} from "./roomLights";
import type { View } from "./rules";
import {
	type AreaState,
	ONI_AREA_RADIUS,
	type Point,
	type Space,
	WAITING_ROOM_RADIUS,
	areaLook,
} from "./rules";
import { type StageGrid, cellAt } from "./stage";
import { type StageBox, stageBoxes } from "./stageBoxes";
import {
	type StageMaterialSet,
	pickStageMaterials,
	stageLayers,
	surfaceMeshes,
} from "./stageSurfaces";
import {
	createTextureReader,
	drawOnCanvas,
	firstVisibleHit,
	surfaceColor,
} from "./surfaceColor";
import type { TestableScene } from "./testHooks";

/** テーマの色（globals.css のトークンと揃える）。 */
const COLORS = {
	ink: 0x13111f,
	surface: 0x1e1b2e,
	line: 0x2e2a45,
	accent: 0xf5b841,
	sub: 0x5fd3c4,
} as const;

/** ステージの背景（天井をなしにしたとき、壁の上から見える色）。暗い暖色の夜の色。 */
const STAGE_BACKGROUND = 0x241a14;
/** 半球の光の地面側の色（下を向く面 = 天井の下面を照らす。暖かい茶色）。 */
const HEMISPHERE_GROUND = 0x6e5a46;
/** 部屋の灯り（暖かい電球の色）。高さは天井の少し下。 */
const ROOM_LIGHT_COLOR = 0xffd9a8;
const ROOM_LIGHT_INTENSITY = 4;
const ROOM_LIGHT_DISTANCE = 6;
const ROOM_LIGHT_HEIGHT = 2.1;

/** 鬼希望エリアの色（ADR 0024）。 */
const AREA_COLORS = {
	red: 0xef4444,
	green: 0x22c55e,
	blue: 0x3b82f6,
} as const;

const WALL_HEIGHT = 1.2;

export interface VeryareScene extends TestableScene {
	/** 表示する空間を切り替える。もう一方のグループは描かない。 */
	setSpace(space: Space): void;
	/** ステージの地図と、開いている襖（edgeKey）。地図が null なら何も描かない（issue-29c）。 */
	setStage(grid: StageGrid | null, open: ReadonlySet<string>): void;
	/**
	 * 平屋の glb の差し替え口（issue-46）。待機ルームにいる間だけ take() し、ステージへ移ったら
	 * lock() する。null なら差し替えない（箱の表示）。
	 */
	setStageModel(slot: SwapSlot<HirayaModel> | null): void;
	/**
	 * ランダム間取りの材質の差し替え口（stage-materials）。待機ルームにいる間に1回だけ受け取り、
	 * ステージへ移ったら lock() する。null なら貼らない（色の箱）。
	 */
	setStageMaterials(slot: SwapSlot<THREE.Group> | null): void;
	/** 平屋の glb を表示しているか（屋根の切り替えのボタンを出すかに使う）。 */
	stageModelShown(): boolean;
	/** 屋根を表示するか（開発用。既定は隠す / issue-46）。 */
	setRoofVisible(visible: boolean): void;
	/** 天井を表示するか（画面の隅の設定。既定はあり / ceilingSetting.ts）。 */
	setCeilingVisible(visible: boolean): void;
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
	/**
	 * 自分の体の、選んだポーズ（issue-56。選んでいなければ null）と、静止の指定（issue-57。ペイント
	 * フェーズ・確定のあと）。体は、実際に進んだ距離から求めた速さで、待機・歩く・走る・ポーズを切り替える
	 * （motionState.ts）。素材の体のときだけ変わる（仮のカプセルでは何もしない）。
	 */
	setAvatarPose(chosen: VeryareModelPose | null, fixed: boolean): void;
	/** 自分の体の向き（サーバーの向き。x 軸から z 軸へ）。null なら変えない。 */
	setAvatarFacing(facing: number | null): void;
	/** 素材の体に差し替えたか（ポーズボタンを出すかに使う / issue-56）。 */
	bodyPosable(): boolean;
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
	 * 待機ルームのほかのメンバー（issue-59。自分を除く、最大 4 人）。位置と向きは補間済みのものを置き、
	 * 動き（待機・歩く・走る・待機ポーズ）は、描画ごとの位置の変化から決める。頭上に名前を出す。
	 * 一覧に無い人の体と名前は消す。待機ルームを表示しているときだけ見せる。
	 */
	setMembers(members: readonly SceneMember[]): void;
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
	/**
	 * ここの色（いまいる場所の色）。平屋の glb を表示しているときだけ、体の真下へ線を引き、見えている
	 * 一番手前の面（足もとの床）の見た目の色を返す（マスごとに覚える）。表示していなければ null
	 * （呼び出し側が、サーバーの代表色の表を使う）。
	 */
	floorColorAt(x: number, z: number): string | null;
	/** 画面の中央（照準）に重なっている隠れ側の ID。重なっていなければ null（issue-27）。 */
	pickHider(): string | null;
	/**
	 * 鬼の視界に入っている隠れ側（issue-32 / ADR 0036）。体の低い所か高い所が、カメラの視界の中に
	 * あり、壁と閉じた襖の箱（狙いの当たりと同じ）に遮られていなければ、見えているとする。
	 */
	sightedHiders(): string[];
	/**
	 * 鬼の狙い（タップ）。画面の点（-1〜1）からカメラを通る線を引き、最初に当たったもの（隠れ側の体、
	 * 壁、床）の位置と、それが体なら隠れ側の ID。何にも当たらなければ null。
	 */
	pickAim(x: number, y: number): { point: Vec3; hiderId: string | null } | null;
	/** 狙う点（目印を出し、そこにいる隠れ側を光らせる）。null なら消す。 */
	setAim(point: Vec3 | null): void;
	/** 隠れ側の体の位置と足もと（狙う点から相手を決めるのに使う）。 */
	hiderBodies(): (BodyAt & { readonly id: string })[];
	/**
	 * 見えている体ごとの動きの状態（体の名前・状態・再生の時間・重み / motionRegistry.ts）。体の名前は
	 * self（自分の体）、self-oni（鬼本人の体）、oni（ほかの人の画面の鬼。人間と CPU）、
	 * member:<プレイヤー ID>（待機ルームのほかのメンバー）。テスト用の口と、開発中の Console に使う。
	 */
	motionInfos(): readonly BodyMotionInfo[];
	/** 動きの止まりの記録（見張りがあるときだけ。無ければ空 / motionWatch.ts）。 */
	motionStalls(): readonly Stall[];
	resize(width: number, height: number): void;
	render(): void;
	dispose(): void;
}

/** 待機ルームのほかのメンバー1人（issue-59）。facing はサーバーの向き。 */
export interface SceneMember {
	readonly id: string;
	readonly name: string;
	readonly x: number;
	readonly z: number;
	readonly facing: number;
	readonly pose: VeryareModelPose | null;
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
	/** 向き（サーバーの向き）。人間の隠れ側は null（向きを変えない）。 */
	readonly facing: number | null;
	/** ポーズ（CPU の3種類か、素材のポーズの識別子 / issue-56）。null は既定の立ち姿。 */
	readonly pose: VeryarePose | null;
	/** 塗っていない部分の色。 */
	readonly color: string;
	/** 探索の開始に届いたペイント（issue-25）。無ければ null。 */
	readonly paint: VeryarePaint | null;
}

export type PaintPick =
	| {
			readonly kind: "body";
			/** 当たった部位（issue-54。仮のカプセルは胴）。 */
			readonly part: VeryarePaintPart;
			readonly u: number;
			readonly v: number;
	  }
	| { readonly kind: "stage"; readonly color: string };

export interface SceneOptions {
	/**
	 * キャラクターの素材（X Bot とポーズの表 / issue-56・issue-43）。待機ルームにいる間だけ take() し、
	 * ステージへ移ったら lock() する。無い・壊れているときは、ずっと仮のカプセル。
	 */
	readonly bodies?: SwapSlot<CharacterParts<THREE.Group>>;
	/** 素材の流れの記録（差し替えた・ステージに入ったときの表示と理由 / 開発中だけ Console へ）。 */
	readonly trace?: (event: AssetEvent) => void;
	/** カメラの定数（開発中だけ URL で変えられる / camera.ts の cameraSettings）。無ければ既定。 */
	readonly camera?: CameraSettings;
	/** 開発中だけ渡す。カメラの高さの1行（cameraLogMessage）を、CAMERA_LOG_SECONDS ごとに受け取る。 */
	readonly cameraLog?: (message: string) => void;
	/**
	 * 開発中だけ渡す。見えている体ごとの動きの状態・時間・重み（motionLogMessage）を、MOTION_LOG_SECONDS
	 * ごとに受け取る（issue-57。動きが止まる不具合を、目視で見つけるため）。
	 */
	readonly motionLog?: (message: string) => void;
	/**
	 * 動きの見張り（motionWatch.ts）。テスト用の口か、開発用の合図のときだけ渡す。本番の既定では渡さない
	 * （作らない）。
	 */
	readonly watch?: MotionWatch;
}

const ONI_COLOR = 0xef4444;
/** 待機ルームのほかのメンバーの体の色（素材の体では、色を付けない部分の下地 / issue-59）。 */
const MEMBER_COLOR = 0x9fb4cf;
/** 頭上の名前の高さ（足もとから）と、名前の板の大きさ（メートル）。 */
const MEMBER_LABEL_HEIGHT = BODY_HEIGHT + 0.3;
const MEMBER_LABEL_SIZE = { width: 1.2, height: 0.3 } as const;
/** 名前の画像の大きさ（画素）。 */
const MEMBER_LABEL_PIXELS = { width: 256, height: 64 } as const;
/** 鬼の正面の印の高さ（体の高さの 3/4）。 */
const ONI_NOSE_HEIGHT = BODY_HEIGHT * 0.75;
/** 狙う点にいる隠れ側の光り方（黄色の発光）と、目印の色。 */
const AIM_COLOR = 0xf5b841;
const AIM_GLOW = 0.6;
/** 開発中に、体の動きの状態を Console に出す間隔（秒）。 */
const MOTION_LOG_SECONDS = 1;
/** ここの色を求めるとき、線を引き始める高さ（足もとから。メートル）。 */
const FLOOR_PROBE_HEIGHT = 0.5;
/** 開発中に、カメラの高さを Console に出す間隔（秒）。 */
const CAMERA_LOG_SECONDS = 1;
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
		if (isHingedAxis(originalName(node))) axes.push(node);
	});
	for (const axis of axes) {
		const [panel] = panelsOf(axis);
		if (panel === undefined) continue;
		const hinges: THREE.Object3D[] = [];
		panel.traverse((node) => {
			if (originalName(node).includes("本体丁番")) hinges.push(node);
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
			HINGED_SWING[originalName(axis)] ?? 1,
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
	const roomBackground = new THREE.Color(COLORS.ink);
	const stageBackground = new THREE.Color(STAGE_BACKGROUND);
	scene.background = roomBackground;
	scene.add(new THREE.HemisphereLight(0xffffff, HEMISPHERE_GROUND, 1.2));
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
	/** キャラクターの素材を、差し替え口から1回だけ受け取る。 */
	const takeCharacter = takeOnce(options.bodies);
	const avatarSurface = createPaintSurface();
	let avatar = bodyKit.create(avatarSurface.texture, 0xffffff);
	/** 自分の体の動き（issue-57）: 選んだポーズと、静止の指定。 */
	let avatarChosen: VeryareModelPose | null = null;
	let avatarFixed = false;
	scene.add(avatar.object);
	/**
	 * 動きのある体の登録所（issue-57 の後半）。自分の体・鬼本人の体・ほかの人の画面の鬼・待機ルームの
	 * メンバーを登録し、描画のたびに登録所を回すだけにする。体の差し替え（useBodyKit）のあとも、
	 * 登録所が、いまの動きを新しい体に当てる。
	 */
	const motions = createMotionRegistry({
		speeds: () => bodyKit.motionSpeeds,
		watch: options.watch ?? null,
	});
	/**
	 * 体を作る口が替わったら、自分の体と鬼の体を作り直す（位置・向き・ポーズ・見え方はそのまま）。
	 * 隠れ側は次の setHiders で作り直す。
	 */
	const useBodyKit = (kit: BodyKit) => {
		if (kit === bodyKit) return;
		bodyKit = kit;
		const next = kit.create(avatarSurface.texture, 0xffffff);
		next.object.position.copy(avatar.object.position);
		next.object.rotation.copy(avatar.object.rotation);
		next.object.visible = avatar.object.visible;
		scene.remove(avatar.object);
		avatar.dispose();
		avatar = next;
		scene.add(avatar.object);
		for (const figure of [oniParts, selfOniParts]) {
			figure.group.remove(figure.body.object);
			figure.body.dispose();
			figure.body = oniBody(figure.group);
		}
		hiderKey = "";
		// 待機ルームのメンバーの体も作り直す（名前と動きの状態はそのまま）。
		for (const figure of memberFigures.values()) {
			figure.group.remove(figure.body.object);
			figure.body.dispose();
			figure.body = memberBody(figure.group);
		}
	};
	// 隠れ側の描き込み面（作り直すときに捨てる）。
	const hiderSurfaces: PaintSurface[] = [];

	// 鬼の体（赤い体 / issue-56）。動き（待機・歩く・走る）は、自分の体と同じ登録所で当てる（issue-57 の
	// 後半）。正面が分かるよう、前に小さな印を付ける。
	// グループの原点が足もと。
	const oniBody = (group: THREE.Group): BodyInstance => {
		const body = bodyKit.create(null, ONI_COLOR);
		body.snap();
		group.add(body.object);
		return body;
	};
	const oniFigure = (): { readonly group: THREE.Group; body: BodyInstance } => {
		const group = new THREE.Group();
		const nose = new THREE.Mesh(
			new THREE.ConeGeometry(0.08, 0.2, 8),
			new THREE.MeshStandardMaterial({ color: COLORS.accent }),
		);
		nose.rotation.x = Math.PI / 2;
		nose.position.set(0, ONI_NOSE_HEIGHT, 0.25);
		group.add(nose);
		const body = oniBody(group);
		group.visible = false;
		scene.add(group);
		return { group, body };
	};
	/** 正面の印（ローカルの +z）を、サーバーの向き facing の方へ回す角度。 */
	const turnOf = (facing: number) =>
		Math.atan2(Math.cos(facing), Math.sin(facing));
	// ほかの人の画面の鬼（通知の間を補間した位置）と、鬼本人の画面の自分の体。
	const oniParts = oniFigure();
	const selfOniParts = oniFigure();
	const oni = oniParts.group;
	const selfOni = selfOniParts.group;
	// 登録所への登録。位置は、自分と鬼本人は手元の位置、ほかの人の画面の鬼は補間した位置（setOni）。
	// 速さは、その位置の描画ごとの変化から求める（鬼 CPU も同じ）。
	motions.add({
		name: "self",
		body: () => avatar,
		where: () => (avatar.object.visible ? avatar.object.position : null),
		chosen: () => avatarChosen,
		fixed: () => avatarFixed,
	});
	motions.add({
		name: "self-oni",
		body: () => selfOniParts.body,
		where: () => (selfOni.visible ? avatar.object.position : null),
		chosen: () => null,
		fixed: () => false,
	});
	motions.add({
		name: "oni",
		body: () => oniParts.body,
		where: () => (oni.visible ? oni.position : null),
		chosen: () => null,
		fixed: () => false,
	});
	/** 自分の体（ふつうの体と、鬼本人の体）の材質。半透明にするときに使う。 */
	const selfMaterials = (): THREE.Material[] => {
		const list: THREE.Material[] = [...avatar.materials];
		selfOni.traverse((node) => {
			if (node instanceof THREE.Mesh)
				list.push(node.material as THREE.Material);
		});
		return list;
	};

	const hiderGroup = new THREE.Group();
	scene.add(hiderGroup);
	// 狙う点の目印（小さな球）と、狙う点。
	const aimMarker = new THREE.Mesh(
		new THREE.SphereGeometry(0.06, 12, 8),
		new THREE.MeshBasicMaterial({ color: AIM_COLOR }),
	);
	aimMarker.visible = false;
	scene.add(aimMarker);
	let aimPoint: Vec3 | null = null;
	/** 隠れ側の体（体の原点は足もと）。 */
	const bodiesOf = (): (BodyAt & { readonly id: string })[] =>
		hiderGroup.children.flatMap((child) => {
			const id: unknown = child.userData.playerId;
			return typeof id === "string"
				? [
						{
							id,
							x: child.position.x,
							z: child.position.z,
							feet: child.position.y,
						},
					]
				: [];
		});
	let hiderKey = "";
	/** 隠れ側の体（hiderGroup の子と同じ並び）。 */
	const hiderInstances: BodyInstance[] = [];

	// 待機ルームのほかのメンバー（issue-59）。体と頭上の名前を、メンバーごとのグループに持つ。
	const memberGroup = new THREE.Group();
	memberGroup.visible = false;
	scene.add(memberGroup);
	interface MemberFigure {
		readonly group: THREE.Group;
		body: BodyInstance;
		label: THREE.Sprite;
		name: string;
		target: SceneMember;
		/** 登録所からの取り消し。 */
		readonly unregister: () => void;
	}
	const memberFigures = new Map<string, MemberFigure>();
	const memberBody = (group: THREE.Group): BodyInstance => {
		const body = bodyKit.create(null, MEMBER_COLOR);
		body.snap();
		group.add(body.object);
		return body;
	};
	/** メンバー1人を登録所に載せる口。待機ルームを表示している間だけ見える。 */
	const memberSource = (
		id: string,
		figure: () => MemberFigure,
	): MotionSource => ({
		name: `member:${id}`,
		body: () => figure().body,
		where: () => (memberGroup.visible ? figure().target : null),
		chosen: () => figure().target.pose,
		fixed: () => false,
	});
	/**
	 * 頭上の名前（Sprite）。名前は文字として canvas に描く（HTML として解釈しない）。画像と材質は、
	 * 作り直すとき・体を消すときに disposeLabel で解放する。
	 */
	const memberLabel = (name: string): THREE.Sprite => {
		const canvas = document.createElement("canvas");
		canvas.width = MEMBER_LABEL_PIXELS.width;
		canvas.height = MEMBER_LABEL_PIXELS.height;
		const context = canvas.getContext("2d");
		if (context !== null) {
			const { width, height } = MEMBER_LABEL_PIXELS;
			context.fillStyle = "rgba(15, 23, 42, 0.7)";
			context.beginPath();
			context.roundRect(0, 0, width, height, height / 2);
			context.fill();
			context.fillStyle = "#ffffff";
			context.font = "bold 32px sans-serif";
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText(name, width / 2, height / 2, width - 24);
		}
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		const sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: texture, transparent: true }),
		);
		sprite.scale.set(MEMBER_LABEL_SIZE.width, MEMBER_LABEL_SIZE.height, 1);
		sprite.position.y = MEMBER_LABEL_HEIGHT;
		return sprite;
	};
	const disposeLabel = (sprite: THREE.Sprite) => {
		sprite.material.map?.dispose();
		sprite.material.dispose();
	};
	const removeMember = (id: string) => {
		const figure = memberFigures.get(id);
		if (figure === undefined) return;
		memberGroup.remove(figure.group);
		figure.unregister();
		figure.body.dispose();
		disposeLabel(figure.label);
		memberFigures.delete(id);
	};

	// ニアクリップは小さくし、壁の余白をそれより大きくする（壁際で壁の中が映らない / cameraGuard.ts）。
	const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, 100);
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
	const cameraSet = options.camera ?? DEFAULT_CAMERA;
	/** 開けた所での、カメラの水平の距離（設定の距離と角度から）。 */
	const cameraFull = fullReach(cameraSet);
	let cameraReachNow = cameraFull;
	/** 前の描画のカメラの中心（替わったら、寄せずに合わせる）。 */
	let cameraCenterKind: string | null = null;

	const cameraCenter = () => {
		// 答え合わせで選んだ隠れ側の隠れ場所（issue-32）。体が無ければ、自分の視点。
		if (typeof view === "object") {
			const id = view.hider;
			const target = hiderGroup.children.find(
				(child) => child.userData.playerId === id,
			);
			if (target !== undefined) {
				return {
					kind: `hider:${id}`,
					x: target.position.x,
					z: target.position.z,
					feet: target.position.y,
				};
			}
		}
		const onOni = view === "oni" && oni.visible;
		const body = onOni ? oni.position : avatar.object.position;
		return {
			kind: onOni ? "oni" : "self",
			x: body.x,
			z: body.z,
			feet: onOni ? oniFeet : avatarFeet,
		};
	};

	const placeCamera = () => {
		const center = cameraCenter();
		const pose =
			cameraClamp && stageGrid !== null
				? placeGuardedCamera(
						stageGrid,
						center,
						yaw,
						cameraReachNow,
						furnitureNow(),
						cameraSet,
					)
				: cameraPose(
						center,
						yaw,
						pitch,
						cameraSet.distance,
						cameraSet.maxHeight,
					);
		camera.position.set(pose.position.x, pose.position.y, pose.position.z);
		camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
		return { center, pose };
	};

	/** 開発中だけ、見えている体ごとの動きの状態を Console に出す（MOTION_LOG_SECONDS ごと）。 */
	let motionLogAt = Number.NEGATIVE_INFINITY;
	const logMotion = (now: number): void => {
		const log = options.motionLog;
		if (log === undefined || now - motionLogAt < MOTION_LOG_SECONDS * 1000)
			return;
		motionLogAt = now;
		for (const info of motions.infos()) {
			log(
				motionLogMessage(info.name, {
					state: info.state,
					speed: info.speed,
					rate: info.rate,
					status: info.clips,
				}),
			);
		}
	};

	/** 開発中だけ、カメラの高さを Console に出す（描画のたびではなく、CAMERA_LOG_SECONDS ごと）。 */
	let cameraLogAt = Number.NEGATIVE_INFINITY;
	const logCamera = (
		now: number,
		placed: ReturnType<typeof placeCamera>,
	): void => {
		const log = options.cameraLog;
		if (log === undefined || now - cameraLogAt < CAMERA_LOG_SECONDS * 1000)
			return;
		cameraLogAt = now;
		const { center, pose } = placed;
		const horizontal = Math.hypot(
			pose.target.x - pose.position.x,
			pose.target.z - pose.position.z,
		);
		log(
			cameraLogMessage({
				feet: center.feet,
				cameraY: pose.position.y,
				reach: Math.hypot(
					pose.position.x - center.x,
					pose.position.z - center.z,
				),
				lookDown: Math.atan2(pose.position.y - pose.target.y, horizontal),
			}),
		);
	};

	/** カメラの水平の距離を、体の領域に収まる距離へ寄せる（縮むときは即座）。描画のたびに呼ぶ。 */
	const updateCameraReach = (dt: number, snap: boolean) => {
		const center = cameraCenter();
		const switched = center.kind !== cameraCenterKind;
		cameraCenterKind = center.kind;
		if (!cameraClamp || stageGrid === null) {
			cameraReachNow = cameraFull;
			return;
		}
		// 地図の守り（領域の境）と、家具の守り（平屋の glb を表示しているときだけ）の、小さいほう。
		const allowed = allowedCameraReach(
			stageGrid,
			center,
			yaw,
			furnitureNow(),
			cameraSet,
		);
		cameraReachNow =
			snap || switched
				? allowed
				: followCameraReach(
						cameraReachNow,
						allowed,
						dt,
						cameraSet.settleSeconds,
					);
	};

	let stageGrid: StageGrid | null = null;
	let stageOpen: ReadonlySet<string> | null = null;

	// ステージの中身: 箱（地図と襖の状態から組み直す）と、平屋の glb（差し替えたら置いたまま）と、
	// 材質を貼った箱（ランダム間取りで、材質の素材があるとき。箱と一緒に組み直す）。
	const boxGroup = new THREE.Group();
	const modelGroup = new THREE.Group();
	const surfaceGroup = new THREE.Group();
	// 天井（色の箱と材質を貼った箱）。狙いの当たりとスポイトの対象（boxGroup・surfaceGroup）に入れない。
	const boxCeilingGroup = new THREE.Group();
	const surfaceCeilingGroup = new THREE.Group();
	spaces.stage.add(
		boxGroup,
		modelGroup,
		surfaceGroup,
		boxCeilingGroup,
		surfaceCeilingGroup,
	);
	let ceiling = true;
	// 部屋の灯り。数は一定で、明るさ 0 で消す（数を変えないので、シェーダーを作り直さない）。
	const roomLights = Array.from({ length: ROOM_LIGHT_COUNT }, () => {
		const light = new THREE.PointLight(
			ROOM_LIGHT_COLOR,
			0,
			ROOM_LIGHT_DISTANCE,
			2,
		);
		spaces.stage.add(light);
		return light;
	});
	/** 灯りを置ける部屋の位置（ランダム間取りの箱の表示のときだけ）。 */
	let lightSpots: Spot[] = [];
	let materialSlot: SwapSlot<THREE.Group> | null = null;
	/** 材質の素材を受け取ったか（1回だけ受け取る）と、形が正しく読めた材質。 */
	let materialsReceived = false;
	let materials: StageMaterialSet | null = null;
	let stageSlot: SwapSlot<HirayaModel> | null = null;
	let model: HirayaModel | null = null;
	/** glb の襖の板（襖の状態を持ち、差し替えのときにも当て直す / fusumaView.ts）。 */
	const fusumaView = createFusumaView();
	let roofVisible = false;

	/** 家具の箱（家具の glb から読む / furniture.ts）。読めなければ空（地図の守りだけ）。 */
	let furniture: readonly FurnitureBox[] = [];
	/** カメラの守りに使う家具の箱。平屋の glb を表示しているときだけ（箱の表示に家具は無い）。 */
	const furnitureNow = (): readonly FurnitureBox[] =>
		modelShown() ? furniture : [];
	/** テクスチャの画素（スポイトで読む。テクスチャごとに1回だけ描く / surfaceColor.ts）。 */
	const readTexture = createTextureReader(drawOnCanvas);
	/** ここの色（マスの鍵 → 足もとの床の見た目の色）。glb を差し替えたら捨てる。 */
	const floorColors = new Map<string, string | null>();

	/** glb を表示するか（差し替え済みで、地図が平屋のとき）。 */
	const modelShown = () =>
		model !== null && stageGrid !== null && isHirayaStage(stageGrid);

	/** glb の襖の板を、いまの地図と開いている襖に合わせて置く。 */
	const placeFusuma = () => {
		fusumaView.update(stageGrid, stageOpen);
	};

	const showStage = () => {
		const layers = stageLayers(modelShown(), surfaceGroup.children.length > 0);
		modelGroup.visible = layers.model;
		surfaceGroup.visible = layers.surfaces;
		// 箱は、glb や材質を貼った箱を表示している間も見えなくするだけで残す（鬼の狙いの壁と床の当たりに使う）。
		boxGroup.visible = layers.boxes;
		boxCeilingGroup.visible = layers.boxes && stageCeilingVisible(ceiling);
		surfaceCeilingGroup.visible =
			layers.surfaces && stageCeilingVisible(ceiling);
		if (model?.roof != null) {
			// 屋根のノードは開発用の切り替え、天井のノードは設定のとおり。
			model.roof.visible = true;
			for (const node of model.roof.children) {
				node.visible = roofNodeVisible(
					originalName(node),
					roofVisible,
					ceiling,
				);
			}
		}
	};

	/** 部屋の灯りを、at（カメラの位置）に近い部屋へ置く。平屋の glb を表示している間は消す。 */
	const placeRoomLights = (at: Spot) => {
		const chosen = modelShown()
			? []
			: nearestSpots(lightSpots, at, ROOM_LIGHT_COUNT);
		roomLights.forEach((light, index) => {
			const spot = chosen[index];
			light.intensity = spot === undefined ? 0 : ROOM_LIGHT_INTENSITY;
			if (spot !== undefined) {
				light.position.set(spot.x, ROOM_LIGHT_HEIGHT, spot.z);
			}
		});
	};

	/** 平屋の glb を、glb の座標のまま置く（差し替えは1回だけ）。 */
	const attachModel = (next: HirayaModel) => {
		model = next;
		floorColors.clear();
		const boxes =
			next.furniture === null ? null : parseFurniture(next.furniture.userData);
		furniture = boxes ?? [];
		options.trace?.({ kind: "furniture", boxes: boxes?.length ?? null });
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
		const geometries = new Set<THREE.BufferGeometry>();
		for (const group of [boxGroup, boxCeilingGroup]) {
			const meshes = [...group.children];
			group.clear();
			for (const mesh of meshes) {
				if (!(mesh instanceof THREE.InstancedMesh)) continue;
				geometries.add(mesh.geometry);
				(mesh.material as THREE.Material).dispose();
				mesh.dispose();
			}
		}
		for (const geometry of geometries) geometry.dispose();
		// 材質を貼った箱: 形と、複製した材質だけを捨てる（絵は素材のもの）。
		for (const group of [surfaceGroup, surfaceCeilingGroup]) {
			const surfaces = [...group.children];
			group.clear();
			for (const mesh of surfaces) {
				if (!(mesh instanceof THREE.Mesh)) continue;
				mesh.geometry.dispose();
				(mesh.material as THREE.Material).dispose();
			}
		}
	};

	/** いまの地図と襖の状態で、箱（と、材質があれば材質を貼った箱）を組み直す。 */
	const buildStage = () => {
		clearStage();
		if (stageGrid !== null && stageOpen !== null) {
			const boxes = stageBoxes(stageGrid, stageOpen);
			const ceilings = boxes.filter((box) => box.kind === "ceiling");
			const others = boxes.filter((box) => box.kind !== "ceiling");
			for (const mesh of stageMeshes(others)) boxGroup.add(mesh);
			for (const mesh of stageMeshes(ceilings)) boxCeilingGroup.add(mesh);
			if (materials !== null && !isHirayaStage(stageGrid)) {
				for (const mesh of surfaceMeshes(others, materials)) {
					surfaceGroup.add(mesh);
				}
				for (const mesh of surfaceMeshes(ceilings, materials)) {
					surfaceCeilingGroup.add(mesh);
				}
			}
			lightSpots = roomLightSpots(stageGrid);
		} else {
			lightSpots = [];
		}
		showStage();
	};

	return {
		setStage(grid, open) {
			// 地図か襖の状態が変わったときだけ組み直す（襖の通知はまれ）。
			if (grid === stageGrid && open === stageOpen) return;
			stageGrid = grid;
			stageOpen = open;
			buildStage();
			placeFusuma();
		},
		setStageModel(slot) {
			stageSlot = slot;
		},
		setStageMaterials(slot) {
			materialSlot = slot;
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
		setCeilingVisible(visible) {
			if (visible === ceiling) return;
			ceiling = visible;
			showStage();
		},
		setSpace(space) {
			if (space === "waiting-room") {
				// キャラクターの素材の差し替えも、待機ルームにいる間だけ（issue-56）。setSpace は毎コマ
				// 呼ばれ、差し替え口は lock まで同じ素材を返し続けるので、1回だけ受け取る（毎コマ体を
				// 作り直して、動きが最初からやり直しになっていた / issue-57 の不具合）。
				const parts = takeCharacter();
				if (parts != null) {
					// 動きの素材（issue-57）は、読めて形が正しいときだけ使う（無ければ静止した姿勢）。
					const motions =
						parts.motions === null ? null : parseMotionSet(parts.motions);
					const kit = createModelBodyKit(parts.body, parts.poses, motions);
					if (kit !== null) useBodyKit(kit);
					options.trace?.({ kind: "character", swapped: kit !== null });
				}
				// 平屋の glb の差し替えも、待機ルームにいる間だけ（issue-46）。
				const next = model === null ? stageSlot?.take() : null;
				if (next != null) attachModel(next);
				// ランダム間取りの材質も、待機ルームにいる間に1回だけ受け取る。形が違えば色の箱のまま。
				const assetRoot = materialsReceived ? null : materialSlot?.take();
				if (assetRoot != null) {
					materialsReceived = true;
					materials = pickStageMaterials(assetRoot);
					if (materials !== null) buildStage();
				}
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
				if (lastSpace !== "stage") {
					const event = stageMaterialEvent({
						hiraya: stageGrid !== null && isHirayaStage(stageGrid),
						hasSlot: materialSlot !== null,
						received: materialsReceived,
						applied: surfaceGroup.children.length > 0,
					});
					if (event !== null) options.trace?.(event);
				}
				stageSlot?.lock();
				materialSlot?.lock();
			}
			lastSpace = space;
			const background = space === "stage" ? stageBackground : roomBackground;
			if (scene.background !== background) scene.background = background;
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
			avatar.object.position.x = position.x;
			avatar.object.position.z = position.z;
			avatarSurface.draw(color, paint);
		},
		setAvatarPose(chosen, fixed) {
			avatarChosen = chosen;
			avatarFixed = fixed;
		},
		setAvatarFacing(facing) {
			if (facing !== null) avatar.object.rotation.y = turnOf(facing);
		},
		bodyPosable: () => bodyKit.posable,
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
			avatar.object.visible = !asOni;
			if (asOni) selfOni.rotation.y = turnOf(facing);
		},
		setHiders(hiders) {
			const key = hiders
				.map(
					(h) =>
						`${h.id}:${h.x}:${h.z}:${h.facing}:${h.pose}:${h.color}:${JSON.stringify(h.paint)}`,
				)
				.join("|");
			if (key === hiderKey) return;
			hiderKey = key;
			for (const child of [...hiderGroup.children]) hiderGroup.remove(child);
			for (const body of hiderInstances.splice(0)) body.dispose();
			for (const surface of hiderSurfaces.splice(0)) surface.dispose();
			for (const hider of hiders) {
				const surface = createPaintSurface();
				surface.draw(hider.color, hider.paint);
				hiderSurfaces.push(surface);
				const body = bodyKit.create(surface.texture, 0xffffff);
				// CPU のポーズは素材のポーズに対応づける。未知の値・null は既定の立ち姿（issue-56）。
				body.setPose(modelPoseOf(hider.pose));
				body.snap();
				body.object.position.set(hider.x, 0, hider.z);
				if (hider.facing !== null) {
					body.object.rotation.y = turnOf(hider.facing);
				}
				body.object.userData.playerId = hider.id;
				hiderGroup.add(body.object);
				hiderInstances.push(body);
			}
		},
		setMembers(members) {
			const ids = new Set(members.map((member) => member.id));
			for (const id of [...memberFigures.keys()]) {
				if (!ids.has(id)) removeMember(id);
			}
			for (const member of members) {
				const figure = memberFigures.get(member.id);
				if (figure === undefined) {
					const group = new THREE.Group();
					const label = memberLabel(member.name);
					group.add(label);
					memberGroup.add(group);
					const created: MemberFigure = {
						group,
						body: memberBody(group),
						label,
						name: member.name,
						target: member,
						unregister: motions.add(memberSource(member.id, () => created)),
					};
					memberFigures.set(member.id, created);
					continue;
				}
				// 名前が変わったら、名前の画像を作り直す（古い画像は解放する）。
				if (figure.name !== member.name) {
					figure.group.remove(figure.label);
					disposeLabel(figure.label);
					figure.label = memberLabel(member.name);
					figure.group.add(figure.label);
					figure.name = member.name;
				}
				figure.target = member;
			}
		},
		setBlink(ids, self, level) {
			const glow = (material: THREE.MeshStandardMaterial, on: boolean) => {
				material.emissive.setHex(BLINK_COLOR);
				material.emissiveIntensity = on ? level : 0;
			};
			for (const material of avatar.materials) glow(material, self);
			const targets = new Set(ids);
			// 狙う点にいる隠れ側は、黄色く光らせる（答え合わせの点滅が優先）。
			const aimed = aimPoint === null ? null : hiderAt(aimPoint, bodiesOf());
			for (const body of hiderInstances) {
				const id: unknown = body.object.userData.playerId;
				for (const material of body.materials) {
					if (typeof id === "string" && targets.has(id)) {
						glow(material, true);
					} else if (id === aimed) {
						material.emissive.setHex(AIM_COLOR);
						material.emissiveIntensity = AIM_GLOW;
					} else {
						glow(material, false);
					}
				}
			}
		},
		pickPaint(x, y) {
			placeCamera();
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
			// 自分の体: 素材の体は、当たった面の基準姿勢の位置から、仮のカプセルは体の円柱との交差から、
			// 描き込み面の u・v を求める（どのポーズでも同じ場所に塗れる / body.ts）。
			const body = avatar.pickUv(raycaster);
			// 体に当たれば、体を先にする（カメラが壁の裏に回っても、自分の体には描ける。
			// カメラの壁へのめり込みは許容している / ADR 0034）。
			if (body !== null) return { kind: "body", ...body };
			// 平屋の glb を表示している間は、見えている一番手前の面の見た目の色（素材の色とテクスチャ）。
			// 屋根・天井（隠れているとき）・見えない箱・ガラス・体の描画は拾わない（surfaceColor.ts）。
			if (modelShown() && spaces.stage.visible) {
				modelGroup.updateMatrixWorld(true);
				const hit = firstVisibleHit(
					raycaster.intersectObjects(modelGroup.children, true),
				);
				const color = hit === null ? null : surfaceColor(hit, readTexture);
				return color === null ? null : { kind: "stage", color };
			}
			// 材質を貼った箱のときは、当たった面の絵の画素 × 材質の色（surfaceColor.ts）。
			if (surfaceGroup.visible && spaces.stage.visible) {
				surfaceGroup.updateMatrixWorld(true);
				const hit = firstVisibleHit(
					raycaster.intersectObjects(surfaceGroup.children, false),
				);
				const color = hit === null ? null : surfaceColor(hit, readTexture);
				return color === null ? null : { kind: "stage", color };
			}
			// 箱の表示（素材が読めない）のときは、これまでどおり箱の色。箱の色は、描画の色ではなく、
			// 表の色（userData.color）。
			const [stageHit] = spaces.stage.visible
				? raycaster.intersectObjects(boxGroup.children, false)
				: [];
			const color: unknown = stageHit?.object.userData.color;
			return typeof color === "string" ? { kind: "stage", color } : null;
		},
		modelShown: () => modelShown(),
		cameraPosition: () => ({
			x: camera.position.x,
			y: camera.position.y,
			z: camera.position.z,
		}),
		guardedCameraAt(x, z, yaw) {
			if (stageGrid === null) return null;
			const center = { x, z, feet: floorAt(x, z) };
			const reach = allowedCameraReach(
				stageGrid,
				center,
				yaw,
				furnitureNow(),
				cameraSet,
			);
			const pose = placeGuardedCamera(
				stageGrid,
				center,
				yaw,
				reach,
				furnitureNow(),
				cameraSet,
			);
			return { position: pose.position, feet: center.feet };
		},
		modelRoot: () => (modelShown() ? modelGroup : null),
		furnitureBoxes: () => furnitureNow(),
		floorColorAt(x, z) {
			if (!modelShown() || stageGrid === null) return null;
			const cell = cellAt(stageGrid, { x, z });
			const key = `${cell.x},${cell.z}`;
			const cached = floorColors.get(key);
			if (cached !== undefined) return cached;
			// 体の真下へ（足もとの少し上から）線を引く。体は modelGroup に無いので当たらない。
			modelGroup.updateMatrixWorld(true);
			const raycaster = new THREE.Raycaster(
				new THREE.Vector3(x, floorAt(x, z) + FLOOR_PROBE_HEIGHT, z),
				new THREE.Vector3(0, -1, 0),
			);
			const hit = firstVisibleHit(
				raycaster.intersectObjects(modelGroup.children, true),
			);
			const color = hit === null ? null : surfaceColor(hit, readTexture);
			floorColors.set(key, color);
			return color;
		},
		pickHider() {
			// 照準は画面の中央。鬼自身の体は当てる対象に入れず、隠れ側だけを見る。
			// 壁越しかどうかはここでは見ない（サーバーの判定に任せる / ADR 0022）。
			placeCamera();
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
			// 体は、体の原点（グループ）の下にメッシュがあるので、当たったメッシュから体の原点をたどる。
			const [hit] = raycaster.intersectObjects(hiderGroup.children, true);
			for (let node = hit?.object ?? null; node !== null; node = node.parent) {
				const id: unknown = node.userData.playerId;
				if (typeof id === "string") return id;
			}
			return null;
		},
		sightedHiders() {
			placeCamera();
			camera.updateMatrixWorld();
			const origin = camera.position.clone();
			const raycaster = new THREE.Raycaster();
			const seen: string[] = [];
			for (const body of bodiesOf()) {
				// しゃがむ・寝るポーズでも当たるよう、低い所（体の高さの 15%）と、高い所（50%）を見る。
				const visible = [0.15, 0.5].some((ratio) => {
					const point = new THREE.Vector3(
						body.x,
						body.feet + BODY_HEIGHT * ratio,
						body.z,
					);
					const ndc = point.clone().project(camera);
					if (
						ndc.z < -1 ||
						ndc.z > 1 ||
						Math.abs(ndc.x) > 1 ||
						Math.abs(ndc.y) > 1
					) {
						return false;
					}
					const toward = point.clone().sub(origin);
					const distance = toward.length();
					if (distance === 0) return true;
					raycaster.set(origin, toward.normalize());
					raycaster.far = distance;
					const [wall] = spaces.stage.visible
						? raycaster.intersectObjects(boxGroup.children, false)
						: [];
					return wall === undefined || wall.distance >= distance - 0.05;
				});
				if (visible) seen.push(body.id);
			}
			return seen;
		},
		pickAim(x, y) {
			placeCamera();
			camera.updateMatrixWorld();
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
			const { origin, direction } = raycaster.ray;
			let best: { t: number; id: string | null } | null = null;
			for (const body of bodiesOf()) {
				const t = rayHitsBody(origin, direction, body);
				if (t !== null && (best === null || t < best.t)) {
					best = { t, id: body.id };
				}
			}
			// 壁と床は、見えない箱も含めて当てる（平屋の glb を表示している間も、判定の壁と同じ）。
			const [wall] = spaces.stage.visible
				? raycaster.intersectObjects(boxGroup.children, false)
				: [];
			if (wall !== undefined && (best === null || wall.distance < best.t)) {
				best = { t: wall.distance, id: null };
			}
			if (best === null) return null;
			const point = origin.clone().addScaledVector(direction, best.t);
			return {
				point: { x: point.x, y: point.y, z: point.z },
				hiderId: best.id,
			};
		},
		setAim(point) {
			aimPoint = point;
			aimMarker.visible = point !== null;
			if (point !== null) aimMarker.position.set(point.x, point.y, point.z);
		},
		hiderBodies() {
			return bodiesOf();
		},
		motionInfos: () => motions.infos(),
		motionStalls: () => options.watch?.stalls() ?? [],
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
			const avatarFloor = floorAt(
				avatar.object.position.x,
				avatar.object.position.z,
			);
			avatarFeet = jumped
				? avatarFloor
				: followFloor(avatarFeet, avatarFloor, dt);
			avatar.object.position.y = avatarFeet;
			// 鬼本人の体は、自分の体と同じ位置（手元の位置）に、足もとを合わせて置く。
			selfOni.position.set(
				avatar.object.position.x,
				avatarFeet,
				avatar.object.position.z,
			);
			if (oni.visible) {
				const oniFloor = floorAt(oni.position.x, oni.position.z);
				oniFeet =
					jumped || oniAppeared ? oniFloor : followFloor(oniFeet, oniFloor, dt);
				oniAppeared = false;
				oni.position.y = oniFeet;
			}
			// 隠れ側（CPU を含む）は動かないので、立っているマスの床の高さに直に置く。
			for (const child of hiderGroup.children) {
				child.position.y = floorAt(child.position.x, child.position.z);
			}
			// 待機ルームのほかのメンバー（issue-59）。補間した位置に置く。
			memberGroup.visible = lastSpace === "waiting-room";
			if (memberGroup.visible) {
				for (const figure of memberFigures.values()) {
					const { x, z, facing } = figure.target;
					figure.group.position.set(x, floorAt(x, z), z);
					figure.body.object.rotation.y = turnOf(facing);
				}
			}
			// 動きのある体を、登録所で、まとめて進める（issue-57 の後半。体の種類ごとに呼ばない）。
			// 自分の体と鬼本人の体は、実際に進んだ距離（壁で止まった後の手元の位置）から、ほかの人の画面の
			// 鬼とメンバーは、補間した位置の変化から、速さを求める。空間が変わった直後は、速さを 0 にする。
			motions.update(dt, { jumped, at: now });
			updateCameraReach(dt, jumped);
			// カメラが自分の体に近いほど、自分の体を半透明にする（体の中を映さないように / issue-46）。
			const opacity =
				cameraCenter().kind === "self" ? selfBodyOpacity(cameraReachNow) : 1;
			for (const material of selfMaterials()) {
				const transparent = opacity < 1;
				if (material.transparent !== transparent) {
					material.transparent = transparent;
					material.needsUpdate = true;
				}
				material.opacity = opacity;
			}
			logCamera(performance.now(), placeCamera());
			logMotion(performance.now());
			placeRoomLights({ x: camera.position.x, z: camera.position.z });
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
			avatar.dispose();
			for (const body of hiderInstances.splice(0)) body.dispose();
			for (const id of [...memberFigures.keys()]) removeMember(id);
			avatarSurface.dispose();
			for (const surface of hiderSurfaces.splice(0)) surface.dispose();
			renderer.dispose();
		},
	};
}
