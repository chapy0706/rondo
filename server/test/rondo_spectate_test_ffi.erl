%% 観戦ルームのテスト（issue-67）の補助。環境変数の付け外しと、プロセスの数・メモリの測定と、
%% テストのプロセスだけの時計（プロセスの辞書。ゲームの箱を直接動かすテストで、時刻を差し替える）。
-module(rondo_spectate_test_ffi).
-export([put_env/2, unset_env/1, process_count/0, memory_of/1, set_clock/1, clock/0]).

put_env(Name, Value) ->
    os:putenv(unicode:characters_to_list(Name), unicode:characters_to_list(Value)),
    nil.

unset_env(Name) ->
    os:unsetenv(unicode:characters_to_list(Name)),
    nil.

process_count() ->
    erlang:system_info(process_count).

%% ごみを集めてから、プロセスのメモリ（バイト）を測る。いなければ 0。
memory_of(Pid) ->
    erlang:garbage_collect(Pid),
    case erlang:process_info(Pid, memory) of
        {memory, Bytes} -> Bytes;
        undefined -> 0
    end.

set_clock(Ms) ->
    erlang:put(rondo_spectate_test_clock, Ms),
    nil.

%% set_clock で置いた時刻（置いていなければ 0）。
clock() ->
    case erlang:get(rondo_spectate_test_clock) of
        undefined -> 0;
        Ms -> Ms
    end.
