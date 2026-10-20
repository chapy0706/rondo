%% 観戦ルームの結合テスト（issue-67）の補助。環境変数の付け外しと、プロセスの数・メモリの測定。
-module(rondo_spectate_test_ffi).
-export([put_env/2, unset_env/1, process_count/0, memory_of/1]).

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
