# 素材の取り込み

3D 素材（キャラクター・平屋）を、ゲームが読み込める glb にする手順をまとめる。

## 方針

GitHub のリポジトリは公開なので、ステージとキャラクターの素材（元データも、変換した glb も）は、リポジトリに入れない。平屋の規約は二次的な配布を禁じており、公開リポジトリに置くと、素材がそのまま取り出せる形で配られることになるため。

- 素材の元データは `assets-src/` に置き、コミットしない
- 変換の途中の glb も、ゲームが読み込む最終の glb も、コミットしない
- ゲームが読み込む glb は、各自の手元で `apps/web/public/models/` に置く（このフォルダは `.gitignore` で除外している）
- `.gitignore` で除外しているもの: `/assets-src/`、`/apps/web/public/models/`、`*.glb`、`*.blend`、`*.blend1`、`*.fbx`、`*.fbm/`、`*.unitypackage`
- これまでの履歴に、これらのファイルがコミットされたことは無い（2026-10-04 に `git log --all` で確認）
- コミットするのは、変換・調査のスクリプト（`tools/`）、手順（この文書）、利用規約の要約（`docs/licenses/README.md`）。規約の全文の写しはコミットしない（原本は `assets-src/licenses/`）

### 素材が無いとき（フォールバック）

素材はリポジトリに無いので、素材を置いていない環境（新しく取り出したリポジトリ、CI、素材を持たない人の手元）でも、ゲームは動かなければならない。

- 素材が無いときは、仮素材版で動かす。キャラクターはカプセル、ステージは箱と床（いまの veryare の表示と同じもの）
- 素材が有るかは、ゲームを始めるときに glb を読み込めるかで決める。読み込めなければ、警告を出さずに仮素材版にする（エラーで止めない）
- テスト（`make verify`）は素材に頼らない。素材を読み込む部分は、仮素材版で通るようにする
- 本番（A1 のサーバー）に素材をどう置くかは、まだ決めていない（リポジトリからは届かないので、別に置く手順が要る）

## 置き場所

| 種類 | 場所 | コミット |
| --- | --- | --- |
| キャラクターの FBX | `assets-src/characters/*.fbx` | しない |
| 平屋の glb（FBX から変換。いまの元） | `assets-src/house/hiraya-fbx.glb` | しない |
| 平屋の glb（.blend から書き出したもの。前回の元。いまは使わない） | `assets-src/house/hiraya.glb` | しない |
| 平屋のゲーム用 glb（FBX から。6 本） | `assets-src/converted/house-fbx/` | しない |
| 平屋の戸の一覧・断面図（FBX から） | `assets-src/house/doors-fbx.tsv`、`plan-fbx.svg` | しない |
| 平屋の調査結果 | `assets-src/house/hiraya-scene.json` | しない |
| 平屋の確認用 glb（屋根・天井なし） | `assets-src/house/hiraya-preview.glb` | しない |
| 確認用 glb の調査結果 | `assets-src/house/hiraya-preview-scene.json`、`hiraya-preview-roots.tsv`（トップレベルのノードの一覧） | しない |
| 平屋の元データ | `~/Downloads/平屋和風/`（`平屋和風.blend` / `.fbx` / `.unitypackage`、テクスチャ、使い方.txt） | しない（リポジトリの外） |
| 利用規約の原本 | `assets-src/licenses/` | しない |
| 利用規約の要約 | `docs/licenses/README.md` | する |
| 変換後のポーズ素材（23 本） | `assets-src/converted/characters/*.glb` | しない |
| 基準姿勢の人型（X Bot） | `assets-src/converted/characters/x-bot.glb` | しない |
| X Bot の骨格の調査結果 | `assets-src/converted/characters/x-bot-rig.json` | しない |
| 平屋のゲーム用 glb（6 本） | `assets-src/converted/house/hiraya-{indoor,outdoor,roof}-{512,1024}.glb` | しない |
| 戸・障子・欄間の一覧 | `assets-src/house/doors.tsv` | しない |
| 間取りの断面図 | `assets-src/house/plan.svg` | しない |
| 平屋の元データの調査結果 | `assets-src/converted/house/source-fbx.json`、`source-blend.json` | しない |
| ゲームが読み込む glb（各自の手元） | `apps/web/public/models/` | しない |
| 変換・調査のスクリプト | `tools/fbx_to_glb.py`、`tools/inspect_rig.py`、`tools/inspect_glb.mjs`、`tools/prepare_house.mjs`、`tools/build_house.mjs`、`tools/list_doors.mjs`、`tools/house_plan.mjs`、`tools/inspect_house_source.py` | する |

