# デプロイ手順（本番）

rondo の本番は、A1 上の Coolify が Docker Compose でビルド・起動し、Cloudflare Tunnel を通じて公開する。staging は廃止し、prod 一本で運用する（issue-35）。

## 構成

```
ブラウザ
  │  https（TLS は Cloudflare で終端）
  ▼
Cloudflare（DNS / Tunnel）
  │  A1 は公開 IP を持たないため、Tunnel で A1 の 80 番へ届ける
  ▼
A1: Traefik（Coolify のプロキシ / entryPoint: http / 80 番）
  │  動的設定 /data/coolify/proxy/dynamic/rondo.yaml でホスト名ごとに振り分ける
  ├─ rondo.chapy0706.com     → http://rondo-app:3000   フロント（Next.js）
  └─ ws-rondo.chapy0706.com  → http://rondo-ws:3000    リアルタイム基盤（Gleam / mist、/ws）
```

- 2つのコンテナは `coolify` ネットワーク（外部ネットワーク）に参加し、Traefik からコンテナ名で届く。ホストへのポート公開はしない
- コンテナ名は compose の `container_name` で **`rondo-app`** と **`rondo-ws`** に固定している。再デプロイしても名前が変わらないので、Traefik の動的設定は一度書けば書き換えなくてよい
- Traefik のルーティングは、compose のラベルや Coolify の自動ラベルに頼らず、動的設定ファイルで行う（Coolify の自動ラベルは Host が空になって壊れることがあるため）

## ファイル

| ファイル | 役割 |
| --- | --- |
| `docker-compose.web.prod.yml` | フロントの本番構成。サービス・コンテナ名 `rondo-app`。リポジトリ直下を起点に `apps/web/Dockerfile` でビルド |
| `docker-compose.server.prod.yml` | リアルタイム基盤の本番構成。サービス・コンテナ名 `rondo-ws`。`server/` を起点に `server/Dockerfile` でビルド |
| `docs/ops/traefik-rondo.yaml` | A1 の Traefik 動的設定の見本。`/data/coolify/proxy/dynamic/rondo.yaml` に置く内容 |
| `docker-compose.yml` | ローカルで2サービスを本番相当に起動して確かめる用（本番では使わない） |

## 運用

- ブランチは **prod** だけを本番に使う。prod へマージすると、Coolify が2つのアプリを再ビルドする
- フロントは既定でモック動作（サーバー不要）。リアルタイム基盤に実接続するときは、web のビルド変数 `NEXT_PUBLIC_RONDO_WS_URL` に `wss://ws-rondo.chapy0706.com/ws` を設定して再デプロイする（issue-31）。`NEXT_PUBLIC_*` はビルド時に埋め込まれるため、設定を変えたら必ず再ビルドする

## Docker Compose 方式への切り替え手順（一度だけ行う人手作業）

順番どおりに行う。

1. **web アプリを compose 方式にする（Coolify）**
   - Build Pack: **Docker Compose**
   - Docker Compose Location: **`/docker-compose.web.prod.yml`**
   - Branch: **prod**
   - ビルド変数 `NEXT_PUBLIC_RONDO_WS_URL`: 実接続に切り替えるまでは未設定のままでよい
   - ドメイン欄: **空にする**（ルーティングは Traefik の動的設定で行う）
2. **server アプリを compose 方式にする（Coolify）**
   - 1 と同様に、Docker Compose Location を **`/docker-compose.server.prod.yml`** にする（Branch は prod、ドメイン欄は空）
3. 既存アプリの Build Pack を切り替えられない場合は、上の設定で新しいアプリを作り直す（古いアプリは、新しいほうの動作を確かめてから止める）
4. 再ビルド後、A1 でコンテナ名を確認する

   ```bash
   docker ps --format '{{.Names}}' | grep rondo
   # rondo-app と rondo-ws が出れば成功
   ```

   compose ファイルの構文は、A1 のリポジトリの作業コピーで次のように確かめられる（エラーが出なければ通っている）。

   ```bash
   docker compose -f docker-compose.web.prod.yml config > /dev/null
   docker compose -f docker-compose.server.prod.yml config > /dev/null
   ```

5. A1 の **`/data/coolify/proxy/dynamic/rondo.yaml`** を、`docs/ops/traefik-rondo.yaml` の内容（固定した名前 `rondo-app` / `rondo-ws` を向いたもの）に一度だけ書き換える。**ファイルの末尾に空行を1つ残す**。Traefik は保存を検知して自動で読み直す
6. 疎通を確認する（200 が返れば成功）

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -H "Host: rondo.chapy0706.com" http://localhost:80
   curl -s -o /dev/null -w "%{http_code}\n" -H "Host: ws-rondo.chapy0706.com" http://localhost:80
   ```

以後の再デプロイでは、コンテナ名が変わらないので、5 の書き換えは不要。

## うまく動かないときの切り分け

外側から疑わず、内側から順に確かめる。

1. **コンテナ**: 2つとも起きているか

   ```bash
   docker ps --filter name=rondo
   docker logs --tail 100 rondo-app
   docker logs --tail 100 rondo-ws
   ```

   名前が `rondo-app` / `rondo-ws` でない場合は、Coolify の Build Pack と Docker Compose Location を見直す。

2. **内部応答**: `coolify` ネットワークの中から、コンテナ名で応答が返るか（Traefik のコンテナ `coolify-proxy` から叩く）

   ```bash
   docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-app:3000/ 2>&1 | head -1
   docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-ws:3000/ 2>&1 | head -1
   # HTTP/1.1 200 OK が出れば応答している
   ```

   返らない場合は、コンテナが `coolify` ネットワークに参加しているかを確かめる（`docker inspect rondo-app --format '{{json .NetworkSettings.Networks}}'`）。

3. **Traefik**: ホスト名で振り分けられるか（手順 6 の curl）。404 の場合は動的設定のホスト名・ファイル名・末尾の空行を、502 の場合は動的設定の向き先（コンテナ名・ポート 3000）を確かめる。読み込みエラーは `docker logs --tail 100 coolify-proxy` に出る
4. **外部**: ブラウザや手元から `https://rondo.chapy0706.com` を開く。ここだけ失敗する場合は、Cloudflare Tunnel の状態と、Cloudflare 側の公開ホスト名の設定を確かめる
