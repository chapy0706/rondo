# issue-02: Claude Code 用開発基盤の構築

## 背景

rondo の実装は Claude Code を中心に進める。実装 issue（03 以降）に入る前に、Claude Code が安全かつ一貫して作業できる足場を整える。

具体的には、モノレポの骨格、共通コマンド、CI、そして Claude Code に渡すルール・スキル・hooks を用意する。ここを先に固めることで、以降の実装で「アーキテクチャ制約」や「禁止操作」を毎回説明し直さずに済む。

rondo はフロント（TypeScript / pnpm workspaces）と Gleam サーバーが併存するモノレポである。両者を同じリポジトリで扱える構成を最初に作る。

## スコープ

リポジトリの骨格と Claude Code 連携基盤を構築する。実装そのものはまだ行わない。

### このissueでやること

- pnpm workspaces のモノレポ骨格を作る（packages / apps、Gleam server の併置）
- Makefile を作る（check / dev / lint / test ほか）
- CLAUDE.md を作る（Claude Code のエントリーポイント）
- .claude/ 一式を作る（settings / rules / hooks / skills）
- .github/workflows/ci.yml を作る（staging push 時の CI）
- bootstrap.toml を作る（project-bootstrap で初期化できる状態にする）
- 各パッケージの package.json / tsconfig.json の雛形を置く

### このissueでやらないこと

- contracts の型定義の実装（issue-03 で対応）
- ゲーム・基盤UI・サーバーの実装（issue-04 以降で対応）
- 本番デプロイ（issue-15 で対応）

## 設計方針

### モノレポにフロントと Gleam を併置する

- pnpm workspaces で TypeScript 側（packages / apps）を束ねる
- Gleam サーバーは server/ に置き、gleam.toml で独立管理する
- TypeScript と Gleam のビルド・テストを Makefile から横断的に叩けるようにする

### Claude Code に制約を先に渡す

- .claude/rules/ にアーキテクチャ制約・セキュリティ・トークン節約のルールを置く
- ドメイン層・契約を壊す変更を抑止する制約を明文化する
- .claude/skills/ に「ソロゲーム追加」「リアルタイムゲーム追加」「マニフェスト登録」「OTPアクター追加」などの定型パターンを置く

### 危険操作と機密を hooks で守る

- block-dangerous.sh で破壊的コマンドをブロックする
- protect-secrets.sh で機密ファイルの読み取りを防ぐ
- アクセストークン類はリポジトリに含めない方針を hooks とルールの両面で担保する

### CI はブロックしない

- staging への毎 push で CI を回す
- lint + 型チェック + テストを走らせるが、マージはブロックしない
- 壊してよい、学んで直すという開発スタンスを CI 設計にも反映する

## 受け入れ条件

- pnpm install がルートで通り、workspaces が解決される
- make check（lint + 型チェック + テスト）が実行できる
- make dev でフロント開発サーバーが起動する
- server/ で gleam の雛形プロジェクトが認識される（gleam ビルドが通る最小状態）
- CLAUDE.md が存在し、リポジトリの構成とルールの所在を案内している
- .claude/ に settings / rules / hooks / skills が配置されている
- block-dangerous.sh と protect-secrets.sh が動作する
- .github/workflows/ci.yml が staging push をトリガに動く
- bootstrap.toml が存在し、初期化手順が記述されている

## 段階

1. pnpm workspaces のルート（package.json / pnpm-workspace.yaml）と空の packages / apps を作る
2. server/ に Gleam の雛形（gleam.toml）を置く
3. Makefile を作り、フロントと Gleam を横断するコマンドを定義する
4. CLAUDE.md と .claude/rules/ を書く（アーキテクチャ制約・セキュリティ・トークン）
5. .claude/hooks/（block-dangerous / protect-secrets）を置いて動作確認する
6. .claude/skills/ に定型パターンを置く
7. .github/workflows/ci.yml を作る
8. bootstrap.toml を作る
9. make check が一通り通ることを確認する

## 関連

- 先行: issue-01（仕様策定）
- ADR 0011: モノレポ構成を採る
- 後続: issue-03（contracts パッケージ）
