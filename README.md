# rondo

スマホで遊ぶことを前提に、ひとつの基盤の上でいくつもの小さなゲームが選んで遊べるブラウザゲームプラットフォーム。

リアルタイムで競うゲームも、一人で黙々と遊ぶゲームも、同じ場所に並ぶ。
勝ち負けそのものより、「ちょっと集まって、少し遊んで、また明日」くらいの軽さを大事にする。

名前の rondo は輪舞曲（ロンド）から。主題が入れ替わり立ち替わり現れては戻ってくる音楽形式のように、いくつものゲームがひとつの場所を巡る、という構造を表している。

## コンセプト

ゲームを「プラットフォームに後から差し込めるプラグイン」として扱う。
基盤はゲームの中身を知らない。基盤が知っているのは「ゲームが自己紹介する形式（マニフェスト）」と「ゲームが基盤と話すための契約」だけ。

新しいゲームを足すときは、ゲーム本体とマニフェストを追加するだけで済む。
基盤側のコードは原則いっさい触らない。拡張に開いて、修正に閉じている状態を保つ。

ゲームは2種類に分かれる。

- ソロゲーム: ブラウザ内で完結する。通信を必要としない（例: テトリス、2048、マインスイーパ）
- リアルタイムゲーム: 複数人がルームに集まり、サーバーを介して同期する（例: Tilt Maze、かくれんぼ）

この2層を最初から分けておくことで、通信の都合がソロゲームに漏れ出さない。
必要なものだけを繋ぐ、という方針を構造で守る。

## 設計思想

- Clean Architecture: ドメイン層は外部に依存しない。DB・WebSocket・ゲームエンジン・描画はすべてアダプターとして実装する
- UNIX哲学: 各モジュールは単一の責任を持ち、小さく繋ぐ。ゲームは「ひとつのことをうまくやる」単位として独立させる
- プラグイン指向: ゲームは自己記述する。基盤はマニフェストを読んで選択画面を組み立てるだけで、個々のゲームを知らない
- OTPアクターモデル: リアルタイム基盤では「1ルーム = 1プロセス」「1接続 = 1プロセス」とし、障害を局所化する
- DDD（軽量版）: Entity、Value Object、Repositoryパターンを採用。Aggregate Rootは必要に応じて導入
- TDD: ゲームルールやルーム状態遷移など、判定ロジックはテストファーストで実装する

## 技術スタック（案）

| レイヤー           | 技術                              | 用途                                         |
| ------------------ | --------------------------------- | -------------------------------------------- |
| フロントエンド     | Next.js (App Router) / TypeScript | TOP画面、ゲーム選択画面、各ゲームのホスト     |
| ゲーム描画         | Canvas / Phaser.js                | ゲームごとに適した方を選択                    |
| UIスタイリング     | Tailwind CSS / shadcn/ui          | 基盤UIと共通コンポーネント                    |
| 状態管理           | Zustand                           | フロント側のUI状態管理                        |
| リアルタイム基盤   | Gleam / OTP + mist                | ルーム管理・接続管理・メッセージ配信          |
| メッセージ契約     | TypeScript（contracts）           | サーバー・クライアント間の型共有              |
| ORM                | Drizzle ORM                       | 型安全なDB操作（Phase 2以降）                 |
| データベース       | PostgreSQL                        | ランキング、対戦履歴（Phase 2以降）           |
| パッケージ管理     | pnpm (workspaces)                 | モノレポのパッケージ管理                      |
| デプロイ           | A1 + Coolify + Cloudflare Tunnel  | セルフホスト。スリープなし、公開IP不要        |

リアルタイム基盤の言語選択について補足する。
バックエンドにGleam/OTPを選ぶのは、ルームと接続をそれぞれ独立した軽量プロセスとして扱えるためで、これはマルチプレイヤーのルーム管理に本質的に向いている。nagomi-wsで確立したGleam/OTP + mistの構成をそのまま土台として再利用する。

