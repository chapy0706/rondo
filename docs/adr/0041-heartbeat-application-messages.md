# ADR 0041: ハートビートはアプリ層の電文（ping / pong）で行う

- ステータス: 提案（下書き）
- 日付: 2026-10-06
- 関連: ADR 0007（単一接続の多重化）、ADR 0009（契約は TypeScript を正とする）、ADR 0013（再接続猶予10秒）。本 ADR は既存の ADR を書き換えない

## 文脈

本番は Cloudflare Tunnel 経由で WebSocket をつなぐ。veryare の待機ルームのように、誰も動かず通知も出ない時間が続くと、無通信の接続が途中で切られることがある。切れても再接続（ADR 0013）はあるが、復帰が猶予内に間に合わなければ離脱になる。

また、相手が黙って消えた接続（回線の断など）は、TCP の検知に任せると長く残る。サーバーは猶予に入れず、クライアントは「接続中」のまま止まる。

切断の条件を、公式ドキュメントで確かめた（2026-10-06）。

- Cloudflare の WebSockets のページ（https://developers.cloudflare.com/network/websockets/ ）は、どちらの向きにもデータが流れない時間が続くと接続を閉じる、とだけ書き、**秒数を書いていない**（Enterprise は変更できる）。対策として ping/pong のハートビートを勧めている
- Connection limits（https://developers.cloudflare.com/fundamentals/reference/connection-limits/ ）の Cloudflare と origin の間の表には、WebSocket 専用の行がない。Proxy Read Timeout は 125 秒、Proxy Idle Timeout は 900 秒
- cloudflared の origin の設定（https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/cloudflared-parameters/origin-parameters/ ）の keepAliveTimeout は、既定 1分30秒（90 秒）

WebSocket のプロトコルには ping/pong の制御フレームがあるが、サーバーの mist（6.0.3。公開されている最新版）では次の制約がある。

- サーバーから ping フレームを送る公開の関数がない（送れるのは text と binary だけ）
- クライアントからの pong フレームを、アプリのハンドラに渡さずに捨てる。クライアントの ping には mist が自動で pong を返すが、ブラウザの JavaScript には ping を送る API がない

## 決定

**ハートビートは、アプリ層の電文で行う**: サーバーからクライアントへ `{ "type": "ping" }`、クライアントからサーバーへ `{ "type": "pong" }` を、契約（`packages/contracts` の messages）に加える（ADR 0009。Gleam の `protocol/message.gleam` と対応テストもそろえる）。

- サーバーは、通信の有無にかかわらず、固定の間隔（既定 20 秒）で全接続に ping を送る
- サーバーは、クライアントからの電文（pong を含め何でもよい）が待ち時間（既定 50 秒）のあいだ届かなければ、ソケットを閉じる。閉じたソケットは、再接続猶予（ADR 0013、10 秒）に入る
- クライアントは、ping を受けたら pong を返す。サーバーから何も届かない時間が待ち時間を超えたら、接続を失ったとみなし、既存の再接続の仕組みでつなぎ直す
- ping と pong は接続の層（サーバーはソケットごとのハートビート、クライアントは WebSocketAdapter）で処理し、ルーム・ゲーム・画面には渡さない。切断中の配信の一時保管（最大200件）にも入れない
- 間隔と待ち時間は設定で変えられ、テストでは短くする

**mist の内部（internal）のモジュールは使わない**。

**秒数の根拠**: Cloudflare の公式ドキュメントに WebSocket の無通信切断の秒数がないため、確かめられた値のうち短い cloudflared の keepAliveTimeout（90 秒）を基準にする。その半分以下で通信を流すよう、間隔を 20 秒とする。待ち時間は ping 2 回分に余裕を足した 50 秒とする。

## 理由

- mist が pong をアプリに渡さないため、プロトコル上の pong では「応答のない接続」を検知できない。アプリ層の電文なら、届いたこと自体を両側で確かめられる
- mist の内部 API（フレームの組み立てと送信）を直接使えば ping フレームは送れるが、公開の API ではないため、mist の更新で壊れうる。検知もできないままなので、利点が小さい
- 電文は1通十数バイトで、20 秒に1往復なので、通信量と電池への影響は小さい
- 接続の層で閉じることで、ルームとゲームは変わらない。ハートビートが止まっても失敗しても、起きるのは既存の切断と再接続（ADR 0013）だけで、ゲームの進行には新しい分岐を持ち込まない

## 検討した代替案

- プロトコル上の ping/pong フレームだけで行う案。mist の内部 API に頼ることになり、応答のない接続も検知できないため採用しない
- 通信がないときだけ ping を送る案。送るかどうかの判定が増える。固定の間隔でも通信量は小さいため、単純な方を採る
- クライアントから ping を送る案。応答のない接続をサーバー側で閉じるには、どのみちサーバーがクライアントの電文の途切れを見る必要がある。送る側をサーバーに寄せ、間隔の設定を1か所にする

## 結果

- issue-41 で、契約・Gleam の protocol・対応テスト、サーバーのハートビート（`connection/heartbeat.gleam`）と、WebSocketAdapter の pong と無通信の検知を実装する
- 本番（Cloudflare 経由）で、無操作の待機ルームが2〜3分維持されることを、手で確かめる
- 将来 mist が pong を渡すようになっても、契約の ping / pong はそのまま使える
