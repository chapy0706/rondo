/**
 * 三人称カメラの定数（ADR 0034）。three.js を読まずに使えるよう、scene.ts から分けている。
 * 狭い廊下で壁に隠れて自分が見えなくなる点は、目視の結果を見てから決める（issue-29d）。
 * リハーサルで変えるときは、ここだけを書き換える。
 */

/** カメラとキャラクターの距離（メートル）。 */
export const CAMERA_DISTANCE = 2.6;
/** カメラが見下ろす角度（ラジアン）。 */
export const CAMERA_PITCH = 0.35;
/** 目線の高さ（カメラが見る点。メートル）。 */
export const EYE_HEIGHT = 0.8;
