// @ts-check
/**
 * 场景物件模型（本人用 Tripo 生成，tools/pack_prop.py 打包）：牌坊、两只石兽、镇山石、两只香炉、两根华表，栏杆（望柱、栏板，沿台边和石阶），
 * 石灯，山石两种（石柱、浮岛：中景、邻峰、广场台底、远山都用它们），松树两种（挺拔的、黄山松：种在中景和远山顶上、台底和邻峰的石壁上），远山顶上的楼阁。
 * 开局后台下载，到了就摆到 layout.js 给的位置、把占位藏起来；下载失败就一直用占位，不影响玩（中景、栏杆、石灯、松树没有占位，就是空着）。
 * 材质：Tripo 只给一张颜色贴图。打包时从颜色推出一张材质贴图（G 粗糙度、B 金属度），鎏金在夕阳和天空反射下才会发亮；
 * 同一张颜色贴图再当凹凸贴图，浮雕、瓦楞接得住低角度的阳光。
 */
import * as THREE from 'three';
import { decodeDRG2, fetchBytes, flatSpots, rootOf, rootRim, staticGeometry, topOf } from './drg2.js';
import { LANTERNS, PROP_SPOTS, RAILS } from './layout.js';
import { meltIntoClouds, useStoneMaps } from './plaza.js';

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
 * 托东西的山石（邻峰、台底）摆在哪：模型顶面中心转过 rotY、乘上 scale 以后要落在 s.top
 * @param {typeof PROP_SPOTS.peak} s @param {ReturnType<typeof topOf>} top
 */
export function perchPose(s, top) {
  const c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
  return { x: s.top[0] - s.scale * (top.x * c + top.z * sn), y: s.top[1] - s.scale * top.y, z: s.top[2] - s.scale * (-top.x * sn + top.z * c), rotY: s.rotY, mirror: false };
}

/**
 * 松树摆在哪（实例矩阵；tests/pines.test.mjs 拿真模型核根团露没露）。挺拔的种在中景石峰顶上，黄山松长在石壁上：
 * 中景石峰顶下（朝 wallPine 伸）、台底、邻峰（PROP_SPOTS.cliffPines）。邻峰顶上是落脚台，不种。
 * 根团不能悬在外面（10-24 本人看出边上那棵的树根整团露着）：
 * 顶上的只种在底下整片托得住的地方（flatSpots），按量到的最低处落根、再往下埋近半个根团（根团高约 0.6 倍尺寸），露出来的只是贴地的根颈；
 * 石壁上的沿根团外沿一圈（rootRim）每个点水平打线量石壁，往里埋到这一圈刚好都进了石头为止——埋得不多不少，树冠尽量伸出去。
 * 石壁往上凸（台底那块浮岛上宽下窄）树冠会扎进石头，所以可以往外倾 tilt 度。
 * 中石柱顶上能托住根团的只有中间一小块，所以顶上最多两棵，第二棵离第一棵 1.6 米以上、小一号。
 * @param {{ mesh: THREE.Object3D, name: string, kind: 'mid' | 'peak' | 'base', wallAz?: number }[]} perches 摆好的山石
 * @param {THREE.BufferGeometry[]} pines [挺拔的, 黄山松]
 * @param {Record<string, THREE.Vector3[]>} spots 每种山石模型顶上能种树的点（flatSpots，模型坐标）
 * @returns {THREE.Matrix4[][][]} [中景, 近处][挺拔的, 黄山松]
 */
