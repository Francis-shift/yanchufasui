// @ts-check
/**
 * 场景物件模型（本人用 Tripo 生成，tools/pack_prop.py 打包）：牌坊、两只石兽、镇山石、两只香炉、两根华表，栏杆（望柱、栏板，沿台边和石阶），
 * 石灯，山石两种（石柱、浮岛：中景、邻峰、广场台底、远山都用它们），松树两种（挺拔的、黄山松：种在山石顶上和台底石壁上），远山顶上的楼阁。
 * 开局后台下载，到了就摆到 layout.js 给的位置、把占位藏起来；下载失败就一直用占位，不影响玩（中景、栏杆、石灯、松树没有占位，就是空着）。
 * 材质：Tripo 只给一张颜色贴图。打包时从颜色推出一张材质贴图（G 粗糙度、B 金属度），鎏金在夕阳和天空反射下才会发亮；
 * 同一张颜色贴图再当凹凸贴图，浮雕、瓦楞接得住低角度的阳光。
 */
import * as THREE from 'three';
import { decodeDRG2, fetchBytes, flatSpots, rootOf, staticGeometry, topOf } from './drg2.js';
import { LANTERNS, PROP_SPOTS, RAILS } from './layout.js';
import { meltIntoClouds } from './plaza.js';

/**
 * 每个物件：颜色贴图在电影档 / 流畅档各用多大，材质贴图多大（文件名见打包脚本）。
 * mr 为 0 的不要材质贴图：山石、松树全是粗糙的，底下往云色里融（跟广场台底、邻峰一样）；楼阁只在远山上，用远山的材质
 */
const PROPS = {
  gate: { color: { cinema: 2048, smooth: 1024 }, mr: 1024, bump: 1 },
  lion: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  stone: { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1.5 },
  censer: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  huabiao: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  // 栏杆摆三四十处、石灯九盏，贴图只要 512。望柱生成出来比栏板暗约两成（贴图均值），乘一点颜色跟栏板对齐
  'rail-post': { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1, tint: [1.26, 1.21, 1.15] },
  'rail-panel': { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1 },
  lantern: { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1 },
  'rock-a': { color: { cinema: 1024, smooth: 512 }, mr: 0, bump: 1.5 },
  'rock-b': { color: { cinema: 1024, smooth: 512 }, mr: 0, bump: 1.5 },
  'pine-a': { color: { cinema: 1024, smooth: 512 }, mr: 0, bump: 1 },
  'pine-b': { color: { cinema: 1024, smooth: 512 }, mr: 0, bump: 1 },
  pavilion: { color: { cinema: 512, smooth: 512 }, mr: 0, bump: 1 },
};

/** 石灯灯室中心离地多高（模型高 1.2）：里面放一点暖光，傍晚点着的灯 */
const LANTERN_GLOW_Y = 0.74;

