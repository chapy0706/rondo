/// veryare の進行（ADR 0024）を表す純粋な状態機械。
///
/// フェーズは 鬼選出 → 準備移動 → ペイント → 探索 → 答え合わせ → 終了 の順に、タイマーの
/// 満了で進む。時刻と乱数は外から渡し（advance の step と pick）、ここはプロセスも時計も
/// 持たない。ルームへの載せ方は games/veryare/room.gleam が受け持つ。
///
/// 鬼選出のカウントダウン（10秒）は、鬼希望エリアへの最初の接触で始まる（ADR 0024）。
/// その時点で2人未満なら始めない。カウント中に触れた人は立候補者に加わり、カウント中の
/// 入退室は許す。満了時に2人未満なら不成立。鬼選出中だけは途中から入室できる。
/// 準備移動が終わった後（ペイント・探索）は、隠れ側は動けない。
/// 勝敗が決まると、不成立を除いて答え合わせタイム（20秒 / ADR 0033）を挟んでから終了する。
///
/// 「まだ隠れている」集合（still_hiding）は、接続中かつ未発見の隠れ側と定義する。
/// 発見（found）と、猶予を過ぎた切断（leave）は、どちらも remove_hider だけを通って
/// この集合から抜ける。個別の分岐を持たないので、結果の状態は完全に一致する。
/// 準備移動フェーズの終わりの被り判定（ADR 0026）で失格した隠れ側も、同じ remove_hider を通る。
///
/// ステージ（骨格と部屋の割り当て / ADR 0032、または固定ステージの平屋 / ADR 0039）は開始時に
/// 受け取って持つ（ground）。隠れ CPU の置き場所、玄関からのリスポーン、ステージでの移動の規則
/// （grid / issue-29a・ADR 0042）に使う。平屋は、見通しと CPU の一般化（issue-45）までは、
/// CPU を持たず（ルームの設定で拒む）、射撃は当たらない。
///
/// CPU（ADR 0038 / issue-33）は参加者の一種として players に入り、人数の判定・勝敗・
/// 「まだ隠れている」集合に人間と同じように入る。違いは3つだけ: 隠れ側 CPU は鬼の抽選の
/// 対象にならない。鬼 CPU がいれば抽選をせずにその CPU が鬼になる。隠れ側 CPU は準備移動の
/// 終わりに、被り判定の直前に位置・ポーズ・ペイントを確定させる（hider_cpu）。
///
/// 鬼 CPU（issue-34）は、探索の開始時に玄関から出て、0.5秒ごとの tick で歩いて探す
/// （oni_cpu）。見つけた隠れ側は、人間の鬼が当てたときと同じ found を通る。
///
/// 人間の鬼の射撃（issue-27 / ADR 0022）は shoot で受ける。判定はここ（サーバー）が行い、
/// 命中したら found を通る。勝敗の判定は増やさない。
///
/// 動ける隠れ側の規則（roaming / ADR 0053）: ルームの設定で選んだときだけ、まだ隠れている人間の
/// 隠れ側が、ペイントと探索の間も動け、見た目（ペイントとポーズ）を何度でも変えられる（間は
/// look_interval_ms）。探索の間は、鬼と隠れ側が襖の境から auto_door_reach 以内に入ると、その襖が
/// 開く（開けっぱなし）。開ける報告（open_door）は使わない。従来の規則（roaming が False）の動きは
/// 変えない。隠れ CPU は、どちらの規則でも動かない。
///
/// 増え鬼（spreading / ADR 0053 の最小版）: ルームの設定で選んだときだけ、見つかった人間の隠れ側が、
/// 見つかった場所で鬼になる（extra_oni。すぐ動け、撃てる。撃つ間隔は鬼ごと）。隠れ CPU は鬼にならない。
/// 勝敗は従来と同じ（隠れ側が 0 人で鬼の勝ち。時間切れで 1 人以上残れば隠れ側の勝ち）。最初の鬼（oni）は
/// これまでどおり 1 人で、フェーズの通知・鬼 CPU・見逃しポイントは最初の鬼を使う。途中から鬼になった人の
/// 離脱は、その人を鬼から外すだけ（最初の鬼の離脱は、従来どおり隠れ側の勝ち）。
import gleam/dict.{type Dict}
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/set.{type Set}
import rondo_server/games/veryare/grid.{type Edge, type Grid}
import rondo_server/games/veryare/hider_cpu.{type Placement, type Walk}
import rondo_server/games/veryare/hiraya
import rondo_server/games/veryare/missed
import rondo_server/games/veryare/oni_cpu.{type OniCpu, type Strength}
import rondo_server/games/veryare/overlap
import rondo_server/games/veryare/paint
import rondo_server/games/veryare/palette
import rondo_server/games/veryare/pose
import rondo_server/games/veryare/sight
import rondo_server/games/veryare/stage.{type Layout}

// --- 定数 ----------------------------------------------------------------

/// 鬼選出のカウントダウンの長さ（ミリ秒）。エリアへの最初の接触から数える。
pub const oni_selection_ms = 10_000

/// 準備移動フェーズの長さ（ミリ秒）。
pub const preparation_ms = 20_000

/// ペイントフェーズの長さ（ミリ秒）。
pub const painting_ms = 20_000

/// 答え合わせタイムの長さ（ミリ秒 / ADR 0033）。
pub const reveal_ms = 20_000

/// 鬼が撃つ間隔（ミリ秒 / issue-27・ADR 0022 のリロード）。
pub const reload_ms = 3000

/// 射撃の射程（メートル / issue-27）。調整できるよう定数にする。
pub const shot_range = 8.0

/// 襖を開けられる距離（メートル / issue-29b・ADR 0042）。襖の境からこの距離以内。骨格でも
/// 平屋でも同じ。
pub const door_reach = 1.5

/// 最小人数（鬼1 + 隠れ側1 / ADR 0030）。鬼選出のカウントダウンの開始と成立に使う。
pub const min_players = 2

/// 隠れ CPU の配置の種を引く範囲。
const cpu_seed_range = 2_147_483_647

/// 待機ルームの半径（メートル）。円柱形で、床は直径 7 m の円（ADR 0044。ADR 0024 の 2 m を
/// 置き換える）。5 人が輪に立っても、互いの全身が見える間が取れる。
pub const waiting_room_radius = 3.5

/// 移動の報告で受け付ける座標の上限（メートル。絶対値 / issue-51）。どのステージ（平屋・骨格）よりも
/// 十分に大きい。これを超える報告は無視する（極端な数で、円に丸める計算が桁あふれし、ルームが
/// 落ちるのを防ぐ）。
pub const max_coordinate = 1000.0

/// 鬼希望エリア（待機ルームと同心円）の半径（メートル）。
pub const oni_area_radius = 0.6

/// 待機ルームで並ぶ輪の半径。鬼希望エリアの外に置き、立候補は自分で入った人だけにする。
/// 席の間は約 2.35 m、席からエリアの縁と壁までは、それぞれ約 1.4 m・1.5 m（ADR 0044）。
const waiting_ring_radius = 2.0

/// 待機ルームの輪の席の数（定員と同じ5席）。途中で入室しても既にいる人を動かさない。
const waiting_ring_seats = 5

/// 同じ人の待機ポーズの変更をあける間（ミリ秒 / issue-59）。クライアントのボタンも同じ間だけ止める。
pub const waiting_pose_interval_ms = 300

/// メンバーの通知に載せる向きの刻み（ラジアン / issue-59）。これ未満の揺れでは送らない。
/// 動く隠れ側の通知（ADR 0053）も同じ刻みを使う。
const facing_step = 0.05

/// 動ける隠れ側の規則（ADR 0053）で、探索の間、鬼と隠れ側が近づくと襖が開く距離（メートル）。襖の
/// 境からこの距離以内。実際に遊んで調整する前提の値。
pub const auto_door_reach = 0.8

/// 動ける隠れ側の規則（ADR 0053）で、同じ人の見た目（ペイントとポーズ）の更新をあける間（ミリ秒）。
/// これより短い間の更新は捨てる。クライアントは、これより少し長い間で送る。
pub const look_interval_ms = 1000

// --- 型 ------------------------------------------------------------------