## 必要なもの

- Blender（確認した版: 5.2.2 LTS）。実行ファイルは `/Applications/Blender.app/Contents/MacOS/Blender`
- Node（確認した版: 24）。`tools/inspect_glb.mjs` は Node の標準機能だけで動く
- テクスチャの WebP 変換には `sharp` を使う（リポジトリ直下の devDependencies）。sharp は機種ごとのビルド済みのバイナリで動くため、`pnpm approve-builds` は要らなかった（pnpm は install script を止めたと表示するが、読み込めることを確かめた）
- `tools/prepare_house.mjs` は `@gltf-transform/core`・`functions`・`extensions` を使う。リポジトリ直下の devDependencies に入っている（`tools/` はどのワークスペースにも属さないため。アプリの依存には入れない）。`pnpm install` で入る

## キャラクター: FBX を glb にする

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input assets-src/characters \
  --output assets-src/converted/characters
```

1ファイルだけを変換するときは、`--input` に `.fbx` を、`--output` に `.glb` のパスを渡す（ファイル名は小文字とハイフンにする）。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input "assets-src/characters/X Bot.fbx" \
  --output assets-src/converted/characters/x-bot.glb
```

- 入力フォルダの `.fbx` を1つずつ、空のシーンに読み込み、同じ名前の `.glb` を +Y Up で書き出す
- 骨格は、読み込んだ時点の姿勢（ポーズ）で書き出す。ポーズの FBX はポーズを1コマのアニメーションとして持つため、基準姿勢で書き出すと全部同じ形になる
- アニメーションは既定では含めない。含めるときは末尾に `--animations` を付ける（歩き・走りなど）
- 各ファイルの大きさ（m）を `SIZE<TAB>名前<TAB>幅<TAB>奥行き<TAB>高さ` の行で出す（Blender の Z が高さ）
- 読み込めないファイルは飛ばして続け、`FAILED` の行で知らせる。1つでも失敗すると終了コードは 1
- 最後に `DONE 成功数 / 全体数` を出す

結果の一覧だけを見るとき:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input assets-src/characters \
  --output assets-src/converted/characters 2>&1 | grep -E "^(SIZE|FAILED|DONE)"
```

### 人型の骨格を調べる

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/inspect_rig.py -- \
  --input "assets-src/characters/X Bot.fbx" \
  --output assets-src/converted/characters/x-bot-rig.json
```

- 骨の名前・親・根元と先端の位置（Blender の座標と glTF の座標の両方）、メッシュの名前・頂点数・頂点グループ（スキンの重み）の数、アクション、全体の大きさを JSON に書き出す
- 正面の向きの手がかり（足先の骨が足首より前にある向き）と、腕の関節の高さも書き出す
- X Bot（Mixamo、T-pose、With Skin）は、高さ 1.81 m、正面は glTF の +Z、腕は水平（肩・肘・手首が同じ高さ 1.44 m）、骨 65 本（`mixamorig:` で始まる）、メッシュ 2 つ（`Beta_Surface`、`Beta_Joints`）。issue-25 の部位割り当てに使う

### 既知の問題

- `character.fbx` は FBX 6.1（版 6100）で、Blender の FBX 読み込み（7.1 以降のみ）では読めない。いまは使わない（基準姿勢の人型は X Bot を使う）