/**
 * @param {THREE.Scene} scene
 * @param {{ gateBox: THREE.Object3D, stoneBox: THREE.Object3D, huabiaoBox?: THREE.Object3D, censerBox?: THREE.Object3D,
 *   peakRock?: THREE.Object3D, plaza?: { base: THREE.Object3D } }} layout 占位（方块、代码合成的邻峰和台底）
 * @param {'cinema' | 'smooth'} tier
 * @param {string | ((file: string) => string)} src 模型目录的地址（以 / 结尾），或按文件名给地址的函数（预览页用内嵌的文件）
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ useRocks: (models: Record<string, { geo: THREE.BufferGeometry, map: THREE.Texture, top: ReturnType<typeof topOf> }>) => void,
 *   usePavilion: (model: { geo: THREE.BufferGeometry, map: THREE.Texture }) => void,
 *   usePines: (kinds: { geo: THREE.BufferGeometry, map: THREE.Texture, root: THREE.Vector3 }[], spots: Record<string, THREE.Vector3[]>, per: number) => void,
 *   rockMaterial: (map: THREE.Texture, haze: number) => THREE.Material }} [env] 给了就把远山、远处楼阁也换成模型，中景用远山那套材质
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
   * 一种模型摆几十处（栏杆、石灯、松树），实例化一次画完
   * @param {{ geo: THREE.BufferGeometry, material: THREE.Material }} m @param {THREE.Matrix4[]} mats @param {boolean} [shadow]
   */
  const instanced = (m, mats, shadow = true) => {
    const mesh = new THREE.InstancedMesh(m.geo, m.material, mats.length);
    mats.forEach((x, i) => mesh.setMatrixAt(i, x));
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = shadow;
    scene.add(mesh);
    return mesh;
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

  /** @type {{ mesh: THREE.Mesh, name: string, kind: 'mid' | 'peak' | 'base' }[]} 摆好的山石（中景、邻峰、台底），种松树用 */
  const perches = [];
  // 山石：中景一个模型摆几处，大小、朝向各不相同，离得远，不投影也不接影子（阴影贴图只罩着广场，罩不到的地方接影子会出黑边）。
  // 中景跟远山用同一套材质（环境给）：原先用标准材质加一层雾，雾色固定取镜头正前方朝太阳那段天边的橙金色，
  // 背光那面也被染成金色、比天还亮，跟广场上背光的东西对不上（10-24 本人看出光影怪，检查页量过）。
  // 邻峰、台底按顶面摆（离得近，跟原来的代码石头一样投影、接影子）；两种都到了（或到了一种、另一种失败）再换远山
  const rocks = Promise.all(/** @type {const} */ (['rock-a', 'rock-b']).map((name) => load(name).then((m) => {
    const mid = env ? { geo: m.geo, material: env.rockMaterial(m.map, 0.007) } : m;
    for (const s of PROP_SPOTS.rocks) {
      if (s.model !== name) continue;
      const mesh = place(mid, s);
      mesh.scale.multiplyScalar(s.scale);
      mesh.castShadow = mesh.receiveShadow = false;
      perches.push({ mesh, name, kind: 'mid' });
    }
    const top = topOf(m.geo);
    for (const [s, old, kind] of /** @type {const} */ ([[PROP_SPOTS.peak, layout.peakRock, 'peak'], [PROP_SPOTS.base, layout.plaza?.base, 'base']])) {
      if (s.model !== name || !old) continue;
      // 模型顶面中心转过 rotY、乘上 scale 以后要落在 s.top
      const c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
      const x = s.top[0] - s.scale * (top.x * c + top.z * sn), z = s.top[2] - s.scale * (-top.x * sn + top.z * c);
      const mesh = place(m, { x, y: s.top[1] - s.scale * top.y, z, rotY: s.rotY, mirror: false });
      mesh.scale.setScalar(s.scale);
      old.visible = false;
      perches.push({ mesh, name, kind });
    }
    return /** @type {const} */ ([name, { geo: m.geo, map: m.map, top }]);
  }).catch(warn(name)))).then((got) => {
    const models = Object.fromEntries(got.filter((g) => g !== null));
    if (env && Object.keys(models).length) env.useRocks(models);
    return models;
  });

  /**
   * 种松树（山石和两种松树都到了）：远山主峰顶上交给环境；中景石峰、邻峰顶上挺拔的在中间、黄山松在边上树冠朝外；
   * 台底石壁上长黄山松（从外面水平往广场中心打线找石壁）。邻峰顶是敌人出来的地方，只种在背对索桥的那半边、离中心 2.5 米外。
   * 中景的跟中景石峰同一套材质、不投影；邻峰、台底的离得近，投影、接影子。
   * @param {Record<string, { geo: THREE.BufferGeometry }>} models
   * @param {{ geo: THREE.BufferGeometry, material: THREE.Material, map: THREE.Texture }[]} kinds [挺拔的, 黄山松]
   */
  const plantPines = (models, kinds) => {
    const spots = Object.fromEntries(Object.entries(models).map(([n, m]) => [n, flatSpots(m.geo, 8)]));
    const roots = kinds.map((k) => rootOf(k.geo));
    env?.usePines(kinds.map((k, i) => ({ geo: k.geo, map: k.map, root: roots[i] })), spots, tier === 'cinema' ? 3 : 1);
    /** @type {THREE.Matrix4[][][]} [中景, 近处][挺拔的, 黄山松] */
    const lists = [[[], []], [[], []]];
    const q = new THREE.Quaternion(), off = new THREE.Vector3();
    /** 根落在 at，树冠（黄山松沿模型 +x）朝 out 方向 @param {number} group @param {number} kind @param {THREE.Vector3} at @param {number} rot @param {number} size */
    const add = (group, kind, at, rot, size) => {
      q.setFromAxisAngle(up, rot);
      off.copy(roots[kind]).multiplyScalar(size).applyQuaternion(q);
      lists[group][kind].push(new THREE.Matrix4().compose(new THREE.Vector3(at.x - off.x, at.y - 0.15 * size, at.z - off.z), q, new THREE.Vector3(size, size, size)));
    };
    const outward = (/** @type {THREE.Vector3} */ p, /** @type {THREE.Vector3} */ c) => -Math.atan2(p.z - c.z, p.x - c.x);
    for (const { mesh, name, kind } of perches) {
      mesh.updateMatrixWorld();
      if (kind === 'base') {
        for (const s of PROP_SPOTS.cliffPines) {
          const dir = new THREE.Vector3(-Math.cos(s.az), 0, -Math.sin(s.az));
          const hit = new THREE.Raycaster(dir.clone().multiplyScalar(-40).setY(s.y), dir, 0, 40).intersectObject(mesh)[0];
          if (hit) add(1, 1, hit.point.addScaledVector(dir, 0.3), -Math.atan2(-dir.z, -dir.x), 0.8);
        }
        continue;
      }
      const sp = (spots[name] ?? []).map((v) => v.clone().applyMatrix4(mesh.matrixWorld));
      if (!sp.length) continue;
      const c = sp[0].clone();
      if (kind === 'mid') {
        sp.slice(0, 3).forEach((p, k) => add(0, k === 1 ? 1 : 0, p, k === 1 ? outward(p, c) : k * 2.1, k === 2 ? 0.7 : 0.95));
      } else {
        const peakC = new THREE.Vector3(PROP_SPOTS.peak.top[0], 0, PROP_SPOTS.peak.top[2]), away = peakC.clone().normalize();
        const ok = sp.filter((p) => Math.hypot(p.x - peakC.x, p.z - peakC.z) > 2.5 && p.clone().sub(peakC).setY(0).dot(away) > 0.5);
        ok.slice(0, 3).forEach((p, k) => add(1, k === 1 ? 1 : 0, p, k === 1 ? outward(p, peakC) : k * 2.1, k === 1 ? 0.7 : 0.6 + 0.15 * k));
      }
    }
    kinds.forEach((k, i) => {
      if (lists[0][i].length) instanced(env ? { geo: k.geo, material: env.rockMaterial(k.map, 0.007) } : k, lists[0][i], false);
      if (lists[1][i].length) instanced(k, lists[1][i]);
    });
  };

  return Promise.all([
    load('gate').then((m) => { place(m, PROP_SPOTS.gate); layout.gateBox.visible = false; }).catch(warn('gate')),
    load('lion').then((m) => { for (const s of PROP_SPOTS.lions) place(m, s); }).catch(warn('lion')),
    load('stone').then((m) => { place(m, PROP_SPOTS.stone); layout.stoneBox.visible = false; }).catch(warn('stone')),
    load('censer').then((m) => { for (const s of PROP_SPOTS.censers) place(m, s); if (layout.censerBox) layout.censerBox.visible = false; }).catch(warn('censer')),
    load('huabiao').then((m) => { for (const s of PROP_SPOTS.huabiao) place(m, s); if (layout.huabiaoBox) layout.huabiaoBox.visible = false; }).catch(warn('huabiao')),
    // 栏杆：栏板从 a 拉到 b（模型长度方向对上 a→b，带着坡就是错切：竖线仍竖着、上下沿顺着坡）
    load('rail-post').then((m) => instanced(m, RAILS.posts.map((p) => new THREE.Matrix4().makeRotationY(p.rotY).setPosition(p.x, p.y, p.z)))).catch(warn('rail-post')),
    load('rail-panel').then((m) => {
      m.geo.computeBoundingBox();
      const bb = /** @type {THREE.Box3} */ (m.geo.boundingBox), L = bb.max.x - bb.min.x;
      instanced(m, RAILS.panels.map(({ a, b }) => {
        const X = b.clone().sub(a).divideScalar(L), Z = new THREE.Vector3(-X.z, 0, X.x).normalize();
        return new THREE.Matrix4().makeBasis(X, up, Z).setPosition(a.clone().add(b).multiplyScalar(0.5));
      }));
    }).catch(warn('rail-panel')),
    // 石灯：灯室里一个发光的小方块（不受光照，泛光晕开），看着像点着的灯
    load('lantern').then((m) => {
      instanced(m, LANTERNS.map((s) => new THREE.Matrix4().makeRotationY(s.rotY).setPosition(s.x, s.y, s.z)));
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5, 0.18).multiplyScalar(2.4) });
      instanced({ geo: new THREE.BoxGeometry(0.12, 0.14, 0.12), material: glow }, LANTERNS.map((s) => new THREE.Matrix4().setPosition(s.x, s.y + LANTERN_GLOW_Y, s.z)), false);
    }).catch(warn('lantern')),
    load('pavilion').then((m) => env?.usePavilion(m)).catch(warn('pavilion')),
    rocks,
    Promise.all([rocks, load('pine-a'), load('pine-b')]).then(([models, a, b]) => plantPines(models, [a, b])).catch(warn('pine')),
  ]);
}
