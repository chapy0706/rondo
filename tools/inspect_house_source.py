"""平屋の元データ（.fbx / .blend）を Blender で読み、素材の問題を調べる（調べるだけで、保存しない）。

起動例:
    /Applications/Blender.app/Contents/MacOS/Blender --background \\
        --python tools/inspect_house_source.py -- \\
        --input ~/Downloads/平屋和風/平屋和風.fbx \\
        --doors assets-src/house/doors.tsv \\
        --output assets-src/converted/house/source-fbx.json

調べること（座標は glTF に合わせて Y が上。glTF の (x, y, z) = Blender の (x, z, -y)）:
a. 壁（名前が「内壁」「外壁」で始まるメッシュ）を、モディファイアーを適用した形で y = 1.0m の水平面で
   切り、doors.tsv の引違い戸・片開き戸の組ごとに、開口の範囲の中に壁の断面がどれだけ残るかを測る
   （0 なら、戸の位置で壁が途切れている＝開口がある）。確かめのため、開口のすぐ脇（壁があるはずの
   ところ）の断面の長さと、壁の断面の範囲も出す
b. 切り抜き用の箱（名前に「 B-」を含むもの）の数と、表示・レンダーの設定
c. ドアノブ、照明スイッチのボタン、蛇口、ペンダントライトの部品の位置（原点に寄っていないか）
あわせて、ブーリアンのモディファイアーと拘束（コンストレイント）を持つオブジェクトを数える。

.blend は読み込むだけで、保存しない（このスクリプトは保存の操作を一切しない）。
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

CUT_Y = 1.0
PARTS = ("ドアノブ", "照明スイッチ", "蛇口", "ペンライ")


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help=".fbx または .blend")
    parser.add_argument("--doors", required=True, help="doors.tsv（戸の組の位置）")
    parser.add_argument("--output", required=True, help="書き出す .json")
    return parser.parse_args(argv)


def load(path: Path) -> None:
    if path.suffix.lower() == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(path))


def gltf(v: Vector) -> list[float]:
    return [v.x, v.z, -v.y]


def scene_objects():
    return list(bpy.context.scene.objects)


def wall_segments() -> list[tuple[list[float], list[float]]]:
    """壁を y = CUT_Y で切った線分（glTF の x, z）。"""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    segments = []
    for obj in scene_objects():
        if obj.type != "MESH" or not (obj.name.startswith("内壁") or obj.name.startswith("外壁")):
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            matrix = evaluated.matrix_world
            points = [gltf(matrix @ v.co) for v in mesh.vertices]
            for tri in mesh.loop_triangles:
                a, b, c = (points[i] for i in tri.vertices)
                cut = []
                for p, q in ((a, b), (b, c), (c, a)):
                    dp, dq = p[1] - CUT_Y, q[1] - CUT_Y
                    if (dp < 0 < dq) or (dq < 0 < dp):
                        t = dp / (dp - dq)
                        cut.append([p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t])
                if len(cut) == 2:
                    segments.append((cut[0], cut[1]))
        finally:
            evaluated.to_mesh_clear()
    return segments


def clipped_length(segment, box) -> float:
    """線分のうち、箱（x0, x1, z0, z1）の中にある長さ（Liang-Barsky）。"""
    (x0, z0), (x1, z1) = segment
    bx0, bx1, bz0, bz1 = box
    dx, dz = x1 - x0, z1 - z0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - bx0), (dx, bx1 - x0), (-dz, z0 - bz0), (dz, bz1 - z0)):
        if p == 0:
            if q < 0:
                return 0.0
            continue
        r = q / p
        if p < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
        if t0 > t1:
            return 0.0
    return (t1 - t0) * (dx * dx + dz * dz) ** 0.5


def door_sets(path: Path) -> list[dict]:
    """doors.tsv から、戸の組（操作軸）の開口の箱を読む。壁の厚みの分、短い辺を広げる。"""
    sets = []
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if "操作軸" not in row["名前"] or not row["名前"].startswith(("ドア", "腰付障子", "ガラス")):
                continue
            cx, cz = float(row["中心x"]), float(row["中心z"])
            sx, sz = float(row["幅x(m)"]), float(row["奥行きz(m)"])
            # 開口の内側だけを見る（端の枠の分を 0.1m ずつ除く）。厚み方向は 0.3m 幅で見る。
            if row["長辺の向き"] == "x方向":
                box = (cx - sx / 2 + 0.1, cx + sx / 2 - 0.1, cz - 0.15, cz + 0.15)
            else:
                box = (cx - 0.15, cx + 0.15, cz - sz / 2 + 0.1, cz + sz / 2 - 0.1)
            # 開口の脇（長辺の向きに、開口の端から 0.15〜0.45m 外）。壁があるはずのところ。
            if row["長辺の向き"] == "x方向":
                beside = (cx + sx / 2 + 0.15, cx + sx / 2 + 0.45, cz - 0.15, cz + 0.15)
            else:
                beside = (cx - 0.15, cx + 0.15, cz + sz / 2 + 0.15, cz + sz / 2 + 0.45)
            sets.append(
                {"name": row["名前"], "center": [cx, cz], "box": box, "beside": beside}
            )
    return sets


def world_center(obj) -> list[float] | None:
    if obj.type != "MESH" or not obj.data.vertices:
        return None
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    low = Vector(map(min, *corners))
    high = Vector(map(max, *corners))
    return [round(v, 3) for v in gltf((low + high) / 2)]


def main() -> None:
    args = parse_args()
    source = Path(args.input).expanduser()
    load(source)
    objects = scene_objects()

    segments = wall_segments()
    doors = []
    for door in door_sets(Path(args.doors)):
        remaining = sum(clipped_length(s, door["box"]) for s in segments)
        beside = sum(clipped_length(s, door["beside"]) for s in segments)
        doors.append(
            {
                "name": door["name"],
                "center": door["center"],
                "wallInsideOpening": round(remaining, 3),
                "wallBesideOpening": round(beside, 3),
            }
        )

    cutters = [o for o in objects if " B-" in o.name]
    cutter_info = {
        "count": len(cutters),
        "meshes": sum(1 for o in cutters if o.type == "MESH"),
        "hiddenInViewport": sum(1 for o in cutters if o.hide_get() or o.hide_viewport),
        "hiddenInRender": sum(1 for o in cutters if o.hide_render),
        "displayAsWireOrBounds": sum(
            1 for o in cutters if getattr(o, "display_type", "TEXTURED") in ("WIRE", "BOUNDS")
        ),
        "examples": [o.name for o in cutters[:5]],
    }

    booleans = []
    for o in objects:
        for m in getattr(o, "modifiers", []):
            if m.type == "BOOLEAN":
                booleans.append(
                    {
                        "object": o.name,
                        "modifier": m.name,
                        "operation": m.operation,
                        "operand": m.object.name if m.object else (m.collection.name if m.collection else None),
                        "showViewport": m.show_viewport,
                        "showRender": m.show_render,
                    }
                )
    constrained = [
        {"object": o.name, "constraints": [c.type for c in o.constraints]}
        for o in objects
        if len(o.constraints) > 0
    ]

    parts = []
    for o in objects:
        if not any(word in o.name for word in PARTS):
            continue
        center = world_center(o)
        if center is None:
            continue
        near_origin = abs(center[0]) < 0.3 and abs(center[2]) < 0.3 and center[1] < 0.8
        parts.append({"name": o.name, "center": center, "nearOrigin": near_origin})

    walls = [o.name for o in objects if o.name.startswith(("内壁", "外壁"))]
    result = {
        "source": str(source),
        "objects": len(objects),
        "walls": walls,
        "wallSegments": len(segments),
        "wallBounds": {
            "x": [round(min(min(p[0], q[0]) for p, q in segments), 3), round(max(max(p[0], q[0]) for p, q in segments), 3)],
            "z": [round(min(min(p[1], q[1]) for p, q in segments), 3), round(max(max(p[1], q[1]) for p, q in segments), 3)],
        },
        "doors": doors,
        "cutters": cutter_info,
        "booleanModifiers": {"count": len(booleans), "items": booleans},
        "constraints": {
            "objects": len(constrained),
            "types": sorted({t for c in constrained for t in c["constraints"]}),
            "examples": constrained[:10],
        },
        "parts": {
            "count": len(parts),
            "nearOrigin": sum(1 for p in parts if p["nearOrigin"]),
            "items": parts,
        },
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"WROTE\t{args.output}")


main()