## リアルタイム基盤の責務境界

サーバーは原則として「薄く」保つ。ルームのライフサイクル管理と、メッセージの配信を担う。

ただしゲームによっては、不正防止や勝敗確定のためにサーバー側の権威判定が必要になる（例: かくれんぼの隠れ位置の真偽、Tilt Mazeのゴール到達順）。
どこまでをサーバー権威とし、どこからをクライアント表現に委ねるかは、ゲームごとにADRで個別に決める。基盤としては「サーバー権威を載せられる箱」だけを用意し、賢さの量はゲームが決める。

## ディレクトリ構成（案）

```
rondo/
├── README.md
├── CLAUDE.md                           # Claude Code エントリーポイント
├── package.json                        # pnpm workspaces ルート定義
├── pnpm-workspace.yaml                 # ワークスペース設定
├── Makefile                            # check / dev / lint / test
├── .claude/
│   ├── README.md                       # .claude ディレクトリの説明
│   ├── settings.json                   # パーミッション・hooks設定
│   ├── rules/
│   │   ├── 01-architecture.md          # アーキテクチャ制約
│   │   ├── 02-security.md              # セキュリティルール
│   │   └── 03-token.md                 # トークン節約ルール
│   ├── hooks/
│   │   ├── block-dangerous.sh          # 危険コマンドのブロック
│   │   └── protect-secrets.sh          # 機密ファイルの読み取り防止
│   └── skills/
│       ├── solo-game.md                # ソロゲームの追加パターン
│       ├── realtime-game.md            # リアルタイムゲームの追加パターン
│       ├── game-manifest.md            # マニフェスト登録パターン
│       ├── gleam-actor.md              # OTPアクター追加パターン（サーバー側）
│       ├── react-component.md          # Reactコンポーネントの作成パターン
│       └── test.md                     # テストの書き方
├── .github/
│   └── workflows/
│       └── ci.yml                      # staging push時の自動CI
│
├── packages/
│   ├── contracts/                      # サーバー・クライアント・ゲーム間の契約
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── game.ts                 # Game / SoloGame / RealtimeGame インターフェース
│   │       ├── manifest.ts             # GameManifest 型（選択画面の自動生成に使う）
│   │       ├── messages.ts             # WebSocketメッセージ契約（Gleam側と対応）
│   │       └── result.ts               # スコア・結果の共通型
│   │
│   └── game-sdk/                       # ゲームが基盤と話すための薄いSDK
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── solo.ts                 # ソロゲーム用フック（結果を基盤に返すだけ）
│           └── realtime.ts             # リアルタイムゲーム用フック（ルーム接続を扱う）
│
├── apps/
│   └── web/                            # Next.js フロントエンド
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── page.tsx            # TOP画面
│           │   ├── select/
│           │   │   └── page.tsx        # ゲーム選択画面（マニフェストから自動生成）
│           │   └── play/
│           │       └── [gameId]/
│           │           └── page.tsx    # ゲームホスト（選ばれたゲームを起動）
│           ├── platform/               # 基盤UI（ゲームに依存しない）
│           │   ├── select/             # 選択画面コンポーネント
│           │   ├── lobby/              # ルーム待機・参加
│           │   └── result/            # 結果発表
│           ├── games/                  # ゲーム実装（プラグイン）
│           │   ├── registry.ts         # 全マニフェストの集約（ここだけが全ゲームを知る）
│           │   ├── tilt-maze/          # リアルタイム（ちゃぴぃ担当）
│           │   │   ├── manifest.ts
│           │   │   ├── game.ts
│           │   │   └── render/
│           │   ├── kakurenbo/          # リアルタイム（Phase 2）
│           │   │   ├── manifest.ts
│           │   │   └── game.ts
│           │   └── tetris/             # ソロ（相方担当）
│           │       ├── manifest.ts
│           │       └── game.ts
│           ├── store/
│           │   ├── selectStore.ts
│           │   └── gameUIStore.ts
│           └── infrastructure/
│               └── realtime/
│                   ├── WebSocketAdapter.ts      # Gleamサーバーへの接続（1本を多重化）
│                   └── MockWebSocketAdapter.ts  # サーバーなしでの開発用
│
├── server/                             # Gleam/OTP WebSocketサーバー（リアルタイム基盤）
│   ├── gleam.toml
│   ├── manifest.toml                   # 依存バージョンのピン留め
│   └── src/
│       ├── rondo_server.gleam         # エントリーポイント
│       ├── connection/
│       │   ├── connection_actor.gleam  # 1接続 = 1アクター
│       │   └── registry.gleam          # 接続レジストリ
│       ├── room/
│       │   ├── room_actor.gleam        # 1ルーム = 1アクター
│       │   ├── room_supervisor.gleam   # ルームの生成・監視
│       │   └── room_id.gleam
│       ├── games/                      # ゲーム固有のサーバー権威ロジック
│       │   ├── tilt_maze/
│       │   └── kakurenbo/
│       └── protocol/
│           └── message.gleam           # メッセージ契約（contracts と対応させる）
│
└── docs/
    ├── design-spec.md                  # 設計仕様
    ├── architecture.md                 # アーキテクチャ設計書
    ├── directory-structure.md          # ディレクトリ構成の説明
    ├── glossary.md                     # 用語集
    ├── onboarding.md                   # 新メンバー向けガイド（相方向け）
    └── adr/                            # Architecture Decision Records
```