## 平屋: FBX を元にする（いまの手順）

平屋は `~/Downloads/平屋和風/平屋和風.fbx` を元にする。`.blend` から書き出した `hiraya.glb` には、壁に戸の開口が無い・切り抜き用の箱が見える・隠した部品が原点に出る、という問題があった（下の「元データを調べる」）。FBX は、ブーリアンが適用済みで、隠したオブジェクトを含まないため、どれも起きない。

```sh
# 1. FBX を glb にする（アニメーションは含めない。テクスチャは FBX と同じフォルダの textures/ から読む）
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input ~/Downloads/平屋和風/平屋和風.fbx \
  --output assets-src/house/hiraya-fbx.glb

# 2. 中身を調べる（戸の一覧と断面図の入力にもなる）
node tools/inspect_glb.mjs assets-src/house/hiraya-fbx.glb assets-src/house/hiraya-fbx-scene.json

# 3. ゲーム用 glb（屋内本体・屋外の飾り・屋根と天井 × 512 / 1024 の 6 本）
node tools/build_house.mjs assets-src/house/hiraya-fbx.glb assets-src/converted/house-fbx

# 4. 戸の一覧と、間取りの断面図
node tools/list_doors.mjs assets-src/house/hiraya-fbx-scene.json assets-src/house/doors-fbx.tsv
node tools/house_plan.mjs assets-src/house/hiraya-fbx.glb assets-src/house/plan-fbx.svg

# 大きさと数の表（--count で戸・障子・欄間のノードの数も）
node tools/glb_stats.mjs --count "ドア|障子|欄間" assets-src/converted/house-fbx/*.glb
```

結果（2026-10-04）:

- `hiraya-fbx.glb`: 63.2 MB、Y が上、単位 m（ノードに拡大縮小なし）。ノード 978、メッシュ 798、三角形 965,850、マテリアル 46、テクスチャ 78。外壁は幅 11.2 m・奥行き 12.1 m（x −5.2〜6.0、z 0〜12.1）で、`hiraya.glb` と同じ
- `hiraya.glb` にあって FBX に無いトップレベルのノードは 22 個で、すべて `.blend` で非表示のもの（LineArt、切り抜き用の箱、照明の別の状態、電源コードなど）。名前の付き方の違いは無く、グループ分けの条件はそのまま使える
- 浴室のシャワーの部品（お風呂 シャワー Curve）は、FBX では浴室の中の正しい位置にあるので残す（`build_house.mjs` は、浴室の床の範囲の外にあるときだけ取り除く）
- 断面図で、壁の線が戸の位置で途切れることを確かめた。15 組の戸の中心・開口の幅・向きは、前回の `doors.tsv` と一致する（片開き戸の中心だけ 0.02〜0.03 m ずれる。開口の箱が無くなり、戸の部品の外接箱で測るため）
- 戸の部品の外接箱は、開口の箱より薄く低い（厚み 0.3 m → 0.1 m、床から 0.4 m → 0.6 m。開口の箱は枠の外側まで含んでいたため）

ガラスと透明:

- ガラスのマテリアル（ガラス、ガラス アルファ01・05・08、水）は、FBX では透過の拡張を失うが、`alphaMode: BLEND`・alpha 0.1〜0.8 の半透明として出ている。不透明に出ているガラスは無いので、手を加えていない
- その一方で、FBX から変換すると、不透明なはずのマテリアル（木目、壁、カラーパレットなど）も `BLEND`（alpha 1）で出る。three.js では、半透明は奥から順に並べて描くので、壁や床が欠けて見えたり、重くなったりする。そこで `build_house.mjs` で、次の方針で直す

不透明・半透明の方針（`build_house.mjs`。テクスチャを変換する前に、全マテリアルで決める）:

