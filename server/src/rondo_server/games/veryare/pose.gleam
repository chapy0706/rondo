//// 隠れ側のポーズ（issue-56）。人間の隠れ側が選ぶ、素材のポーズの識別子の一覧。表示名と素材の対応は
//// クライアントが持つ。一覧は、共有の見本（packages/contracts/src/fixtures/veryare-poses.json）と
//// 一致することを pose_test が確かめる（ADR 0009）。
////
//// 隠れ CPU と鬼のポーズは、これまでどおり standing・crouching・lying（hider_cpu.gleam）。クライアントが
//// 素材のポーズに対応づける。

import gleam/list
import gleam/option.{type Option, None, Some}

/// 素材のポーズの識別子（見本の poses の順）。
pub const model_poses = [
  "idle", "femaleStanding1", "femaleStanding2", "femaleStanding3",
  "femaleStanding4", "femaleStanding5", "maleStanding1", "maleStanding2",
  "walking", "mediumRun", "femaleDance", "femaleDynamic1", "femaleDynamic2",
  "femaleDynamic3", "maleCrouch", "femaleSitting1", "femaleSitting2",
  "maleSitting1", "maleSitting2", "maleSitting3", "maleSitting4", "maleLaying1",
  "maleLaying2",
]

/// 隠れ CPU と鬼のポーズの値（hider_cpu.gleam の Pose と同じ）。
pub const cpu_poses = ["standing", "crouching", "lying"]

/// 一覧の識別子なら Some。それ以外（CPU の値・未知の値）は None（null と同じ扱い）。
pub fn parse(value: String) -> Option(String) {
  case list.contains(model_poses, value) {
    True -> Some(value)
    False -> None
  }
}