### 依存の方向

```
presentation (web) --> application --> domain <-- infrastructure
                          |                          |
                          └──────────────────────────┘
                          (Dependency Inversion)

games (plugin) --> game-sdk --> contracts <-- platform
```

ドメインと契約（contracts）が中心で、何にも依存しない。
各ゲームはSDKと契約だけを見て作られ、基盤の内部を知らない。基盤は registry を通してマニフェストの一覧だけを受け取る。

### パッケージ間の関係

```
@rondo/contracts  : 契約・型定義（全パッケージが参照する中心）
@rondo/game-sdk   : ゲーム開発キット（contracts に依存）
@rondo/web        : Next.jsフロントエンド（contracts / game-sdk に依存）
server (Gleam)     : 独立。contracts のメッセージ契約に protocol を対応させる
```

## ゲームの追加方法

ゲームは自分自身を記述したマニフェストを持つ。基盤はこのマニフェストを `registry` で集約し、選択画面を自動生成する。

```ts
// games/tilt-maze/manifest.ts
import type { GameManifest } from "@rondo/contracts";

export const tiltMazeManifest: GameManifest = {
  id: "tilt-maze",
  title: "Tilt Maze",
  kind: "realtime",        // "realtime" | "solo"
  minPlayers: 2,
  maxPlayers: 4,
  thumbnail: "/games/tilt-maze.png",
  description: "スマホを傾けて球を転がし、最速で10面クリアを目指す",
};
```

ソロゲームは `kind: "solo"` を宣言し、リアルタイム接続を一切受け取らない。
新しいゲームを足すときの作業は次の3つだけ。

1. `games/<id>/` にゲーム本体とマニフェストを追加する
2. `games/registry.ts` にマニフェストを登録する
3. （リアルタイムゲームの場合のみ）`server/src/games/<id>/` にサーバー権威ロジックを追加する

基盤のUI・ルーティング・接続管理には手を入れない。

## チーム（仮）

| 担当         | 担当領域                                                       |
| ------------ | -------------------------------------------------------------- |
| リーダー     | 基盤全体 / Gleam・OTPサーバー / 契約設計 / リアルタイムゲーム1本 |
| メンバー     | ソロゲーム / TOP画面・ゲーム選択画面のUI                         |

役割分担の考え方を補足する。
リアルタイム基盤とGleam/OTPはリーダーが持つ。メンバーが担当するソロゲーム（テトリス等）はフロントで完結し、Gleamに触れる必要がない。契約（`Game` / `SoloGame` インターフェースと `GameManifest`）はリーダーが先に固めて渡す。メンバーは「この型を満たすものを作る」だけでよい状態にする。

