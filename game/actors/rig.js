// @ts-check
/**
 * 绑了骨骼、带动作的人形模型（RIG1，tools/pack_rig.py 打包，布局见那里的 write_rig）。
 * 读一次得到共用的几何体、贴图、动作；每个敌人 makeRig 一份自己的骨架和动作播放器（骨架不能共用：各自摆各自的姿势）。
 * 模型高 1（Tripo 归一化），正面朝 +z；用的地方按要的身高缩放。
 */
import * as THREE from 'three';
import { fetchBytes } from '../world/drg2.js';

/**
 * @typedef {{ geometry: THREE.BufferGeometry, tex: THREE.Texture | null, bones: { name: string, parent: number, t: number[], q: number[] }[],
 *             inverses: THREE.Matrix4[], clips: Record<string, THREE.AnimationClip>, speeds: Record<string, number> }} Rig
 *   speeds：走、跑一类动作原本每秒前进多少（模型单位；打包时已原地化），用来按实际移动速度调播放快慢
 */

/** @param {ArrayBuffer} buf @returns {Omit<Rig, 'tex'>} */
export function decodeRig(buf) {
  const dv = new DataView(buf), bytes = new Uint8Array(buf), text = new TextDecoder();
  let off = 0;
  const u8 = () => dv.getUint8(off++);
  const u16 = () => { const v = dv.getUint16(off, true); off += 2; return v; };
  const i16 = () => { const v = dv.getInt16(off, true); off += 2; return v; };
  const u32 = () => { const v = dv.getUint32(off, true); off += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(off, true); off += 4; return v; };
  const str = () => { const n = u8(); const s = text.decode(bytes.subarray(off, off + n)); off += n; return s; };
  if (u32() !== 0x31474952) throw new Error('不是 RIG1 格式');   // 'RIG1'
  const nv = u32(), nt = u32(), nb = u16(), nc = u16();
  const lo = [f32(), f32(), f32()], hi = [f32(), f32(), f32()];
  const bones = [];
  for (let i = 0; i < nb; i++) {
    const parent = i16(), t = [f32(), f32(), f32()], q = [f32(), f32(), f32(), f32()];
    bones.push({ parent, t, q, name: str() });
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2);
  for (let i = 0; i < nv * 3; i++) { const k = i % 3; P[i] = lo[k] + (u16() / 65535) * (hi[k] - lo[k]); }
  for (let i = 0; i < nv; i++) {
    const x = dv.getInt8(off), y = dv.getInt8(off + 1), z = dv.getInt8(off + 2), l = Math.hypot(x, y, z);
    off += 3;
    // 长度为 0 的法线改成朝上，免得着色器里归一化出 NaN（泛光会把它放大成黑块）
    if (l < 1) { N[i * 3 + 1] = 1; } else { N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l; }
  }
  for (let i = 0; i < nv * 2; i++) UV[i] = u16() / 65535;
  const J = bytes.slice(off, off + nv * 4); off += nv * 4;
  const W = bytes.slice(off, off + nv * 4); off += nv * 4;
  const I = new Uint16Array(nt * 3);
  for (let i = 0; i < nt * 3; i++) I[i] = u16();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(J, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4, true));   // 0～255 → 0～1，每个顶点加起来正好 1
  geometry.setIndex(new THREE.BufferAttribute(I, 1));
  geometry.computeBoundingSphere();

  // 静止姿势下每根骨的世界矩阵求逆 = 绑定时的逆矩阵（打包时核过：静止姿势与 GLB 里的逆绑定矩阵一致）
  /** @type {THREE.Matrix4[]} */
  const world = [];
  const inverses = bones.map((b, i) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.t), new THREE.Quaternion(...b.q), new THREE.Vector3(1, 1, 1));
    world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(m) : m;
    return world[i].clone().invert();
  });

  /** @type {Record<string, THREE.AnimationClip>} */
  const clips = {};
  /** @type {Record<string, number>} */
  const speeds = {};
  for (let c = 0; c < nc; c++) {
    const name = str(), fps = u16(), frames = u16(), speed = f32(), ntr = u16();
    /** @type {THREE.KeyframeTrack[]} */
    const tracks = [];
    for (let k = 0; k < ntr; k++) {
      const bone = u8(), kind = u8(), n = u16();
      const times = Float32Array.from({ length: n }, (_, i) => i / fps);
      if (kind === 0) {
        const v = new Float32Array(n * 4);
        for (let i = 0; i < n * 4; i++) v[i] = i16() / 32767;
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bones[bone].name}.quaternion`, times, v));
      } else {
        const v = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) v[i] = f32();
        tracks.push(new THREE.VectorKeyframeTrack(`${bones[bone].name}.position`, times, v));
      }
    }
    clips[name] = new THREE.AnimationClip(name, (frames - 1) / fps, tracks);
    speeds[name] = speed;
  }
  return { geometry, bones, inverses, clips, speeds };
}

/**
 * 下载模型与贴图。贴图下载失败不要紧（白模照样能用）；模型失败就抛出，调用方退回方块。
 * @param {string} url @param {string | null} [texUrl] @returns {Promise<Rig>}
 */
export async function loadRig(url, texUrl) {
  const [buf, tex] = await Promise.all([
    fetchBytes(url),
    texUrl ? new THREE.TextureLoader().loadAsync(texUrl).catch(() => null) : Promise.resolve(null),
  ]);
  if (tex) { tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; }   // glTF 的贴图坐标约定：v 从上往下
  return { ...decodeRig(buf), tex };
}

/**
 * 一份能独立摆姿势的模型：骨架、蒙皮网格、动作播放器（几何体、动作共用）。
 * @param {Rig} rig @param {THREE.Material} material
 * @returns {{ mesh: THREE.SkinnedMesh, bones: Record<string, THREE.Bone>, mixer: THREE.AnimationMixer, actions: Record<string, THREE.AnimationAction>, cur: string }}
 */
export function makeRig(rig, material) {
  const list = rig.bones.map((b) => {
    const o = new THREE.Bone();
    o.name = b.name; o.position.fromArray(b.t); o.quaternion.fromArray(b.q);
    return o;
  });
  const mesh = new THREE.SkinnedMesh(rig.geometry, material);
  rig.bones.forEach((b, i) => (b.parent >= 0 ? list[b.parent] : mesh).add(list[i]));
  mesh.updateMatrixWorld(true);
  // 给定绑定矩阵（单位阵）就不会重算逆矩阵，几份模型共用同一组
  mesh.bind(new THREE.Skeleton(list, rig.inverses), new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.frustumCulled = false;   // 动作会伸出静止姿势的包围球；小怪就几十个，不剔也不费
  const mixer = new THREE.AnimationMixer(mesh);
  /** @type {Record<string, THREE.AnimationAction>} */
  const actions = {};
  for (const [name, clip] of Object.entries(rig.clips)) actions[name] = mixer.clipAction(clip);
  // 待机是从长片段里截的一段，来回放就没有接缝。一做出来就摆上待机的第一帧：刚冒出来就被冻住的话，定住的是待机而不是绑骨骼时的 T 字
  if (actions.idle) { actions.idle.setLoop(THREE.LoopPingPong, Infinity).play(); mixer.update(0); }
  return { mesh, bones: Object.fromEntries(list.map((b) => [b.name, b])), mixer, actions, cur: actions.idle ? 'idle' : '' };
}

/**
 * 换到这段动作（与上一段交叉淡入淡出 fade 秒）；还是这段就只改快慢。快慢为负就倒着放（往后退）。
 * @param {ReturnType<typeof makeRig>} r @param {string} name @param {number} [speed] @param {number} [fade]
 */
export function playRig(r, name, speed = 1, fade = 0.15) {
  const a = r.actions[name];
  if (!a) return;
  a.setEffectiveTimeScale(speed);
  if (r.cur === name) return;
  const prev = r.cur ? r.actions[r.cur] : null;
  a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).fadeIn(prev ? fade : 0).play();
  prev?.fadeOut(fade);
  r.cur = name;
}

/**
 * 把一个物件按模型坐标（静止姿势）摆好，再挂到某根骨上，之后跟着这根骨动（额头的黄符、头上的铁盔）。
 * 要在模型放进场景、动起来之前调：那时骨骼的世界矩阵就是模型坐标。
 * @param {ReturnType<typeof makeRig>} r @param {string} bone @param {THREE.Object3D} obj
 */
export function attachToBone(r, bone, obj) {
  const b = r.bones[bone];
  if (!b) return;
  r.mesh.add(obj);
  r.mesh.updateMatrixWorld(true);
  b.attach(obj);
}