- 襖・障子・欄間・和紙のマテリアル（名前で見分ける。いまは「襖」「和紙」の 2 つ）は、必ず `OPAQUE` にする。向こう側の隠れ側が透けて見えないようにするため
- それ以外は、ベースカラーの alpha が 1 で、ベースカラーのテクスチャのうち、そのマテリアルの部品が UV で参照する画素に透明なものが無いものを `OPAQUE` にする。テクスチャが無いものも `OPAQUE` にする
  - 参照する画素は、各頂点の UV と各三角形の中心の UV で調べ、透明（alpha 255 未満）が 0.01% 未満なら、透明な画素が無いとみなす
  - 画像全体で調べないのは、カラーパレット（`color palette_col`）の画像が、使っていない区画の 3% だけ透明なため。画像全体で調べると、パレットを使う 563 部品がすべて半透明になる
- alpha が 1 未満のもの（ガラス、水）と、参照する画素に透明があるもの（葉、網戸）は、`BLEND` のまま残す
- 決めた結果は、`ALPHA` の行で、マテリアルごとに変更前・変更後・理由を出す

結果（2026-10-04）: 46 個のうち、`OPAQUE` に直したもの 36、もとから `OPAQUE` 5、`BLEND` のまま 10（ガラス 4、水 1、葉 4、網戸 1）。6 本の中では、屋内本体の `BLEND` は 5（水、ガラス 3、網戸）、屋外は 5（ガラス 1、葉 4）、屋根と天井は 0

形のデータの圧縮（未実装。見込み）:

- 屋内本体は、形のデータが約 27.5 MB で、ファイルの大半を占める
- 量子化（`quantize`）だけで、512 版は 29.45 MB → 21.66 MB（gzip で送ると 9.6 MB）になった（試しに作って測った）
- meshopt（`EXT_meshopt_compression`）を足すと、さらに小さくなる見込み（ファイルで 7〜10 MB 程度）。`meshoptimizer` の追加と、ゲームの側の GLTFLoader に MeshoptDecoder の設定が要る

## 平屋: glb の中身を調べる

```sh
node tools/inspect_glb.mjs assets-src/house/hiraya.glb assets-src/house/hiraya-scene.json
```

- glb の JSON 部分を読み、次を JSON に書き出す: ノード名と親子関係、各ノードの位置（ローカル・ワールド）、メッシュごとの寸法（ローカル・ワールドの外接箱、m）、マテリアルの数、テクスチャの数と画像の大きさ（px・バイト数）
- 標準出力に要約を出す: シーンの一覧、ノード数、全体の寸法、屋根・天井・壁・床・襖・障子に見える名前
- glb が複数のシーンを持つときは、既定のシーンから辿れるノードだけで寸法と要約を出す（`hiraya.glb` は、Blender の LineArt 用の白背景シーンも含んでいて、同じノードが2組ある）

以下の「確認用 glb」「ゲーム用 glb」「戸の一覧」「断面図」の節の結果は、前回の `hiraya.glb`（.blend から）でのもの。いまは上の「FBX を元にする」の手順を使う。

## 平屋: 確認用 glb を作る（屋根・天井を外す）

```sh
node tools/prepare_house.mjs \
  assets-src/house/hiraya.glb \
  assets-src/house/hiraya-scene.json \
  assets-src/house/hiraya-preview.glb
node tools/inspect_glb.mjs assets-src/house/hiraya-preview.glb assets-src/house/hiraya-preview-scene.json
```

- 既定のシーン以外（白背景の LineArt 用シーン）を、そのノードごと取り除く
- 屋根と天井のノードを取り除く（ゲームの TPS カメラを遮るため）。名前は `hiraya-scene.json` の既定のシーンのノードから、屋根・天井の名前のもの（`inspect_glb.mjs` と同じ見分け方）を選ぶ。名前が一覧にないのに親ごと消える子孫があれば、一覧にして出す
- 使われなくなったメッシュ・マテリアル・テクスチャを整理し（prune）、重複を統合する（dedup）。空のノード（ドアの回転軸など）は残す
- テクスチャの中身（大きさ・形式）は変えない。マテリアルの拡張（ガラスの透過・発光の強さ・布の光沢）は残す

