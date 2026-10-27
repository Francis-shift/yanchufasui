// @ts-check
/**
 * 融合法术的判定（纯函数，有单测）：豪火灭却是一片从施法者身前往前推、越推越宽的火浪，浪头扫过谁就烧谁。
 * 数值在 numbers.js 的 BEAM；样子在 fx/fusions.js，每帧判定在 main.js。
 */
import { BEAM } from './numbers.js';

/** 离起点 along 米处火浪的半宽（米）：从 w0 线性张到 w1 @param {number} along */
export const waveHalfW = (along) => BEAM.w0 + (BEAM.w1 - BEAM.w0) * Math.min(1, Math.max(0, along / BEAM.len));

/**
 * 浪头推了 front 米时，p 在不在火浪里：身后、浪头还没到、出了尽头、在两侧张开的边外都不算。body：身体半径。
 * @param {{ x: number, z: number }} p @param {{ x: number, z: number }} from 起点 @param {{ x: number, z: number }} dir 水平单位向量
 * @param {number} front @param {number} [body]
 */
export function inWave(p, from, dir, front, body = 0) {
  const rx = p.x - from.x, rz = p.z - from.z;
  const along = rx * dir.x + rz * dir.z, lat = Math.abs(rx * dir.z - rz * dir.x);
  return along >= -body && along <= Math.min(front, BEAM.len) + body && lat <= waveHalfW(along) + body;
}