/// 勝敗。NotEnoughPlayers は鬼選出の時点で2人未満だったときの不成立。
pub type Outcome {
  OniWins
  HidersWin
  NotEnoughPlayers
}

/// フェーズ（ADR 0024 / 0033）。Reveal は答え合わせタイム、Ended は終了/観戦。
pub type Phase {
  OniSelection
  Preparation
  Painting
  Exploration
  Reveal(outcome: Outcome)
  Ended(outcome: Outcome)
}

/// 鬼希望エリアの見た目の状態（ADR 0024）。
pub type AreaState {
  /// 赤・「待機」。2人未満。触れても何も起きない。
  AreaWaiting
  /// 緑・「開始」。2人以上。触れるとカウントダウンが始まる。
  AreaReady
  /// 青・「鬼希望」。カウントダウン中。触れた人は立候補者になる。
  AreaCounting
}

/// プレイヤーがいる空間。待機ルームとステージは別の空間として扱う。
pub type Space {
  WaitingRoom
  Stage
}

/// 床の上の位置（x, z）。高さは持たない。
pub type Position {
  Position(space: Space, x: Float, z: Float)
}

/// 待機ルームのメンバー1人（issue-59 / ADR 0044）。メンバーの通知に載せる値で、位置は小数第 2 位、
/// 向きは 0.05 rad 単位に丸めてある（丸めた値で、変わったかを比べる）。pose は待機ポーズ。
pub type WaitingMember(id) {
  WaitingMember(
    player: id,
    x: Float,
    z: Float,
    facing: Option(Float),
    pose: Option(String),
  )
}

/// 動く隠れ側 1 人（ADR 0053）。動く隠れ側の通知に載せる値で、位置は小数第 2 位、向きは 0.05 rad
/// 単位に丸めてある（待機ルームのメンバーと同じ丸め。丸めた値で、変わったかを比べる）。増え鬼で途中から
/// 鬼になった人の位置と向き（extra_onis）にも、同じ形を使う。
pub type RoamingHider(id) {
  RoamingHider(player: id, x: Float, z: Float, facing: Option(Float))
}

/// 各フェーズの長さ（ミリ秒）。探索だけがルームごとの設定値。
pub type Durations {
  Durations(
    oni_selection_ms: Int,
    preparation_ms: Int,
    painting_ms: Int,
    exploration_ms: Int,
    reveal_ms: Int,
    /// 鬼が撃つ間隔（issue-27）。前の射撃からこれだけ空かないと、次の申告は無効。
    reload_ms: Int,
  )
}

/// ステージの種類と、その種類だけが持つデータ。
pub type Ground {
  /// ランダム間取り（ADR 0032）。layout は開始時に選ばれた骨格と部屋の割り当て、sight_map は
  /// 鬼 CPU と射撃が使う見通しの地図（layout から作っておく）。
  Skeleton(layout: Layout, sight_map: sight.Map)
  /// 固定ステージ「平屋」（ADR 0039 / issue-44）。データは hiraya.gleam。
  Hiraya
}

/// ルームに加わっている CPU。どちらも players に含まれる参加者の ID。
/// strength は鬼 CPU の強さ（鬼 CPU がいないときは使わない）。
pub type Cpus(id) {
  Cpus(hiders: List(id), oni: Option(id), strength: Strength)
}

pub type Game(id) {
  Game(
    phase: Phase,
    /// フェーズの通し番号。タイマーはこの値を持って戻り、古いタイマーを見分ける。
    step: Int,
    durations: Durations,
    /// 参加者（参加順）。鬼選出中の離脱だけがここから外す。
    players: List(id),
    /// 鬼。鬼選出が終わるまで None。鬼は1人固定。
    oni: Option(id),
    positions: Dict(id, Position),
    /// 向き（ラジアン。x 軸から z 軸の向きへ回る）。報告された人だけ持つ（観戦の配信に使う）。
    facings: Dict(id, Float),
    /// まだ隠れている隠れ側（接続中かつ未発見）。
    still_hiding: Set(id),
    /// 鬼選出のカウントダウン中か。エリアへの最初の接触で True になる。
    counting: Bool,
    /// 立候補者（カウント中にエリアへ触れた人）。触れた後はエリアを離れても残る。
    candidates: Set(id),
    /// 開始時に選ばれたステージ。
    ground: Ground,
    cpus: Cpus(id),
    /// 準備移動の終わりに確定した、隠れ CPU の状態。
    cpu_states: Dict(id, Placement),
    /// 隠れ CPU が、準備移動の間に、玄関から隠れ場所へ歩くか（観戦ルームだけ / issue-67）。False なら、
    /// これまでどおり準備移動の終わりに直接置く（人間の対戦）。
    walking_cpus: Bool,
    /// 歩く隠れ CPU の、隠れ場所と道（準備移動の始めに決める / issue-67）。walking_cpus のときだけ入る。
    cpu_walks: Dict(id, Walk),
    /// 探索中の鬼 CPU。鬼が CPU のときだけ、探索の開始時に作る。
    oni_cpu: Option(OniCpu),
    /// 直前の tick で鬼 CPU の視界に入っていた隠れ側（見逃しポイント / issue-32 で使う）。
    seen: List(id),
    /// 最後に受け付けた射撃の時刻（ミリ秒。呼び出し側の時計）。撃つ間隔の判定に使う。
    last_shot: Option(Int),
    /// 射撃の判定で見通し（壁・閉じた襖）を見るか。ステージの座標が統一された issue-29b から
    /// True。テストで、射程だけを確かめるときに False にできる。
    shot_sight: Bool,
    /// ステージを移動の規則の入力に写したもの（issue-29a / ADR 0042）。
    grid: Grid,
    /// 開いている襖（issue-29b / ADR 0042）。人間が開けた襖も、鬼 CPU が開けた襖も、ここだけが
    /// 持つ。準備移動の開始で全部開き、探索の開始で全部閉じ、答え合わせの開始で全部開く。
    open_doors: Set(Edge),
    /// 探索の開始の時点で、まだ隠れていた隠れ側（参加順）。探索の開始で入れ、以後は変えない。
    /// 入り直した人へ隠れ側の通知を送り直すため（issue-29d）だけに使い、勝敗の判定と
    /// フェーズの遷移の分岐には使わない。
    exploration_hiders: List(id),
    /// 人間の隠れ側が確定したペイント（issue-25）。ペイントフェーズの間に、まだ隠れている
    /// 隠れ側が送った最初の1回だけ。探索の開始の一括配信に載せ、鬼 CPU の溶け込み度に平均色を
    /// 使う（issue-54 / hider_color）。勝敗・被りの判定には使わない。
    paints: Dict(id, List(paint.Stroke)),
    /// 人間の隠れ側が確定したポーズ（issue-56。pose.gleam の一覧の識別子）。ペイントと同じ確定で、
    /// 同じ条件（最初の1回だけ）で受け付ける。一括配信に載せるためだけに使い、判定には使わない。
    poses: Dict(id, String),
    /// 待機ポーズ（issue-59 / ADR 0044。pose.gleam の一覧の識別子）。鬼選出の間だけ持つ、同期する
    /// 飾りの状態で、上の poses（隠れ側のポーズ）とは混ぜない。鬼選出が済んだら空にする。
    waiting_poses: Dict(id, String),
    /// 待機ポーズを最後に受け付けた時刻（ミリ秒。呼び出し側の時計）。変更の間をあけるのに使う。
    waiting_pose_at: Dict(id, Int),
    /// 最後に送ったメンバーの一覧（issue-59）。これと同じなら送らない。判定には使わない。
    members_sent: List(WaitingMember(id)),
    /// メンバーの通知を送るタイマーを張っているか（issue-59）。張っている間は重ねて張らない。
    members_scheduled: Bool,
    /// 見逃しポイント（issue-32 / ADR 0036）。探索中、0.5 秒ごとに、まだ隠れている隠れ側へ足す。
    /// 見つかった後は足さず、それまでのポイントは残す。勝敗には使わない。
    missed_points: Dict(id, Int),
    /// 見逃しポイントの計算のパラメータ（実際に遊んで調整する前提）。
    missed_params: missed.Params,
    /// 人間の鬼が最後に報告した、視界に入っている隠れ側（壁越しを除く / 鬼のクライアントの判定）。
    /// 報告のたびに置き換える。鬼 CPU のときは使わず、鬼 CPU の視界（seen）を使う。
    sighted: Set(id),
    /// いいね（issue-32）。隠れ側 → 送った人。1人が同じ隠れ側に送れるのは1回まで。勝敗には使わない。
    likes: Dict(id, Set(id)),
    /// 動ける隠れ側の規則か（ADR 0053。ルームの設定）。False なら従来の規則。
    roaming: Bool,
    /// 見た目の更新を最後に受け付けた時刻（ミリ秒。呼び出し側の時計 / ADR 0053）。間をあけるのに使う。
    look_at: Dict(id, Int),
    /// 最後に送った動く隠れ側の一覧（ADR 0053）。これと同じなら送らない。判定には使わない。
    roaming_sent: List(RoamingHider(id)),
    /// 動く隠れ側の通知を送るタイマーを張っているか（ADR 0053）。張っている間は重ねて張らない。
    roaming_scheduled: Bool,
    /// 増え鬼か（ADR 0053。ルームの設定）。False なら従来（見つかった人は観戦に回る）。
    spreading: Bool,
    /// 途中から鬼になった人（見つかった順 / 増え鬼）。従来の規則では、いつも空。
    extra_oni: List(id),
    /// 途中から鬼になった人の、最後に受け付けた射撃の時刻（ミリ秒）。最初の鬼は last_shot を使う。
    extra_shots: Dict(id, Int),
    /// 最後に送った、途中から鬼になった人の一覧（位置と向き / 増え鬼）。これと同じなら送らない。
    onis_sent: List(RoamingHider(id)),
    /// 途中から鬼になった人の通知を送るタイマーを張っているか（増え鬼）。
    onis_scheduled: Bool,
  )
}

