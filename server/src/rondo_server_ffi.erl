%% rondo サーバーの小さな Erlang 関数（issue-31）。
%%
%% Gleam の標準ライブラリに無い、暗号用の乱数と単調に増える番号・時刻だけをここに置く。
-module(rondo_server_ffi).
-export([random_hex/1, unique_number/0, monotonic_ms/0, get_env/1,
         limit_self_heap/1, note_socket_killed/0, otp_major/0]).

-define(DROP_LOG_KEY, {rondo_server_ffi, socket_killed_log}).
%% 1分あたり、何回までログに残すか（それ以上は数えるだけで出さない）。
-define(DROP_LOG_WINDOW_MS, 60000).
-define(DROP_LOG_MAX, 5).

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

%% OTP のメジャー版（例: 27）。include_shared_binaries が使えるか（27 以降）の判定に使う。
%% 数字でない版（まれ）は 0 を返す。
otp_major() ->
    try list_to_integer(erlang:system_info(otp_release)) of
        N -> N
    catch
        _:_ -> 0
    end.

%% 環境変数を読む。無ければ {error, nil}（Gleam の Result(String, Nil)）。
%% サーバーの起動時の設定（ポート、テスト用のフェーズ時間の短縮）に使う（issue-49）。
get_env(Name) ->
    case os:getenv(binary_to_list(Name)) of
        false -> {error, nil};
        Value -> {ok, unicode:characters_to_binary(Value)}
    end.

%% いま動いているプロセス（ソケット1本のプロセス）の、使ってよいメモリの上限を Bytes に
%% する（issue-51）。超えたら、そのプロセスだけを落とす（kill => true）。極端に大きな電文で
%% 受信バッファが膨らんでも、他の接続とルームに波及させないための手当て。
%%
%% include_shared_binaries => true は、受信バッファ（共有の大きなバイナリ）を上限の計算に
%% 含めるために要る（OTP 27 以降）。古い OTP では、このキーで badarg になるので、含めずに
%% 設定し直す（その場合、共有バイナリは数えないので、コンテナのメモリ上限が最後の砦になる）。
%% どちらも失敗しても、接続は続ける（返り値は捨てる）。上限は語（word）数で指定する。
limit_self_heap(Bytes) ->
    Words = Bytes div erlang:system_info(wordsize),
    Full = #{size => Words, kill => true, error_logger => false,
             include_shared_binaries => true},
    try
        erlang:process_flag(max_heap_size, Full),
        nil
    catch
        error:badarg ->
            try
                erlang:process_flag(max_heap_size,
                    #{size => Words, kill => true, error_logger => false}),
                nil
            catch
                _:_ -> nil
            end;
        _:_ -> nil
    end.

%% ソケットの受信プロセスが、メモリの上限などで落ちたことを、ログに1行だけ残す（issue-51）。
%% 短時間に何度も出さないよう、1分あたり ?DROP_LOG_MAX 回までにする（それ以上は数えるだけ）。
%% ふだんの切断（normal）では呼ばない。呼び出し側（接続アクター）が、異常終了のときだけ呼ぶ。
note_socket_killed() ->
    Ref = drop_log_ref(),
    Now = erlang:monotonic_time(millisecond),
    Start = atomics:get(Ref, 1),
    case Now - Start >= ?DROP_LOG_WINDOW_MS of
        true ->
            atomics:put(Ref, 1, Now),
            atomics:put(Ref, 2, 1),
            logger:warning("rondo: ソケットの受信プロセスが落ちました（メモリ上限など）。再接続の猶予に入ります。"),
            nil;
        false ->
            N = atomics:add_get(Ref, 2, 1),
            case N =< ?DROP_LOG_MAX of
                true ->
                    logger:warning("rondo: ソケットの受信プロセスが落ちました（メモリ上限など）。再接続の猶予に入ります（直近1分で ~p 件目）。", [N]),
                    nil;
                false -> nil
            end
    end.

%% 1分窓のカウンタ（原子的配列）。最初の1回だけ作って、以後は使い回す。
drop_log_ref() ->
    case persistent_term:get(?DROP_LOG_KEY, undefined) of
        undefined ->
            Ref = atomics:new(2, [{signed, true}]),
            persistent_term:put(?DROP_LOG_KEY, Ref),
            Ref;
        Ref -> Ref
    end.
