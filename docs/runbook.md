# 当日の運用メモ（runbook）

発表会の当日に、運営が見る手順。ほかの節（つながらない、素材が出ない、再起動、戻す、連絡先）は、issue-62 で足す。ここには、いま決まっている、観戦ルームの節だけを書く。

## 観戦ルームを使う（issue-67）

観戦ルームは、CPU だけの試合を、来場者が好きなキャラクターの視点で見るためのルーム。旗（`SPECTATE_READY`。サーバーは `veryare.spectate_ready`、web は `apps/web/src/platform/lobby/spectateFlag.ts`）は、下ろしたまま（false）にしておく。当日だけ、サーバー（ws）の環境変数 `RONDO_SPECTATE_DEV=1` で、観戦ルームの作成を受け付けるようにし、運営の画面（`?operator=1`）から作る。

- 来場者の画面（`/lobby/veryare`）には、観戦ルームを作るトグルは出ない。観戦ルームの行（「観戦」）は出るが、旗が下りている間は押せない
- 運営の画面（`/lobby/veryare?operator=1`）では、トグルが出て、観戦ルームを作れる。観戦の行も押せる。URL を知られても、サーバーが受け付けなければ作れない（環境変数を戻せば、作れなくなる）
- web のビルド変数 `NEXT_PUBLIC_RONDO_SPECTATE_DEV` は、本番では使わない（env ファイルにも書かない。`./tools/check-prod-flags.sh` で確かめる）

### 受け付けるようにする（当日の朝）

A1 で行う。web は作り直さない（ws だけ）。

1. A1 の env ファイル（リポジトリの外。例: `~/rondo.env`）に、1 行を足す

   ```bash
   RONDO_SPECTATE_DEV=1
   ```

2. ws を作り直す（`docker-compose.server.prod.yml` が、env ファイルの値をコンテナへ渡す）

   ```bash
   deploy/a1-deploy.sh --env-file ~/rondo.env ws
   ```

3. 確かめる

   ```bash
   docker exec rondo-ws printenv RONDO_SPECTATE_DEV   # 1 と出ればよい
   ./tools/check-prod-flags.sh --env-file ~/rondo.env  # web の旗が無いこと（名前だけを探す。値は出さない）
   ```

4. 運営の端末で、`https://<web の URL>/lobby/veryare?operator=1` を開き、「観戦ルームを作る」を入れて、ルームを作る。作った人は観戦者として入り、試合がすぐ始まる
   - 隠れ CPU の数（1〜4。既定 3）と、探索の時間（既定 100 秒）を選べる。ステージは、ランダム間取りだけ
   - 観戦ルームは、同時に 1 つまで（人間のルームの 3 つとは別の枠 / ADR 0051）
   - 観戦者が 0 人のまま 60 秒たつと、閉じる。会場の画面に映し続けるときは、その端末を観戦の画面のままにしておく

### 戻す（当日の終わり、または問題が出たとき）

1. env ファイルの `RONDO_SPECTATE_DEV=1` の行を消す（または `RONDO_SPECTATE_DEV=` と空にする）
2. ws を作り直す

   ```bash
   deploy/a1-deploy.sh --env-file ~/rondo.env ws
   ```

3. 確かめる: `docker exec rondo-ws printenv RONDO_SPECTATE_DEV` が空（何も出ない）。運営の画面から作ろうとすると、作れない（`invalid-settings`）

- ws を作り直すと、サーバーが起動し直すので、そのときのルームは、人間のルームも含めて、すべて無くなる（つながっていた人は、つなぎ直したあと、ロビーから入り直す）。誰も遊んでいないときに行う
- 観戦ルームだけを止めたいときも、同じ手順（人間のルームの動きは変わらない）