// --- 生成 ----------------------------------------------------------------

/// 本番の長さ。探索フェーズだけを指定する。
pub fn durations(exploration_ms exploration_ms: Int) -> Durations {
  Durations(
    oni_selection_ms: oni_selection_ms,
    preparation_ms: preparation_ms,
    painting_ms: painting_ms,
    exploration_ms: exploration_ms,
    reveal_ms: reveal_ms,
    reload_ms: reload_ms,
  )
}

/// 鬼選出フェーズから始める。全員が待機ルームで、鬼希望エリアの外に並ぶ。
/// layout は開始時に選ばれたステージ（stage.generate）。
pub fn new(
  players: List(id),
  durations: Durations,
  layout: Layout,
) -> Game(id) {
  new_with(
    players,
    durations,
    layout,
    Cpus(hiders: [], oni: None, strength: oni_cpu.Normal),
  )
}

/// CPU を加えて始める。cpus の ID は players にも含めておく（参加者として数える）。
pub fn new_with(
  players: List(id),
  durations: Durations,
  layout: Layout,
  cpus: Cpus(id),
) -> Game(id) {
  start_on(
    players,
    durations,
    Skeleton(layout:, sight_map: sight.map_of(layout)),
    grid.of_layout(layout),
    cpus,
  )
}

/// 平屋（ADR 0039 / issue-44）で始める。issue-45 までは CPU を加えない。
pub fn new_hiraya(players: List(id), durations: Durations) -> Game(id) {
  start_on(
    players,
    durations,
    Hiraya,
    hiraya.grid(),
    Cpus(hiders: [], oni: None, strength: oni_cpu.Normal),
  )
}

fn start_on(
  players: List(id),
  durations: Durations,
  ground: Ground,
  grid: Grid,
  cpus: Cpus(id),
) -> Game(id) {
  Game(
    phase: OniSelection,
    step: 0,
    durations:,
    players:,
    oni: None,
    positions: waiting_seats(players),
    facings: dict.new(),
    still_hiding: set.new(),
    counting: False,
    candidates: set.new(),
    ground:,
    cpus:,
    cpu_states: dict.new(),
    walking_cpus: False,
    cpu_walks: dict.new(),
    grid:,
    open_doors: grid.fusuma(grid),
    oni_cpu: None,
    seen: [],
    last_shot: None,
    shot_sight: True,
    exploration_hiders: [],
    paints: dict.new(),
    poses: dict.new(),
    waiting_poses: dict.new(),
    waiting_pose_at: dict.new(),
    members_sent: [],
    members_scheduled: False,
    missed_points: dict.new(),
    missed_params: missed.default,
    sighted: set.new(),
    likes: dict.new(),
    roaming: False,
    look_at: dict.new(),
    roaming_sent: [],
    roaming_scheduled: False,
    spreading: False,
    extra_oni: [],
    extra_shots: dict.new(),
    onis_sent: [],
    onis_scheduled: False,
  )
}

/// 増え鬼にする（ADR 0053。ルームの設定で選んだときだけ）。鬼選出の前に呼ぶ。
pub fn with_spreading(game: Game(id)) -> Game(id) {
  Game(..game, spreading: True)
}

/// 鬼か（最初の鬼か、増え鬼で途中から鬼になった人）。
pub fn is_oni(game: Game(id), player: id) -> Bool {
  game.oni == Some(player) || list.contains(game.extra_oni, player)
}

/// 動ける隠れ側の規則にする（ADR 0053。ルームの設定で選んだときだけ）。鬼選出の前に呼ぶ。
pub fn with_roaming(game: Game(id)) -> Game(id) {
  Game(..game, roaming: True)
}

// --- 問い合わせ -----------------------------------------------------------

/// 今のフェーズの長さ（タイマーを張る時間）。鬼選出はカウント中だけ。終了後は None。
pub fn phase_duration(game: Game(id)) -> Option(Int) {
  case game.phase {
    OniSelection if game.counting -> Some(game.durations.oni_selection_ms)
    OniSelection -> None
    Preparation -> Some(game.durations.preparation_ms)
    Painting -> Some(game.durations.painting_ms)
    Exploration -> Some(game.durations.exploration_ms)
    Reveal(_) -> Some(game.durations.reveal_ms)
    Ended(_) -> None
  }
}

/// 鬼希望エリアの見た目の状態。
pub fn area_state(game: Game(id)) -> AreaState {
  case game.counting, list.length(game.players) >= min_players {
    True, _ -> AreaCounting
    False, True -> AreaReady
    False, False -> AreaWaiting
  }
}

/// まだ隠れている隠れ側の状態（参加順）。探索開始時の一括配信に使う（ADR 0025 / 0035）。
/// 隠れ CPU は確定した状態を持ち、人間はポーズ・ペイントがまだ無いので None（issue-25）。
pub fn hider_states(
  game: Game(id),
) -> List(#(id, Position, Option(Placement))) {
  game.players
  |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
  |> list.map(fn(id) {
    #(
      id,
      position_of(game, id),
      option.from_result(dict.get(game.cpu_states, id)),
    )
  })
}

/// ペイントの確定（issue-25 / ADR 0025）。ペイントフェーズの間に、まだ隠れている隠れ側が
/// 送った最初の1回だけを受け付ける。2回目以降・ほかのフェーズ・鬼のペイントは無視する。
/// 位置もフェーズも変えないので、被り判定（準備移動の終わり）にも勝敗にも関わらない。
pub fn paint(
  game: Game(id),
  player: id,
  strokes: List(paint.Stroke),
) -> Game(id) {
  confirm(game, player, Some(strokes), None)
}

/// ペイントとポーズの確定（issue-25 / issue-56）。ペイントフェーズの間に、まだ隠れている隠れ側が
/// 送った最初の1回だけを受け付ける（ペイントだけ・ポーズだけ・両方のどれでも1回）。両方 None は
/// 無視する。位置もフェーズも変えないので、被り判定にも勝敗にも関わらない。
pub fn confirm(
  game: Game(id),
  player: id,
  strokes: Option(List(paint.Stroke)),
  chosen: Option(String),
) -> Game(id) {
  let accepted =
    game.phase == Painting
    && set.contains(game.still_hiding, player)
    && !dict.has_key(game.paints, player)
    && !dict.has_key(game.poses, player)
    && { option.is_some(strokes) || option.is_some(chosen) }
  case accepted {
    False -> game
    True ->
      Game(
        ..game,
        paints: case strokes {
          Some(list) -> dict.insert(game.paints, player, list)
          None -> game.paints
        },
        poses: case chosen {
          Some(name) -> dict.insert(game.poses, player, name)
          None -> game.poses
        },
      )
  }
}