export function pinePlacements(perches, pines, spots) {
  /** @type {THREE.Matrix4[][][]} */
  const lists = [[[], []], [[], []]];
  const roots = pines.map(rootOf), rim = rootRim(pines[1]);
  const q = new THREE.Quaternion(), qt = new THREE.Quaternion(), off = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  /** 模型的根落在 at，转过 q */
  const put = (/** @type {number} */ group, /** @type {number} */ kind, /** @type {THREE.Vector3} */ at, /** @type {number} */ size) => {
    off.copy(roots[kind]).multiplyScalar(size).applyQuaternion(q);
    lists[group][kind].push(new THREE.Matrix4().compose(at.clone().sub(off), q, new THREE.Vector3(size, size, size)));
  };
  /** 顶上一棵：根落在 at、往下埋 sink 倍尺寸，绕竖轴转 rot */
  const top = (/** @type {number} */ group, /** @type {number} */ kind, /** @type {THREE.Vector3} */ at, /** @type {number} */ rot, /** @type {number} */ size, /** @type {number} */ sink) => {
    q.setFromAxisAngle(up, rot);
    put(group, kind, at.clone().setY(at.y - sink * size), size);
  };
  /**
   * 石壁上一棵黄山松：根在 (cx, y, cz) 朝 az 方位那条线上，树冠朝 az 伸出去（模型 +x 转到 az）、往外倾 tilt 弧度。
   * 根团外沿每个点：从 40 米外顺着 az 水平往回打线，量那个高度、那个横向位置上石壁在哪；根往外最多挪到每个点都还在石壁里 5 厘米
   */
  const wall = (/** @type {number} */ group, /** @type {THREE.Object3D} */ mesh, /** @type {number} */ cx, /** @type {number} */ cz, /** @type {number} */ az, /** @type {number} */ y, /** @type {number} */ size, /** @type {number} */ tilt) => {
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), side = new THREE.Vector3(-out.z, 0, out.x), dir = out.clone().negate();
    q.setFromAxisAngle(up, -az).premultiply(qt.setFromAxisAngle(side, -tilt));
    let t = Infinity;
    for (const r of rim) {
      o.copy(r).multiplyScalar(size).applyQuaternion(q);
      ray.set(new THREE.Vector3(cx, y + o.y, cz).addScaledVector(side, o.dot(side)).addScaledVector(out, 40), dir);
      const hit = ray.intersectObject(mesh)[0];
      if (!hit) return;                                           // 这一圈有个点那里没有石头：不种
      t = Math.min(t, (hit.point.x - cx) * out.x + (hit.point.z - cz) * out.z - o.dot(out) - 0.05);
    }
    put(group, 1, new THREE.Vector3(cx, y, cz).addScaledVector(out, t), size);
  };
  for (const { mesh, name, kind, wallAz } of perches) {
    mesh.updateMatrixWorld();
    if (kind !== 'mid') {
      for (const s of PROP_SPOTS.cliffPines) if (s.on === kind) wall(1, mesh, s.c[0], s.c[1], s.az, s.y, 0.8, (s.tilt * Math.PI) / 180);
      continue;
    }
    const sp = (spots[name] ?? []).map((v) => v.clone().applyMatrix4(mesh.matrixWorld));
    if (!sp.length) continue;
    top(0, 0, sp[0], 0, 0.95, 0.4);
    const second = sp.find((p) => Math.hypot(p.x - sp[0].x, p.z - sp[0].z) > 1.6);
    if (second) top(0, 0, second, 2.1, 0.65, 0.4);
    if (wallAz !== undefined) wall(0, mesh, sp[0].x, sp[0].z, wallAz, sp[0].y - 1.8, 0.85, 0);
  }
  return lists;
}

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

  /** @type {Parameters<typeof pinePlacements>[0]} 摆好的山石（中景、邻峰、台底），种松树用 */
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
      perches.push({ mesh, name, kind: 'mid', wallAz: (s.wallPine * Math.PI) / 180 });
    }
    const top = topOf(m.geo);
    for (const [s, old, kind] of /** @type {const} */ ([[PROP_SPOTS.peak, layout.peakRock, 'peak'], [PROP_SPOTS.base, layout.plaza?.base, 'base']])) {
      if (s.model !== name || !old) continue;
      const mesh = place(m, perchPose(s, top));
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
   * 种松树（山石和两种松树都到了）：远山主峰顶上交给环境，其余见 pinePlacements。
   * 中景的跟中景石峰同一套材质、不投影；邻峰、台底的离得近，投影、接影子。
   * @param {Record<string, { geo: THREE.BufferGeometry }>} models
   * @param {{ geo: THREE.BufferGeometry, material: THREE.Material, map: THREE.Texture }[]} kinds [挺拔的, 黄山松]
   */
  const plantPines = (models, kinds) => {
    const spots = Object.fromEntries(Object.entries(models).map(([n, m]) => [n, flatSpots(m.geo, 8)]));
    const roots = kinds.map((k) => rootOf(k.geo));
    env?.usePines(kinds.map((k, i) => ({ geo: k.geo, map: k.map, root: roots[i] })), spots, tier === 'cinema' ? 3 : 1);
    const lists = pinePlacements(perches, kinds.map((k) => k.geo), spots);
    kinds.forEach((k, i) => {
      if (lists[0][i].length) instanced(env ? { geo: k.geo, material: env.rockMaterial(k.map, 0.007) } : k, lists[0][i], false);
      if (lists[1][i].length) instanced(k, lists[1][i]);
    });
  };

  return Promise.all([
    // 台面的实拍石材（CC0，不是模型，跟模型放在同一个目录下载）：没到就一直是代码画的台面
    Promise.all([tex(url('stone-normal.webp'), false), tex(url('stone-detail.webp'), false), tex(url('stone-marble.webp'), true)])
      .then(([n, d, m]) => useStoneMaps(n, d, m)).catch(warn('stone-*')),
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
