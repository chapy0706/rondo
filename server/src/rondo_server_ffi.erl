%% rondo サーバーの小さな Erlang 関数（issue-31）。
%%
%% Gleam の標準ライブラリに無い、暗号用の乱数と単調に増える番号・時刻だけをここに置く。
-module(rondo_server_ffi).
-export([random_hex/1, unique_number/0, monotonic_ms/0]).

%% Bytes バイトの暗号用乱数を、小文字の16進数の文字列で返す。
%% プレイヤー識別子・復帰トークン・ルーム ID に使う（推測しにくい値）。
random_hex(Bytes) ->
    binary:encode_hex(crypto:strong_rand_bytes(Bytes), lowercase).

%% VM の中で単調に増える正の整数。既定の表示名 userN の番号に使う。
unique_number() ->
    erlang:unique_integer([positive, monotonic]).

%% 単調に増える時刻（ミリ秒）。ハートビートの待ち時間の判定に使う（issue-41）。
monotonic_ms() ->
    erlang:monotonic_time(millisecond).
