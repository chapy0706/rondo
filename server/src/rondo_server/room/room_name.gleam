/// ルーム名を整える（issue-58）。サーバーが正で、TS の packages/contracts/src/roomName.ts は
/// 入力欄の検査に使う写し。両者は同じ見本（fixtures/room-names.json）を読むテストで守る。
///
/// - 制御文字（Cc）と双方向制御（U+202A-202E, U+2066-2069）を取り除く
/// - 前後の空白（全角スペースを含む。JS の trim と同じ集合）を落とす
/// - 長さはコードポイントで数え、20 文字を超えた分は切り捨てる
/// - 空なら既定の名前（作った人の表示名 + 「のルーム」。表示名は 16 文字で切る）
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string

/// ルーム名の長さの上限（コードポイント）。
pub const max_length = 20

const default_suffix = "のルーム"

/// ルームが持つ名前を決める。省略・空なら既定の名前。
pub fn normalize(raw: Option(String), owner: String) -> String {
  case option.map(raw, clean(_, max_length)) {
    Some(name) if name != "" -> name
    Some(_) | None -> default_name(owner)
  }
}

/// 名前を決めなかったときの名前（作った人の表示名 + 「のルーム」）。
pub fn default_name(owner: String) -> String {
  let suffix_length = list.length(string.to_utf_codepoints(default_suffix))
  clean(owner, max_length - suffix_length) <> default_suffix
}

/// 制御文字を除き、前後の空白を落とし、limit 文字で切る。空になることがある。
fn clean(text: String, limit: Int) -> String {
  text
  |> string.to_utf_codepoints
  |> list.map(string.utf_codepoint_to_int)
  |> list.filter(fn(code) { !is_removed(code) })
  |> trim
  |> list.take(limit)
  |> trim
  |> list.filter_map(string.utf_codepoint)
  |> string.from_utf_codepoints
}

fn trim(codes: List(Int)) -> List(Int) {
  codes
  |> list.drop_while(is_space)
  |> list.reverse
  |> list.drop_while(is_space)
  |> list.reverse
}

fn is_removed(code: Int) -> Bool {
  code <= 0x1F
  || { code >= 0x7F && code <= 0x9F }
  || { code >= 0x202A && code <= 0x202E }
  || { code >= 0x2066 && code <= 0x2069 }
}

/// JS の String.prototype.trim が落とす空白（WhiteSpace と LineTerminator）。
fn is_space(code: Int) -> Bool {
  { code >= 0x09 && code <= 0x0D }
  || code == 0x20
  || code == 0xA0
  || code == 0x1680
  || { code >= 0x2000 && code <= 0x200A }
  || code == 0x2028
  || code == 0x2029
  || code == 0x202F
  || code == 0x205F
  || code == 0x3000
  || code == 0xFEFF
}