結果（2026-10-04）: 52.9 MB から 47.8 MB。屋根 22・天井 2 のノードを取り除き、ノード 1,362、メッシュ 669、マテリアル 44、テクスチャ 65。メッシュは2つのシーンで共有されていたため、白背景のシーンを外しても大きくは減らない。大半はテクスチャ（約 27 MB）で、縮小・圧縮は次の段階で行う。

## 平屋: ゲーム用 glb を作る

```sh
node tools/build_house.mjs assets-src/house/hiraya.glb assets-src/converted/house
```

入力は屋根・天井を外す前の `hiraya.glb`。トップレベルのノードの名前で3つに分け、それぞれテクスチャの長辺の上限 512px と 1024px の2種類、計6本を書き出す。

| グループ | 中身 | ファイル |
| --- | --- | --- |
| 屋内本体 | 建物、家具・設備、戸・障子・欄間、縁側、地面、玄関階段 | `hiraya-indoor-{512,1024}.glb` |
| 屋外の飾り | 木、低木、塀1・塀2、門まわり（表札、郵便受け、インターホン子機、門灯）、縁側の踏み石 | `hiraya-outdoor-{512,1024}.glb` |
| 屋根と天井 | 寄棟屋根、天井（ゲームの側で表示を切り替える） | `hiraya-roof-{512,1024}.glb` |

- 白背景のシーンを取り除き、LineArt と、浴室の外にあるシャワーの部品（お風呂 シャワー Curve。浴室の床の範囲の外にあるときだけ）と、中身の無い末端のノード（メッシュも子も無いもの。繰り返し）を取り除く。取り除いた名前と数、切り抜き用の箱の数、グループごとのトップレベルのノードは標準出力に出す
- 同じ形のメッシュ（低木_A など）は、インスタンス（`EXT_mesh_gpu_instancing`）にまとめる。動かさない部品は材質ごとに統合する（join）
- 戸・障子・欄間（名前に「ドア」「障子」「欄間」を含むノードとその子孫）は、インスタンスにも統合にも入れず、1枚ずつ別のノードのまま残す
- 整理（prune）と重複の統合（dedup）をしてから、テクスチャを WebP にして長辺を上限まで縮める（小さいものは拡大しない。品質は sharp の既定）
- マテリアルの拡張（透過・発光の強さ・光沢）は残す。three.js（0.186.1）の GLTFLoader は `EXT_texture_webp`・`EXT_mesh_gpu_instancing`・これらの拡張に対応している
- 各ファイルの大きさ・メッシュ数・三角形数（インスタンスの数を掛けたもの）・テクスチャ数を、`STATS` の行で出す

## 平屋: 戸・障子・欄間の一覧

```sh
node tools/list_doors.mjs assets-src/house/hiraya-preview-scene.json assets-src/house/doors.tsv
```

- 名前に「ドア」「障子」「欄間」を含むノードすべてについて、名前、親、寸法、中心位置（x, z）、長辺の向き、床からの高さ、襖の候補かを TSV に書き出す
- 襖の候補は「ドア 引違い戸」（2枚戸）、「ドア 引違い戸 4枚戸」、「腰付障子 引違い戸 4枚戸」の部品。片開き戸と玄関の引違い戸は候補にしない
- 外接箱は、子孫に開口の箱（名前に「 B-」を含む部品）があればそれを使う。素材には、ワールドの原点に置かれてしまう小さな部品（ドアノブ、スイッチのボタン、照明の部品など）があり、子孫すべての外接箱だと原点まで伸びるため
- 標準出力に、引違い戸の組ごとの位置と向きを出す

## 平屋: 間取りの断面図

```sh
node tools/house_plan.mjs assets-src/house/hiraya-preview.glb assets-src/house/plan.svg
```

- 高さ y = 1.0m の水平面で外壁と内壁のメッシュを切り、断面の線分を描く。畳と部屋床は上から見た輪郭、戸・障子は開口の箱の輪郭を、種類ごとに色を変えて描く。1m の格子と x・z の目盛りを入れる。右が +x、下が +z（玄関側）
- ブラウザで開いて見る。要素にマウスを載せると名前が出る