/// 隠れ側の見た目（ペイントとポーズ）の電文を受ける。従来の規則では confirm（最初の 1 回だけ）。
/// 動ける隠れ側の規則（ADR 0053）では、ペイントと探索の間に、まだ隠れている人間の隠れ側が送った
/// 更新を、何度でも受け付ける（同じ人の更新は look_interval_ms あける。now は呼び出し側の時計の
/// ミリ秒）。None の項目は前のまま残す。両方 None は無視する。
pub fn look(
  game: Game(id),
  player: id,
  strokes: Option(List(paint.Stroke)),
  chosen: Option(String),
  now: Int,
) -> Game(id) {
  case game.roaming {
    False -> confirm(game, player, strokes, chosen)
    True -> {
      let rested = case dict.get(game.look_at, player) {
        Ok(at) -> now - at >= look_interval_ms
        Error(Nil) -> True
      }
      let phase_ok = case game.phase {
        Painting | Exploration -> True
        _ -> False
      }
      let accepted =
        phase_ok
        && roaming_hider(game, player)
        && rested
        && { option.is_some(strokes) || option.is_some(chosen) }
      case accepted {
        False -> game
        True ->
          Game(
            ..game,
            paints: case strokes {
              Some(list) -> dict.insert(game.paints, player, list)
              None -> game.paints
            },
            poses: case chosen {
              Some(name) -> dict.insert(game.poses, player, name)
              None -> game.poses
            },
            look_at: dict.insert(game.look_at, player, now),
          )
      }
    }
  }
}

/// 確定したポーズ（issue-56）。確定していなければ None。
pub fn pose_of(game: Game(id), player: id) -> Option(String) {
  option.from_result(dict.get(game.poses, player))
}

/// 確定したペイント。送っていなければ None。
pub fn paint_of(game: Game(id), player: id) -> Option(List(paint.Stroke)) {
  option.from_result(dict.get(game.paints, player))
}

/// 探索の開始の時点の隠れ側の状態（hider_states と同じ形）。見つかった人も載る（issue-29d）。
pub fn exploration_hider_states(
  game: Game(id),
) -> List(#(id, Position, Option(Placement))) {
  game.exploration_hiders
  |> list.map(fn(id) {
    #(
      id,
      position_of(game, id),
      option.from_result(dict.get(game.cpu_states, id)),
    )
  })
}

/// 入室を受け付けるか。鬼選出中（カウント中を含む）だけ。
pub fn accepts_join(game: Game(id)) -> Bool {
  game.phase == OniSelection
}

/// 鬼選出中の入室。待機ルームの空いた席に立つ。それ以外のフェーズと二重の入室は無視する。
pub fn join(game: Game(id), player: id) -> Game(id) {
  case accepts_join(game), list.contains(game.players, player) {
    True, False -> {
      let seat = seat_position(list.length(game.players))
      Game(
        ..game,
        players: list.append(game.players, [player]),
        positions: dict.insert(game.positions, player, seat),
      )
    }
    _, _ -> game
  }
}

// --- 遷移 ----------------------------------------------------------------

/// タイマーの満了。step が今のフェーズと違えば（古いタイマー）何もしない。
/// pick は 0 以上 size 未満の位置を返す乱数（鬼選出で使う）。
pub fn advance(game: Game(id), step: Int, pick: fn(Int) -> Int) -> Game(id) {
  case step == game.step {
    False -> game
    True ->
      case game.phase {
        OniSelection if game.counting -> select_oni(game, pick)
        // カウント前にタイマーは張らないので、届いても何もしない。
        OniSelection -> game
        Preparation -> end_preparation(settle_cpus(game, pick))
        Painting -> start_exploration(game, pick)
        Exploration ->
          case set.is_empty(game.still_hiding) {
            True -> reveal(game, OniWins)
            False -> reveal(game, HidersWin)
          }
        Reveal(outcome) -> end(game, outcome)
        Ended(_) -> game
      }
  }
}

/// 移動の報告（クライアントが報告し、サーバーが制限する）。
/// 待機ルームは円に丸める。ステージは移動の規則（grid / ADR 0042）で、いまの位置から
/// 報告された位置へ動かし、通れない境の手前で止めて滑らせる。準備移動の後の隠れ側、
/// 答え合わせ・終了後は無視する。鬼選出中にエリアへ触れたら touch_area を通る。
/// 座標の絶対値が max_coordinate を超える報告も無視する（issue-51）。
pub fn move(game: Game(id), player: id, x: Float, z: Float) -> Game(id) {
  let reasonable =
    float.absolute_value(x) <=. max_coordinate
    && float.absolute_value(z) <=. max_coordinate
  case dict.get(game.positions, player), can_move(game, player), reasonable {
    Ok(current), True, True -> {
      let next = moved_to(game, current, x, z)
      let game =
        Game(..game, positions: dict.insert(game.positions, player, next))
        |> open_nearby_doors(next)
      case game.phase, in_oni_area(next) {
        OniSelection, True -> touch_area(game, player)
        _, _ -> game
      }
    }
    _, _, _ -> game
  }
}

/// その人のいまの位置（テストと確かめに使う）。
pub fn position_of_player(game: Game(id), player: id) -> Result(Position, Nil) {
  dict.get(game.positions, player)
}

/// 向きの報告。動ける間だけ受け付ける（観戦者へ送る鬼の向きに使う / issue-28）。
/// 向きは -π〜π に巻き取ってから持つ（鬼の通知とメンバーの通知の両方に効く / issue-59）。
pub fn turn(game: Game(id), player: id, facing: Float) -> Game(id) {
  case can_move(game, player) {
    True ->
      Game(
        ..game,
        facings: dict.insert(game.facings, player, wrap_angle(facing)),
      )
    False -> game
  }
}

/// 角度を (-π, π] に巻き取る（issue-59）。範囲内の値はそのまま返す。極端に大きな値でも、剰余
/// （fmod）で求めるので、桁落ちせずに範囲に収まる。
pub fn wrap_angle(angle: Float) -> Float {
  case angle >. 0.0 -. pi && angle <=. pi {
    True -> angle
    False -> {
      let turned = fmod(angle, 2.0 *. pi)
      case turned >. pi, turned <=. 0.0 -. pi {
        True, _ -> turned -. 2.0 *. pi
        _, True -> turned +. 2.0 *. pi
        _, _ -> turned
      }
    }
  }
}

@external(erlang, "math", "fmod")
fn fmod(x: Float, y: Float) -> Float

// --- 待機ルームのメンバー（issue-59 / ADR 0044） ----------------------------------------

/// 待機ポーズの変更。鬼選出の間だけ、人間の参加者の、一覧（pose.gleam）の識別子だけを受け付ける。
/// 同じ人の変更は waiting_pose_interval_ms あける（now は呼び出し側の時計のミリ秒）。
pub fn set_waiting_pose(
  game: Game(id),
  player: id,
  value: String,
  now: Int,
) -> Game(id) {
  let rested = case dict.get(game.waiting_pose_at, player) {
    Ok(at) -> now - at >= waiting_pose_interval_ms
    Error(Nil) -> True
  }
  case game.phase, is_waiting_human(game, player), pose.parse(value), rested {
    OniSelection, True, Some(chosen), True ->
      Game(
        ..game,
        waiting_poses: dict.insert(game.waiting_poses, player, chosen),
        waiting_pose_at: dict.insert(game.waiting_pose_at, player, now),
      )
    _, _, _, _ -> game
  }
}

