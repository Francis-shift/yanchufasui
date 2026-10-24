// @ts-check
/**
 * 场景物件模型（本人用 Tripo 生成，tools/pack_prop.py 打包）：牌坊、两只石兽、镇山石、两只香炉、两根华表，栏杆（望柱、栏板，沿台边和石阶），
 * 山石两种（石柱、浮岛：中景、邻峰、广场台底、远山都用它们）。
 * 开局后台下载，到了就摆到 layout.js 给的位置、把占位藏起来；下载失败就一直用占位，不影响玩（中景没有占位，就是空着）。
 * 材质：Tripo 只给一张颜色贴图。打包时从颜色推出一张材质贴图（G 粗糙度、B 金属度），鎏金在夕阳和天空反射下才会发亮；
 * 同一张颜色贴图再当凹凸贴图，浮雕、瓦楞接得住低角度的阳光。
 */
import * as THREE from 'three';
import { decodeDRG2, fetchBytes, staticGeometry, topOf } from './drg2.js';
import { PROP_SPOTS, RAILS } from './layout.js';
import { meltIntoClouds } from './plaza.js';

/**
 * 每个物件：颜色贴图在电影档 / 流畅档各用多大，材质贴图多大（文件名见打包脚本）。
 * mr 为 0 的是山石：全是粗糙的石头，不要材质贴图；底下往云色里融（跟广场台底、邻峰一样）
 */
const PROPS = {
  gate: { color: { cinema: 2048, smooth: 1024 }, mr: 1024, bump: 1 },
  lion: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  stone: { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1.5 },
  censer: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  huabiao: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  // 栏杆摆三四十处，贴图只要 512。望柱生成出来比栏板暗约两成（贴图均值），乘一点颜色跟栏板对齐
  'rail-post': { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1, tint: [1.26, 1.21, 1.15] },
  'rail-panel': { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1 },
  'rock-a': { color: { cinema: 1024, smooth: 512 }, mr: 0, bump: 1.5 },
  'rock-b': { color: { cinema: 1024, smooth: 512 }, mr: 0, bump: 1.5 },
};

/**
 * @param {THREE.Scene} scene
 * @param {{ gateBox: THREE.Object3D, stoneBox: THREE.Object3D, huabiaoBox?: THREE.Object3D, censerBox?: THREE.Object3D,
 *   peakRock?: THREE.Object3D, plaza?: { base: THREE.Object3D } }} layout 占位（方块、代码合成的邻峰和台底）
 * @param {'cinema' | 'smooth'} tier
 * @param {string | ((file: string) => string)} src 模型目录的地址（以 / 结尾），或按文件名给地址的函数（预览页用内嵌的文件）
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ useRocks: (models: Record<string, { geo: THREE.BufferGeometry, map: THREE.Texture, top: ReturnType<typeof topOf> }>) => void,
 *   rockMaterial: (map: THREE.Texture, haze: number) => THREE.Material }} [env] 给了就把远山也换成山石模型，中景用远山那套材质
 */
