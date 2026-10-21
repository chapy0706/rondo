%% 観戦ルームの長めの確認（rondo_server/spectate_soak / issue-67）だけが使う、測るための関数。
%% 本番の処理からは呼ばない。
-module(rondo_soak_ffi).
-export([process_count/0, memory_after_gc/1, total_memory/0]).

process_count() ->
    erlang:system_info(process_count).

%% ごみを集めてから、プロセスのメモリ（バイト）を測る。いなければ 0。
memory_after_gc(Pid) ->
    erlang:garbage_collect(Pid),
    case erlang:process_info(Pid, memory) of
        {memory, Bytes} -> Bytes;
        undefined -> 0
    end.

%% 全体のメモリ（バイト）。
total_memory() ->
    erlang:memory(total).