/// 待機ルームのメンバー（参加順）。鬼選出の間だけ、待機ルームにいる人間の参加者を載せる。CPU と
/// ステージの位置は載せない。位置は小数第 2 位、向きは 0.05 rad 単位に丸める。
pub fn waiting_members(game: Game(id)) -> List(WaitingMember(id)) {
  case game.phase {
    OniSelection ->
      list.filter_map(game.players, fn(id) {
        case is_waiting_human(game, id), dict.get(game.positions, id) {
          True, Ok(Position(WaitingRoom, x, z)) ->
            Ok(WaitingMember(
              player: id,
              x: round_to(x, 0.01),
              z: round_to(z, 0.01),
              facing: dict.get(game.facings, id)
                |> option.from_result
                |> option.map(round_to(_, facing_step)),
              pose: dict.get(game.waiting_poses, id) |> option.from_result,
            ))
          _, _ -> Error(Nil)
        }
      })
    _ -> []
  }
}

/// メンバーの通知を送ったことを控える（同じ内容を、次から送らない）。
pub fn members_were_sent(
  game: Game(id),
  members: List(WaitingMember(id)),
) -> Game(id) {
  Game(..game, members_sent: members, members_scheduled: False)
}

/// メンバーの通知のタイマーを張ったか・外れたかを控える。
pub fn members_scheduled(game: Game(id), scheduled: Bool) -> Game(id) {
  Game(..game, members_scheduled: scheduled)
}

// --- 動く隠れ側（ADR 0053） ---------------------------------------------------------

/// 動く隠れ側（参加順）。動ける隠れ側の規則の探索の間だけ、まだ隠れている人間の隠れ側を載せる。
/// 隠れ CPU は載せない（動かない。探索の開始の一括配信で届いている）。位置は小数第 2 位、向きは
/// 0.05 rad 単位に丸める。ペイントの間は載せない（互いの隠れ場所を見せない / ADR 0025・0026）。
pub fn roaming_hiders(game: Game(id)) -> List(RoamingHider(id)) {
  case game.roaming, game.phase {
    True, Exploration ->
      list.filter_map(game.players, fn(id) {
        case roaming_hider(game, id), dict.get(game.positions, id) {
          True, Ok(Position(Stage, x, z)) ->
            Ok(RoamingHider(
              player: id,
              x: round_to(x, 0.01),
              z: round_to(z, 0.01),
              facing: dict.get(game.facings, id)
                |> option.from_result
                |> option.map(round_to(_, facing_step)),
            ))
          _, _ -> Error(Nil)
        }
      })
    _, _ -> []
  }
}

/// 途中から鬼になった人（見つかった順 / 増え鬼）。探索・答え合わせの間、いまの位置と向き（丸めは、動く
/// 隠れ側と同じ）。従来の規則では、いつも空。
pub fn extra_onis(game: Game(id)) -> List(RoamingHider(id)) {
  case game.phase {
    Exploration | Reveal(_) ->
      list.filter_map(game.extra_oni, fn(id) {
        case dict.get(game.positions, id) {
          Ok(Position(Stage, x, z)) ->
            Ok(RoamingHider(
              player: id,
              x: round_to(x, 0.01),
              z: round_to(z, 0.01),
              facing: dict.get(game.facings, id)
                |> option.from_result
                |> option.map(round_to(_, facing_step)),
            ))
          _ -> Error(Nil)
        }
      })
    _ -> []
  }
}

/// 途中から鬼になった人の通知を送ったことを控える。
pub fn onis_were_sent(
  game: Game(id),
  onis: List(RoamingHider(id)),
) -> Game(id) {
  Game(..game, onis_sent: onis, onis_scheduled: False)
}

/// 途中から鬼になった人の通知のタイマーを張ったか・外れたかを控える。
pub fn onis_scheduled(game: Game(id), scheduled: Bool) -> Game(id) {
  Game(..game, onis_scheduled: scheduled)
}

/// 動く隠れ側の通知を送ったことを控える（同じ内容を、次から送らない）。
pub fn roaming_were_sent(
  game: Game(id),
  hiders: List(RoamingHider(id)),
) -> Game(id) {
  Game(..game, roaming_sent: hiders, roaming_scheduled: False)
}

/// 動く隠れ側の通知のタイマーを張ったか・外れたかを控える。
pub fn roaming_scheduled(game: Game(id), scheduled: Bool) -> Game(id) {
  Game(..game, roaming_scheduled: scheduled)
}

fn is_waiting_human(game: Game(id), player: id) -> Bool {
  list.contains(game.players, player)
  && !list.contains(game.cpus.hiders, player)
  && game.cpus.oni != Some(player)
}

/// step の刻みに丸め、小数第 2 位にそろえる（刻みを掛けた後の、浮動小数の端数を落とす）。
fn round_to(value: Float, step: Float) -> Float {
  let stepped = int.to_float(float.round(value /. step)) *. step
  int.to_float(float.round(stepped *. 100.0)) /. 100.0
}

// --- 見逃しポイントといいね（issue-32 / ADR 0036） ------------------------------------------

/// 見逃しポイントを足す間隔（ミリ秒）。
pub const missed_tick_ms = 500

/// 人間の鬼の視界の報告。探索中の鬼だけが送れ、まだ隠れている人だけを残して、前の報告と置き換える。
/// 鬼が CPU のときは無視する（鬼 CPU の視界を使う）。
pub fn report_sight(game: Game(id), player: id, ids: List(id)) -> Game(id) {
  case game.phase, game.oni, game.oni_cpu {
    Exploration, Some(oni), None if oni == player ->
      Game(
        ..game,
        sighted: ids
          |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
          |> set.from_list,
      )
    _, _, _ -> game
  }
}

/// 0.5 秒ぶんの見逃しポイントを、まだ隠れている隠れ側へ足す。距離は鬼の位置から測り、視界は人間の
/// 鬼なら最後の報告、鬼 CPU なら鬼 CPU の視界。探索中でなければ何もしない。
pub fn award_missed(game: Game(id)) -> Game(id) {
  case game.phase, game.oni {
    Exploration, Some(oni) ->
      case dict.get(game.positions, oni) {
        Ok(Position(Stage, ox, oz)) -> {
          let in_sight = case game.oni_cpu {
            Some(_) -> set.from_list(game.seen)
            None -> game.sighted
          }
          let points =
            game.players
            |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
            |> list.fold(game.missed_points, fn(points, id) {
              case dict.get(game.positions, id) {
                Ok(Position(Stage, x, z)) -> {
                  let distance =
                    sqrt(
                      { x -. ox } *. { x -. ox } +. { z -. oz } *. { z -. oz },
                    )
                  let gained =
                    missed.award(
                      game.missed_params,
                      distance,
                      set.contains(in_sight, id),
                    )
                  case gained > 0 {
                    True ->
                      dict.insert(
                        points,
                        id,
                        missed_points_of(game, id) + gained,
                      )
                    False -> points
                  }
                }
                _ -> points
              }
            })
          Game(..game, missed_points: points)
        }
        _ -> game
      }
    _, _ -> game
  }
}

/// その人の見逃しポイント（無ければ 0）。
pub fn missed_points_of(game: Game(id), player: id) -> Int {
  dict.get(game.missed_points, player) |> result_or(0)
}

/// いいね。答え合わせの間、人間の参加者が、探索の開始の時点で隠れていた隠れ側へ送れる。自分には
/// 送れず、同じ隠れ側へは1回まで。
pub fn like(game: Game(id), sender: id, target: id) -> Game(id) {
  let senders = dict.get(game.likes, target) |> result_or(set.new())
  case
    game.phase,
    is_waiting_human(game, sender),
    list.contains(game.exploration_hiders, target),
    sender != target && !set.contains(senders, sender)
  {
    Reveal(_), True, True, True ->
      Game(
        ..game,
        likes: dict.insert(game.likes, target, set.insert(senders, sender)),
      )
    _, _, _, _ -> game
  }
}

/// その隠れ側が受け取ったいいねの数。
pub fn likes_of(game: Game(id), target: id) -> Int {
  dict.get(game.likes, target) |> result_or(set.new()) |> set.size
}

fn result_or(value: Result(a, Nil), default: a) -> a {
  case value {
    Ok(inner) -> inner
    Error(Nil) -> default
  }
}