### 素材の既知の問題（2026-10-04 に確認）

- 内壁・外壁のメッシュには、戸の開口が空いていない。y = 1.0 / 2.0 / 2.6m で切っても、戸の位置で壁が途切れない。戸ごとの開口の箱（名前に「 B-」を含む、頂点 24 の不透明な箱）は、Blender のブーリアンの切り抜き用の箱と見られ、切り抜きが適用されないまま、箱自体も見えるメッシュとして書き出されている
- 一部の小さな部品（ドアノブ、照明スイッチのボタン、蛇口、ペンダントライトの部品など）は、親の位置を打ち消す位置を持っていて、ワールドの原点（0, 0, 0）に置かれる。Blender では拘束などで正しい位置にあったものが、glTF に書き出すときに外れたと見られる

## 平屋: 元データ（.fbx / .blend）を調べる

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/inspect_house_source.py -- \
  --input ~/Downloads/平屋和風/平屋和風.fbx \
  --doors assets-src/house/doors.tsv \
  --output assets-src/converted/house/source-fbx.json
```

- `--input` に `.blend` も渡せる（読み込むだけで、保存しない）
- 壁をモディファイアーを適用した形で y = 1.0m で切り、`doors.tsv` の戸の組ごとに、開口の中に残る壁の断面の長さを測る（0 なら開口がある）。確かめのため、開口のすぐ脇の長さと、壁の断面の範囲も出す
- 切り抜き用の箱（「 B-」）の数と表示の設定、ブーリアンと拘束の数、ドアノブ・照明スイッチ・蛇口・ペンダントライトの部品の位置を出す

結果（2026-10-04）:

| 項目 | hiraya.glb | 平屋和風.fbx | 平屋和風.blend（評価後） |
| --- | --- | --- | --- |
| 戸の開口（15 組の、開口の中の壁） | 全部ふさがっている（4枚戸 6.72m、2枚戸 3.20m、片開き戸 1.12〜1.32m） | 全部 0（空いている） | 全部 0（空いている） |
| 切り抜き用の箱（「 B-」） | 見えるメッシュとして残っている | 無い | 37 個。表示・レンダーとも隠してあり、ワイヤー表示 |
| ブーリアン | 適用されていない | 適用済み（0 個） | 242 個（壁 29、家具・設備など） |
| 部品の位置 | 原点に置かれるものがある | 79 個、すべて正しい位置（原点 0） | 見える 79 個は正しい位置。原点の 50 個はすべて非表示（レンダーで隠す 2、隠したコレクション 12、ほか見えない 36） |

- `hiraya.glb` の2つの問題は、`.blend` から glTF に書き出すときに、モディファイアーを適用せず、隠したオブジェクト（切り抜き用の箱、別の状態の部品）も含めたために起きたと見られる
- `平屋和風.fbx` は、どちらの問題も無い。テクスチャは同じフォルダの `textures/`（89 枚）を参照し、すべて見つかる。オブジェクト 978、メッシュ 827、三角形 965,850、マテリアル 49。LineArt は無く、屋根 22・天井 2 を含む
- FBX は、ガラスの透過などの glTF のマテリアルの拡張を持てない。FBX から作るときは、ガラスのマテリアルを見直す

## 利用規約

規約の全文の写しは、公開リポジトリに入れない。原本は `assets-src/licenses/`（各自の手元）に置き、`docs/licenses/README.md` に素材ごとの要点だけをまとめる。

| 素材 | 制作者 | 原本 | 備考 |
| --- | --- | --- | --- |
| 平屋和風 | 3Dで漫画を作ろう | `assets-src/licenses/license.txt`（2025-10-11） | 二次的な配布・販売は禁止。入手先は未記入 |
| キャラクター（Mixamo） | Adobe | 未用意 | 規約の写しがまだ無い |