TOP画面・ゲーム選択画面をメンバーが作る場合も、リーダーが最小限のプレースホルダーを先に置く。メンバーの作業が止まっても基盤は動き続け、仕上がったら差し替える。

## セットアップ

```bash
# リポジトリのクローン
git clone https://github.com/chapy0706/rondo.git
cd rondo

# 依存のインストール（フロント側を一括）
pnpm install

# 開発サーバーの起動（フロント + モックWebSocket）
make dev
```

`make dev` で Next.js 開発サーバーが起動する。リアルタイムゲームの動作確認には Gleam サーバーも起動する。

### Gleamサーバーの起動

```bash
# server ディレクトリで（A1上のDockerコンテナ内、またはローカルのGleam環境）
cd server
gleam run
```

### pnpm のインストール

pnpm が未インストールの場合は、以下のいずれかでインストールする。

```bash
# Node.js corepack 経由（推奨）
corepack enable
corepack prepare pnpm@latest --activate

# npm 経由
npm install -g pnpm
```

## コマンド一覧（案）

| コマンド            | 内容                                            |
| ------------------- | ----------------------------------------------- |
| `make check`        | lint + 型チェック + テスト（push前に必ず実行）  |
| `make dev`          | フロント + モックWebSocketを起動                |
| `make dev-web`      | Next.js開発サーバーのみ起動                     |
| `make dev-server`   | Gleam WebSocketサーバーのみ起動                 |
| `make lint`         | ESLintの実行                                    |
| `make type-check`   | TypeScriptの型チェック                          |
| `make test`         | Vitestでフロントのテスト実行                    |
| `make test-server`  | Gleamサーバーのテスト実行（gleam test）         |
| `make install`      | 全パッケージの依存インストール                  |
| `make clean`        | node_modules / ビルド成果物の削除               |

## ブランチ戦略

| ブランチ  | 用途                                        |
| --------- | ------------------------------------------- |
| `staging` | 開発用。全員がここに直接pushする            |
| `prod`    | 本番用。stagingが安定したらリーダーがマージ |

### ルール

- 原則全員が staging に直接 push する。壊してOK、学んで直す
- push前に `make check` を実行する（最低限の品質保証）
- GitHub Actions が毎push時にCIを実行する（マージブロックなし）
- prod へのマージは staging が安定してからリーダーが実施
- ローカル環境でのAI使用可（ただしAPI等のアクセストークン類は原則記載不可）

## デプロイ

A1 + Coolify + Cloudflare Tunnel のセルフホスト構成にデプロイする。
フロント（Next.js）と Gleam サーバーをそれぞれ Coolify のサービスとして配置し、Cloudflare Tunnel 経由で公開する。A1 は公開IPを持たないため、外部公開はすべて Tunnel を通す。

## 開発フェーズ

### Phase 1（現在）: 基盤とプラグインの実証

「ゲームをプラグインとして差し込める基盤」が成立することを、最小構成で証明する。ここが発表会の死守ライン。

- 基盤: TOP画面、ゲーム選択画面（マニフェスト自動生成）、ルーム・ロビー、結果発表
- リアルタイム基盤: Gleam/OTPサーバー（ルームアクター・接続アクター・配信）
- リアルタイムゲーム1本: Tilt Maze
- ソロゲーム1本: テトリス（プラグインで足せることの実証）

### Phase 2（将来）: ゲームを増やす

- ソロゲームの追加（2048、マインスイーパ等）
- リアルタイムゲーム かくれんぼ の追加
- ランキング・対戦履歴の永続化（PostgreSQL + Drizzle）

### Phase 3（将来）: 賑わいと拡張

- 観戦機能
- キャラクター・テーマのカスタマイズ
- ゲーム横断のスコアや実績

## ライセンス

MIT LICENSE