/// 発見。探索フェーズ中の、まだ隠れている隠れ側だけが対象。増え鬼では、見つかった人間の隠れ側が、
/// 見つかった場所で鬼になる（隠れ CPU は鬼にならない）。最後の 1 人でも鬼になる（結果で鬼の側に並ぶ）。
pub fn found(game: Game(id), player: id) -> Game(id) {
  case game.phase, set.contains(game.still_hiding, player) {
    Exploration, True -> {
      let converted = case
        game.spreading && !list.contains(game.cpus.hiders, player)
      {
        True -> Game(..game, extra_oni: list.append(game.extra_oni, [player]))
        False -> game
      }
      remove_hider(converted, player)
    }
    _, _ -> game
  }
}

/// 人間の鬼の射撃の申告（issue-27 / ADR 0022）。now_ms は受け取った時刻（呼び出し側の時計）。
/// 探索フェーズの鬼の申告だけを受け付ける。前の射撃から reload_ms 空いていなければ、申告ごと
/// 無視する（間隔も始め直さない / ADR 0014 の受信順の延長）。受け付けたら、当たり外れに
/// 関わらず、その時刻から次の間隔が始まる。命中なら found（発見）を通る。
pub fn shoot(
  game: Game(id),
  shooter: id,
  target: Option(id),
  now_ms: Int,
) -> Game(id) {
  case game.phase, is_oni(game, shooter), reloaded(game, shooter, now_ms) {
    Exploration, True, True -> {
      let game = shot_at(game, shooter, now_ms)
      case target {
        Some(id) ->
          case hits(game, shooter, id) {
            True -> found(game, id)
            False -> game
          }
        None -> game
      }
    }
    _, _, _ -> game
  }
}

/// 射撃の見通し。壁と閉じた襖が遮り、open（開いている襖）は通す（issue-29b）。
pub fn shot_line_clear(
  map: sight.Map,
  open: Set(stage.Door),
  from: #(Float, Float),
  to: #(Float, Float),
) -> Bool {
  sight.line_of_sight(map, open, from, to)
}

/// 開いている襖を、見通しの判定（sight）と鬼 CPU が使う形（廊下側のマスと部屋側のマス）に
/// 直す。どちらが廊下側かは、見通しの地図の領域で決める。
/// 平屋は見通しの地図を持たない（issue-45）ので、辺の a を廊下側として写す。
pub fn sight_doors(game: Game(id)) -> Set(stage.Door) {
  game.open_doors
  |> set.map(fn(edge) {
    let region = case game.ground {
      Skeleton(sight_map:, ..) -> sight.region_at(sight_map, edge.a)
      Hiraya -> Ok(sight.Open)
    }
    case region {
      Ok(sight.Open) -> stage.Door(corridor: edge.a, slot: edge.b)
      _ -> stage.Door(corridor: edge.b, slot: edge.a)
    }
  })
}

