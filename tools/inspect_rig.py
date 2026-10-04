"""人型の FBX の骨格とメッシュを調べて JSON に書き出す（Blender をコマンドラインから動かす）。

起動例:
    /Applications/Blender.app/Contents/MacOS/Blender --background \\
        --python tools/inspect_rig.py -- \\
        --input "assets-src/characters/X Bot.fbx" \\
        --output assets-src/converted/characters/x-bot-rig.json

書き出すもの（座標はメートル。Blender の座標 [x, y, z]（Z が上）と、glTF に書き出した
ときの座標 [x, y, z]（Y が上。glTF の (x, y, z) = Blender の (x, z, -y)）の両方）:
- 骨: 名前、親、根元（head）と先端（tail）の位置。読み込んだ時点の姿勢で測る
- メッシュ: 名前、頂点数、頂点グループ（スキンの重み）の数、アーマチュアに付いているか
- アニメーション（アクション）の名前とフレームの範囲
- 全体の外接箱と高さ
- 正面の向きの手がかり（足先の骨が、かかとより前にある向き）と、腕が水平かの手がかり

入力は読むだけで、変更しない。
"""

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="人型の FBX の骨格を調べる")
    parser.add_argument("--input", required=True, help=".fbx ファイル")
    parser.add_argument("--output", required=True, help="書き出す .json")
    return parser.parse_args(argv)


def gltf(v: Vector) -> list[float]:
    """Blender の座標（Z が上）を、glTF の座標（Y が上）にする。"""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def blender(v: Vector) -> list[float]:
    return [round(v.x, 4), round(v.y, 4), round(v.z, 4)]


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=args.input)
    depsgraph = bpy.context.evaluated_depsgraph_get()

    bones = []
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    for armature in armatures:
        for bone in armature.pose.bones:
            head = armature.matrix_world @ bone.head
            tail = armature.matrix_world @ bone.tail
            bones.append(
                {
                    "armature": armature.name,
                    "name": bone.name,
                    "parent": bone.parent.name if bone.parent else None,
                    "head": {"blender": blender(head), "gltf": gltf(head)},
                    "tail": {"blender": blender(tail), "gltf": gltf(tail)},
                }
            )

    meshes = []
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            for vertex in mesh.vertices:
                point = evaluated.matrix_world @ vertex.co
                low = Vector(map(min, low, point))
                high = Vector(map(max, high, point))
            vertex_count = len(mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
        meshes.append(
            {
                "name": obj.name,
                "vertices": vertex_count,
                "vertexGroups": len(obj.vertex_groups),
                "parent": obj.parent.name if obj.parent else None,
                "armatureModifier": any(m.type == "ARMATURE" for m in obj.modifiers),
                "materials": [s.material.name for s in obj.material_slots if s.material],
            }
        )

    actions = [
        {"name": a.name, "frames": [round(a.frame_range[0]), round(a.frame_range[1])]}
        for a in bpy.data.actions
    ]

    by_name = {b["name"]: b for b in bones}

    def head_of(suffix: str) -> Vector | None:
        for name, bone in by_name.items():
            if name.endswith(suffix):
                return Vector(bone["head"]["blender"])
        return None

    # 正面: 足先（ToeBase）は、足首（Foot）より前にある。その向きを glTF の座標で出す。
    toe = head_of("LeftToeBase")
    foot = head_of("LeftFoot")
    facing = None
    if toe is not None and foot is not None:
        forward = toe - foot
        facing = {"blenderToeMinusFoot": blender(forward), "gltf": gltf(forward)}

    # 腕: 肩・肘・手首の高さ（Blender の Z）と、左右の広がり（X）。
    arms = {}
    for side in ("Left", "Right"):
        joints = {}
        for part in ("Shoulder", "Arm", "ForeArm", "Hand"):
            point = head_of(f"{side}{part}")
            if point is not None:
                joints[part] = blender(point)
        arms[side] = joints

    result = {
        "source": args.input,
        "armatures": [a.name for a in armatures],
        "bones": bones,
        "meshes": meshes,
        "actions": actions,
        "bounds": {
            "blender": {"min": blender(low), "max": blender(high)},
            "size": blender(high - low),
            "heightMeters": round(high.z - low.z, 4),
        },
        "facing": facing,
        "arms": arms,
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"WROTE\t{args.output}")


main()