export function loadProps(scene, layout, tier, src, renderer, env) {
  const url = typeof src === 'function' ? src : (/** @type {string} */ f) => src + f;
  const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), tier === 'cinema' ? 8 : 4);
  const texLoader = new THREE.TextureLoader();
  /** @param {string} u @param {boolean} srgb */
  const tex = async (u, srgb) => {
    const t = await texLoader.loadAsync(u);
    t.flipY = false;                                   // 贴图坐标按 glTF 约定（v 从上往下）
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  /** @param {keyof typeof PROPS} name */
  const load = async (name) => {
    const p = PROPS[name];
    const [buf, map, mr] = await Promise.all([
      fetchBytes(url(`${name}.drg2.gz`)), tex(url(`${name}-${p.color[tier]}.webp`), true), p.mr ? tex(url(`${name}-mr-${p.mr}.webp`), false) : null,
    ]);
    const geo = staticGeometry(decodeDRG2(buf));
    const material = mr
      ? new THREE.MeshStandardMaterial({ map, roughnessMap: mr, metalnessMap: mr, roughness: 1, metalness: 1, bumpMap: map, bumpScale: p.bump })
      : meltIntoClouds(new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0, bumpMap: map, bumpScale: p.bump }));
    const tint = /** @type {{ tint?: [number, number, number] }} */ (p).tint;
    if (tint) material.color.setRGB(...tint);
    return { geo, material, map };
  };
  /**
   * 栏杆：一种模型摆几十处，实例化一次画完。栏板从 a 拉到 b（模型长度方向对上 a→b，带着坡就是错切：竖线仍竖着、上下沿顺着坡）
   * @param {{ geo: THREE.BufferGeometry, material: THREE.Material }} m @param {THREE.Matrix4[]} mats
   */
  const instanced = (m, mats) => {
    const mesh = new THREE.InstancedMesh(m.geo, m.material, mats.length);
    mats.forEach((x, i) => mesh.setMatrixAt(i, x));
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const up = new THREE.Vector3(0, 1, 0);
  /** @param {{ geo: THREE.BufferGeometry, material: THREE.Material }} m @param {typeof PROP_SPOTS.gate} spot */
  const place = (m, spot) => {
    const mesh = new THREE.Mesh(m.geo, m.material);
    mesh.position.set(spot.x, spot.y, spot.z);
    mesh.rotation.y = spot.rotY;
    if (spot.mirror) mesh.scale.x = -1;                 // 镜像：渲染器会按行列式自动翻转正反面
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const warn = (name) => (/** @type {any} */ e) => { console.warn(`场景模型 ${name} 加载失败，继续用方块占位：`, e); return null; };
  return Promise.all([
    load('gate').then((m) => { place(m, PROP_SPOTS.gate); layout.gateBox.visible = false; }).catch(warn('gate')),
    load('lion').then((m) => { for (const s of PROP_SPOTS.lions) place(m, s); }).catch(warn('lion')),
    load('stone').then((m) => { place(m, PROP_SPOTS.stone); layout.stoneBox.visible = false; }).catch(warn('stone')),
    load('censer').then((m) => { for (const s of PROP_SPOTS.censers) place(m, s); if (layout.censerBox) layout.censerBox.visible = false; }).catch(warn('censer')),
    load('huabiao').then((m) => { for (const s of PROP_SPOTS.huabiao) place(m, s); if (layout.huabiaoBox) layout.huabiaoBox.visible = false; }).catch(warn('huabiao')),
    load('rail-post').then((m) => instanced(m, RAILS.posts.map((p) => new THREE.Matrix4().makeRotationY(p.rotY).setPosition(p.x, p.y, p.z)))).catch(warn('rail-post')),
    load('rail-panel').then((m) => {
      m.geo.computeBoundingBox();
      const bb = /** @type {THREE.Box3} */ (m.geo.boundingBox), L = bb.max.x - bb.min.x;
      instanced(m, RAILS.panels.map(({ a, b }) => {
        const X = b.clone().sub(a).divideScalar(L), Z = new THREE.Vector3(-X.z, 0, X.x).normalize();
        return new THREE.Matrix4().makeBasis(X, up, Z).setPosition(a.clone().add(b).multiplyScalar(0.5));
      }));
    }).catch(warn('rail-panel')),
    // 山石：中景一个模型摆几处，大小、朝向各不相同，离得远，不投影也不接影子（阴影贴图只罩着广场，罩不到的地方接影子会出黑边）。
    // 中景跟远山用同一套材质（环境给）：原先用标准材质加一层雾，雾色固定取镜头正前方朝太阳那段天边的橙金色，
    // 背光那面也被染成金色、比天还亮，跟广场上背光的东西对不上（10-24 本人看出光影怪，检查页量过）。
    // 邻峰、台底按顶面摆（离得近，跟原来的代码石头一样投影、接影子）；两种都到了（或到了一种、另一种失败）再换远山
    Promise.all(/** @type {const} */ (['rock-a', 'rock-b']).map((name) => load(name).then((m) => {
      const mid = env ? { geo: m.geo, material: env.rockMaterial(m.map, 0.007) } : m;
      for (const s of PROP_SPOTS.rocks) {
        if (s.model !== name) continue;
        const mesh = place(mid, s);
        mesh.scale.multiplyScalar(s.scale);
        mesh.castShadow = mesh.receiveShadow = false;
      }
      const top = topOf(m.geo);
      for (const [s, old] of /** @type {const} */ ([[PROP_SPOTS.peak, layout.peakRock], [PROP_SPOTS.base, layout.plaza?.base]])) {
        if (s.model !== name || !old) continue;
        // 模型顶面中心转过 rotY、乘上 scale 以后要落在 s.top
        const c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
        const x = s.top[0] - s.scale * (top.x * c + top.z * sn), z = s.top[2] - s.scale * (-top.x * sn + top.z * c);
        place(m, { x, y: s.top[1] - s.scale * top.y, z, rotY: s.rotY, mirror: false }).scale.setScalar(s.scale);
        old.visible = false;
      }
      return /** @type {const} */ ([name, { geo: m.geo, map: m.map, top }]);
    }).catch(warn(name)))).then((got) => {
      const models = Object.fromEntries(got.filter((g) => g !== null));
      if (env && Object.keys(models).length) env.useRocks(models);
    }),
  ]);
}