/// 襖を開ける報告（issue-29b）。準備移動・ペイント・探索の間に、ステージにいる人が、
/// 襖（戸の一覧の開閉できる戸）の境から door_reach 以内にいるときだけ開く。開くのは、その辺が
/// 属する襖の組の辺すべて（平屋の襖は辺 6〜12 本で1組 / issue-44。骨格の襖は辺1本）。開けた襖は
/// 開けっぱなし。条件に合わなければ何もしない。
pub fn open_door(game: Game(id), player: id, edge: Edge) -> Game(id) {
  let phase_ok = case game.phase {
    Preparation | Painting | Exploration -> True
    _ -> False
  }
  let near = case dict.get(game.positions, player) {
    Ok(Position(Stage, x, z)) ->
      grid.distance_to_edge(game.grid, edge, #(x, z)) <=. door_reach
    _ -> False
  }
  // 動ける隠れ側の規則では、襖は近づくと開く（open_nearby_doors）。開ける報告は使わない。
  case
    !game.roaming
    && phase_ok
    && near
    && set.contains(grid.fusuma(game.grid), edge)
  {
    True ->
      Game(
        ..game,
        open_doors: set.union(game.open_doors, grid.door_group(game.grid, edge)),
      )
    False -> game
  }
}

/// 撃つ間隔が明けたか。間隔は鬼ごと（最初の鬼は last_shot、途中から鬼になった人は extra_shots）。
fn reloaded(game: Game(id), shooter: id, now_ms: Int) -> Bool {
  let last = case game.oni == Some(shooter) {
    True -> game.last_shot
    False -> option.from_result(dict.get(game.extra_shots, shooter))
  }
  case last {
    None -> True
    Some(last) -> now_ms - last >= game.durations.reload_ms
  }
}

/// 射撃を受け付けた時刻を、その鬼の間隔として控える。
fn shot_at(game: Game(id), shooter: id, now_ms: Int) -> Game(id) {
  case game.oni == Some(shooter) {
    True -> Game(..game, last_shot: Some(now_ms))
    False ->
      Game(..game, extra_shots: dict.insert(game.extra_shots, shooter, now_ms))
  }
}

/// 命中か。狙った相手がまだ隠れていて、2人ともステージにいて、射程の内側で、（有効なら）
/// 見通しが通ること。
fn hits(game: Game(id), oni: id, target: id) -> Bool {
  case
    set.contains(game.still_hiding, target),
    dict.get(game.positions, oni),
    dict.get(game.positions, target)
  {
    True, Ok(Position(Stage, ox, oz)), Ok(Position(Stage, tx, tz)) -> {
      let dx = tx -. ox
      let dz = tz -. oz
      let in_range = dx *. dx +. dz *. dz <=. shot_range *. shot_range
      in_range
      && {
        !game.shot_sight
        || case game.ground {
          Skeleton(sight_map:, ..) ->
            shot_line_clear(sight_map, sight_doors(game), #(ox, oz), #(tx, tz))
          // 平屋は、戸の一覧（3種類の戸、0.3 m のマス）に対する見通し（issue-45）。移動の規則と
          // 同じ辺の通れる・通れないで判定する。
          Hiraya ->
            grid.line_clear(game.grid, game.open_doors, #(ox, oz), #(tx, tz))
        }
      }
    }
    _, _, _ -> False
  }
}

/// 離脱の確定（再接続猶予を過ぎた切断 / ADR 0013）。
/// 鬼の離脱は即座に隠れ側の勝利。隠れ側の離脱は発見と同じ remove_hider を通る。
/// 鬼選出中は参加者・立候補者から外すだけで、カウントは止めない（ADR 0024）。
/// 答え合わせ・終了後は勝敗が決まっているので何もしない。
pub fn leave(game: Game(id), player: id) -> Game(id) {
  case game.phase, game.oni {
    Ended(_), _ | Reveal(_), _ -> game
    OniSelection, _ ->
      Game(
        ..game,
        players: list.filter(game.players, fn(id) { id != player }),
        positions: dict.delete(game.positions, player),
        candidates: set.delete(game.candidates, player),
        waiting_poses: dict.delete(game.waiting_poses, player),
        waiting_pose_at: dict.delete(game.waiting_pose_at, player),
      )
    _, Some(oni) if oni == player -> reveal(game, HidersWin)
    _, _ ->
      case list.contains(game.extra_oni, player) {
        // 増え鬼で途中から鬼になった人の離脱は、鬼から外すだけ（隠れ側の数は変わらない）。
        True ->
          Game(
            ..game,
            extra_oni: list.filter(game.extra_oni, fn(id) { id != player }),
          )
        False -> remove_hider(game, player)
      }
  }
}

// --- 内部 ----------------------------------------------------------------

/// 「まだ隠れている」集合から外す。発見・切断・被りによる失格の唯一の合流点。
/// 集合が0人になった時点で鬼の勝利とし、答え合わせへ進む。
fn remove_hider(game: Game(id), player: id) -> Game(id) {
  let still_hiding = set.delete(game.still_hiding, player)
  let game = Game(..game, still_hiding:)
  case set.is_empty(still_hiding) {
    True -> reveal(game, OniWins)
    False -> game
  }
}

/// 鬼希望エリアに触れた。カウント中なら立候補者に加える。カウント前で2人以上なら、
/// 触れた本人を立候補者にしてカウントダウンを始める（step を進めてタイマーを張らせる）。
/// 2人未満なら何もしない。
fn touch_area(game: Game(id), player: id) -> Game(id) {
  case area_state(game) {
    AreaCounting ->
      Game(..game, candidates: set.insert(game.candidates, player))
    AreaReady ->
      Game(
        ..game,
        counting: True,
        candidates: set.from_list([player]),
        step: game.step + 1,
      )
    AreaWaiting -> game
  }
}

/// 立候補者（残っている人）がいればその中から、いなければ全員から、鬼を1人選ぶ。
/// 隠れ側はステージへ移り、鬼は待機ルームに残る。2人未満なら不成立。
/// 鬼 CPU がいれば、抽選をせずにその CPU を鬼にする。隠れ側 CPU は抽選の対象にしない。
fn select_oni(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  let humans =
    list.filter(game.players, fn(id) { !list.contains(game.cpus.hiders, id) })
  let pool = case
    list.filter(humans, fn(id) { set.contains(game.candidates, id) })
  {
    [] -> humans
    some -> some
  }
  let chosen = case game.cpus.oni {
    Some(cpu) ->
      case list.contains(game.players, cpu) {
        True -> Ok(cpu)
        False -> nth(pool, pick(list.length(pool)))
      }
    None -> nth(pool, pick(list.length(pool)))
  }
  case list.length(game.players) < min_players, chosen {
    False, Ok(oni) -> {
      let hiders = list.filter(game.players, fn(id) { id != oni })
      // 隠れ側は全員、玄関に現れる（ADR 0032）。重ならないよう動くのは本人たち。
      let positions =
        hiders
        |> list.map(fn(id) { #(id, spawn_position(game)) })
        |> dict.from_list
        |> dict.insert(oni, position_of(game, oni))
      Game(
        ..next(game, Preparation),
        oni: Some(oni),
        positions:,
        still_hiding: set.from_list(hiders),
        counting: False,
      )
      |> plan_cpu_walks(pick)
    }
    // 不成立は答え合わせを挟まずに終了する。
    _, _ -> end(game, NotEnoughPlayers)
  }
}

/// 準備移動の終わり。全員の座標が確定したこの瞬間に被りを判定し、球が重なっていた
/// 隠れ側を失格にしてからペイントへ進む。失格で誰もいなくなれば、その時点で鬼の勝利。
fn end_preparation(game: Game(id)) -> Game(id) {
  let hiders =
    game.still_hiding
    |> set.to_list
    |> list.filter_map(fn(id) {
      case dict.get(game.positions, id) {
        Ok(Position(Stage, x, z)) -> Ok(#(id, x, z))
        _ -> Error(Nil)
      }
    })
  let judged =
    overlap.overlapping(hiders)
    |> set.to_list
    |> list.fold(game, remove_hider)
  case judged.phase {
    Preparation -> next(judged, Painting)
    _ -> judged
  }
}

/// 鬼選出を飛ばして、いま鬼を決め、準備移動から始める（観戦ルーム / issue-67。参加者は CPU だけで、
/// 鬼希望エリアに触れる人がいない）。鬼の決め方は、カウントの満了と同じ（鬼 CPU がいれば、その CPU）。
pub fn begin_without_selection(
  game: Game(id),
  pick: fn(Int) -> Int,
) -> Game(id) {
  case game.phase {
    OniSelection -> select_oni(Game(..game, counting: True), pick)
    _ -> game
  }
}

/// step を、前の試合の続きの番号から始める（観戦ルームの次の試合 / issue-67）。タイマーの token は
/// どれも step から作るので、前の試合のタイマーは、次の試合のどの step とも一致しない。
pub fn continue_from(game: Game(id), step: Int) -> Game(id) {
  Game(..game, step:)
}

/// 隠れ CPU を、準備移動の間に歩かせる（観戦ルーム / issue-67）。walking_cpus のときだけ、準備移動の
/// 始めに、隠れ場所と玄関からの道を決める（準備移動の時間の内に、被らずに着く場所 / hider_cpu.plan_walks）。
pub fn with_walking_cpus(game: Game(id)) -> Game(id) {
  Game(..game, walking_cpus: True)
}

/// 歩く隠れ CPU の、隠れ場所と道。歩かない CPU・CPU でない人は Error。
pub fn cpu_walk(game: Game(id), id: id) -> Result(Walk, Nil) {
  dict.get(game.cpu_walks, id)
}

fn plan_cpu_walks(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  let cpus =
    list.filter(game.cpus.hiders, fn(id) { set.contains(game.still_hiding, id) })
  case game.walking_cpus, cpus, game.ground {
    True, [_, ..], Skeleton(layout:, ..) -> {
      let walks =
        hider_cpu.plan_walks(
          layout,
          list.length(cpus),
          pick(cpu_seed_range),
          hider_cpu.reach_ms(game.durations.preparation_ms),
        )
      Game(..game, cpu_walks: dict.from_list(list.zip(cpus, walks)))
    }
    _, _, _ -> game
  }
}

/// 準備移動の終わりに、まだ隠れている隠れ CPU の位置・ポーズ・ペイントを確定させる。
/// 人間の隠れ側の今の位置とも、CPU どうしとも被らないマスに置く（被り判定の直前）。
/// 歩いた CPU（観戦ルーム / issue-67）は、準備移動の始めに決めた隠れ場所に置く。
fn settle_cpus(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  case dict.is_empty(game.cpu_walks) {
    False -> settle_walked_cpus(game)
    True -> place_cpus(game, pick)
  }
}

fn settle_walked_cpus(game: Game(id)) -> Game(id) {
  game.cpu_walks
  |> dict.to_list
  |> list.filter(fn(pair) { set.contains(game.still_hiding, pair.0) })
  |> list.fold(game, fn(game, pair) {
    let #(id, walk) = pair
    let p = walk.placement
    Game(
      ..game,
      positions: dict.insert(game.positions, id, Position(Stage, p.x, p.z)),
      cpu_states: dict.insert(game.cpu_states, id, p),
    )
  })
}

fn place_cpus(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  let #(cpus, humans) =
    game.players
    |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
    |> list.partition(fn(id) { list.contains(game.cpus.hiders, id) })
  case cpus, game.ground {
    [], _ | _, Hiraya -> game
    _, Skeleton(layout:, ..) -> {
      let occupied =
        list.filter_map(humans, fn(id) {
          case dict.get(game.positions, id) {
            Ok(Position(Stage, x, z)) -> Ok(#(x, z))
            _ -> Error(Nil)
          }
        })
      let placed =
        hider_cpu.place(
          layout,
          occupied,
          list.length(cpus),
          pick(cpu_seed_range),
        )
      list.zip(cpus, placed)
      |> list.fold(game, fn(game, pair) {
        let #(id, p) = pair
        Game(
          ..game,
          positions: dict.insert(game.positions, id, Position(Stage, p.x, p.z)),
          cpu_states: dict.insert(game.cpu_states, id, p),
        )
      })
    }
  }
}

/// 鬼が待機ルームからステージへ移り、探索を始める。鬼 CPU は玄関から出る。
fn start_exploration(game: Game(id), pick: fn(Int) -> Int) -> Game(id) {
  case game.oni, game.cpus.oni, game.ground {
    Some(oni), Some(cpu), Skeleton(layout:, ..) if oni == cpu -> {
      let walker =
        oni_cpu.start(layout, game.cpus.strength, pick(cpu_seed_range))
      let #(x, z) = walker.position
      Game(
        ..next(game, Exploration),
        positions: dict.insert(game.positions, oni, Position(Stage, x, z)),
        oni_cpu: Some(walker),
      )
    }
    Some(oni), _, _ ->
      Game(
        ..next(game, Exploration),
        positions: dict.insert(game.positions, oni, spawn_position(game)),
      )
    None, _, _ -> next(game, Exploration)
  }
}

/// 探索中に鬼 CPU が動いているか（0.5秒ごとの tick が要るか）。
pub fn oni_cpu_active(game: Game(id)) -> Bool {
  game.phase == Exploration && option.is_some(game.oni_cpu)
}

/// 鬼 CPU が溶け込み度に使う、隠れ側の色。CPU の隠れ側は置き方の色、人間の隠れ側は確定した
/// ペイントの平均色（issue-54 / paint.average_color）、塗っていなければ塗っていない体の色。
pub fn hider_color(game: Game(id), id: id) -> palette.Rgb {
  case dict.get(game.cpu_states, id), dict.get(game.paints, id) {
    Ok(placement), _ -> placement.color
    Error(Nil), Ok(strokes) -> paint.average_color(strokes)
    Error(Nil), Error(Nil) -> palette.unpainted
  }
}

/// 鬼 CPU の 0.5秒ぶん。歩いて、視界に入った隠れ側に発見の乱数を引く。見つけた隠れ側は
/// found（人間の鬼が当てたときと同じ処理）で抜ける。探索中でなければ何もしない。
pub fn tick(game: Game(id)) -> Game(id) {
  case game.phase, game.oni_cpu, game.oni, game.ground {
    Exploration, Some(walker), Some(oni), Skeleton(layout:, sight_map:) -> {
      let hiders =
        game.players
        |> list.filter(fn(id) { set.contains(game.still_hiding, id) })
        |> list.filter_map(fn(id) {
          case dict.get(game.positions, id) {
            Ok(Position(Stage, x, z)) ->
              Ok(oni_cpu.Hider(id:, x:, z:, color: hider_color(game, id)))
            _ -> Error(Nil)
          }
        })
      // 鬼 CPU は、ゲームの襖の状態を見て歩き、開けた襖をゲームの状態へ返す（issue-29b）。
      let walker = oni_cpu.OniCpu(..walker, open_doors: sight_doors(game))
      let #(walker, found_ids, seen) =
        oni_cpu.step(walker, sight_map, layout, hiders)
      let #(x, z) = walker.position
      let opened =
        walker.open_doors
        |> set.map(fn(door) { grid.edge(door.corridor, door.slot) })
      let moved =
        Game(
          ..game,
          oni_cpu: Some(walker),
          seen:,
          positions: dict.insert(game.positions, oni, Position(Stage, x, z)),
          open_doors: set.union(game.open_doors, opened),
        )
        |> open_nearby_doors(Position(Stage, x, z))
      list.fold(found_ids, moved, found)
    }
    _, _, _, _ -> game
  }
}

/// 動けるか。準備移動の後（ペイント・探索）は鬼だけ（動ける隠れ側の規則では、まだ隠れている人間の
/// 隠れ側も）。答え合わせ・終了後は誰も動けない。
fn can_move(game: Game(id), player: id) -> Bool {
  case game.phase {
    Ended(_) | Reveal(_) -> False
    Painting | Exploration ->
      is_oni(game, player) || roaming_hider(game, player)
    OniSelection | Preparation -> True
  }
}

/// 動ける隠れ側の規則（ADR 0053）で、動けて見た目を変えられる隠れ側か。まだ隠れている人間だけ
/// （隠れ CPU は動かない）。
fn roaming_hider(game: Game(id), player: id) -> Bool {
  game.roaming
  && set.contains(game.still_hiding, player)
  && !list.contains(game.cpus.hiders, player)
}

/// 動ける隠れ側の規則（ADR 0053）の探索の間、position から auto_door_reach 以内にある閉じた襖を
/// 開ける（組の辺すべて。開けっぱなし）。従来の規則・ほかのフェーズ・待機ルームでは何もしない。
fn open_nearby_doors(game: Game(id), position: Position) -> Game(id) {
  case game.roaming, game.phase, position {
    True, Exploration, Position(Stage, x, z) -> {
      let opened =
        grid.fusuma(game.grid)
        |> set.filter(fn(edge) {
          !set.contains(game.open_doors, edge)
          && grid.distance_to_edge(game.grid, edge, #(x, z)) <=. auto_door_reach
        })
        |> set.fold(game.open_doors, fn(open, edge) {
          set.union(open, grid.door_group(game.grid, edge))
        })
      Game(..game, open_doors: opened)
    }
    _, _, _ -> game
  }
}

fn in_oni_area(position: Position) -> Bool {
  case position {
    Position(WaitingRoom, x, z) ->
      x *. x +. z *. z <=. oni_area_radius *. oni_area_radius
    _ -> False
  }
}

/// 報告された位置へ動かした結果。待機ルームは半径 waiting_room_radius の円に丸め、ステージは
/// 移動の規則で、いまの位置から動かす。
fn moved_to(game: Game(id), current: Position, x: Float, z: Float) -> Position {
  case current.space {
    WaitingRoom -> {
      let distance = sqrt(x *. x +. z *. z)
      case distance >. waiting_room_radius {
        True -> {
          let scale = waiting_room_radius /. distance
          Position(WaitingRoom, x *. scale, z *. scale)
        }
        False -> Position(WaitingRoom, x, z)
      }
    }
    Stage -> {
      let #(nx, nz) =
        grid.step(game.grid, game.open_doors, #(current.x, current.z), #(x, z))
      Position(Stage, nx, nz)
    }
  }
}

/// 玄関（骨格の spawn、平屋は (4.7, 11.3)）。鬼と隠れ側のリスポーン位置（ADR 0032 / 0039）。
pub fn spawn(game: Game(id)) -> #(Float, Float) {
  case game.ground {
    Skeleton(layout:, ..) -> layout.skeleton.spawn
    Hiraya -> hiraya.spawn
  }
}

fn spawn_position(game: Game(id)) -> Position {
  let #(x, z) = spawn(game)
  Position(Stage, x, z)
}

/// 次のフェーズへ。襖は、準備移動・答え合わせの開始で全部開き、探索の開始で全部閉じる
/// （ADR 0033・0042）。ほかのフェーズでは、そのまま。
fn next(game: Game(id), phase: Phase) -> Game(id) {
  let open_doors = case phase {
    Preparation | Reveal(_) -> grid.fusuma(game.grid)
    Exploration -> set.new()
    _ -> game.open_doors
  }
  Game(..game, phase:, step: game.step + 1, open_doors:)
  |> record_exploration_hiders
  |> clear_waiting
}

/// 鬼選出を離れたら、待機の状態（待機ポーズ・メンバーの通知の控え）を空にする（issue-59）。
/// 待機ポーズを、隠れ側のポーズ（poses）に引き継がない。
fn clear_waiting(game: Game(id)) -> Game(id) {
  case game.phase {
    OniSelection -> game
    _ ->
      Game(
        ..game,
        waiting_poses: dict.new(),
        waiting_pose_at: dict.new(),
        members_sent: [],
        members_scheduled: False,
      )
  }
}

/// 探索の開始なら、その時点のまだ隠れている隠れ側を残す（issue-29d）。ほかのフェーズでは、そのまま。
fn record_exploration_hiders(game: Game(id)) -> Game(id) {
  case game.phase {
    Exploration ->
      Game(
        ..game,
        exploration_hiders: list.filter(game.players, fn(id) {
          set.contains(game.still_hiding, id)
        }),
      )
    _ -> game
  }
}

/// 勝敗が決まった。答え合わせタイムへ進む。
fn reveal(game: Game(id), outcome: Outcome) -> Game(id) {
  next(game, Reveal(outcome))
}

fn end(game: Game(id), outcome: Outcome) -> Game(id) {
  next(game, Ended(outcome))
}

fn position_of(game: Game(id), id: id) -> Position {
  case dict.get(game.positions, id) {
    Ok(p) -> p
    Error(Nil) -> Position(WaitingRoom, 0.0, 0.0)
  }
}

fn nth(items: List(a), index: Int) -> Result(a, Nil) {
  case index < 0 {
    True -> Error(Nil)
    False ->
      items
      |> list.drop(index)
      |> list.first
  }
}

/// 待機ルームの席（定員5人分の輪）に、参加順で並べる。
fn waiting_seats(ids: List(id)) -> Dict(id, Position) {
  ids
  |> list.index_map(fn(id, index) { #(id, seat_position(index)) })
  |> dict.from_list
}

fn seat_position(index: Int) -> Position {
  let angle =
    2.0 *. pi *. int.to_float(index) /. int.to_float(waiting_ring_seats)
  Position(
    WaitingRoom,
    waiting_ring_radius *. cos(angle),
    waiting_ring_radius *. sin(angle),
  )
}

const pi = 3.141592653589793

@external(erlang, "math", "cos")
fn cos(x: Float) -> Float

@external(erlang, "math", "sin")
fn sin(x: Float) -> Float

@external(erlang, "math", "sqrt")
fn sqrt(x: Float) -> Float
