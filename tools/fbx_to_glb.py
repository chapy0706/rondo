"""FBX を glb に変換する（Blender をコマンドラインから動かす）。

起動例（フォルダごと）:
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/fbx_to_glb.py -- \
        --input assets-src/characters \
        --output assets-src/converted/characters

起動例（1ファイル。--output に .glb のパスを渡すと、その名前で書き出す）:
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/fbx_to_glb.py -- \
        --input "assets-src/characters/X Bot.fbx" \
        --output assets-src/converted/characters/x-bot.glb

- 入力の .fbx（フォルダなら中の .fbx を1つずつ）を、空のシーンに読み込む
- 読み込んだ全体の大きさ（m）を表示する（Blender の Z が高さ）
- 同じ名前の .glb を、+Y Up で書き出す。骨格は読み込んだ時点の姿勢（ポーズ）で書き出す
- アニメーションは既定では含めず、--animations を付けたときだけ含める
- 読み込めないファイル（古い FBX 6.1 など）は飛ばして続け、最後に FAILED として一覧にする

入力は読むだけで、変更しない。
"""

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    # Blender 自身の引数と分けるため、"--" より後ろだけを読む。
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="FBX を glb に変換する")
    parser.add_argument(
        "--input", required=True, help=".fbx の入ったフォルダ、または .fbx ファイル"
    )
    parser.add_argument(
        "--output",
        required=True,
        help=".glb を書き出すフォルダ。入力が1ファイルなら .glb のパスも可",
    )
    parser.add_argument(
        "--animations",
        action="store_true",
        help="アニメーションを含める（既定は含めない）",
    )
    return parser.parse_args(argv)


def reset_scene() -> None:
    """何も無い空のシーンにする。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bounds() -> tuple[Vector, Vector] | None:
    """シーンのメッシュ全体の、ワールド座標での外接箱（最小・最大）。"""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    found = False
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
                found = True
        finally:
            evaluated.to_mesh_clear()
    return (low, high) if found else None


def convert(source: Path, target: Path, animations: bool) -> None:
    reset_scene()
    bpy.ops.import_scene.fbx(filepath=str(source))

    bounds = world_bounds()
    if bounds is None:
        print(f"SIZE\t{source.name}\t-\t-\t-")
    else:
        low, high = bounds
        size = high - low
        # Blender は Z が上。幅 x、奥行き y、高さ z の順に出す。
        print(f"SIZE\t{source.name}\t{size.x:.3f}\t{size.y:.3f}\t{size.z:.3f}")

    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        export_yup=True,
        export_animations=animations,
        # ポーズの FBX は、ポーズを1コマのアニメーションとして持つ。骨格を基準姿勢のまま
        # 書き出すとポーズが消えるので、読み込んだ時点の姿勢を骨のノードの姿勢として残す
        # （アニメーションは含めない）。
        export_rest_position_armature=False,
    )
    print(f"WROTE\t{target}")


def main() -> None:
    args = parse_args()
    source = Path(args.input)
    output = Path(args.output)
    if source.is_file():
        sources = [source]
    elif source.is_dir():
        sources = sorted(source.glob("*.fbx"))
    else:
        sys.exit(f"入力がありません: {source}")
    if not sources:
        sys.exit(f".fbx がありません: {source}")

    # 1ファイルで、出力が .glb のパスなら、その名前で書き出す。それ以外は出力をフォルダとみなす。
    single_target = output if source.is_file() and output.suffix == ".glb" else None
    output_dir = output.parent if single_target is not None else output
    output_dir.mkdir(parents=True, exist_ok=True)
    # 1つ失敗しても残りは変換し、最後に失敗した分を一覧にして、終了コードで知らせる。
    failed: list[tuple[str, str]] = []
    for item in sources:
        try:
            target = single_target or output_dir / f"{item.stem}.glb"
            convert(item, target, args.animations)
        except RuntimeError as error:
            message = str(error).strip().splitlines()[-1]
            print(f"FAILED\t{item.name}\t{message}")
            failed.append((item.name, message))
    print(f"DONE\t{len(sources) - len(failed)} / {len(sources)}")
    if failed:
        sys.exit(1)


main()
