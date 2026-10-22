// @ts-check
/**
 * 场景物件模型（本人用 Tripo 生成，tools/pack_prop.py 打包）：牌坊、两只石兽、镇山石。
 * 开局后台下载，到了就摆到 layout.js 给的位置、把方块占位藏起来；下载失败就一直用占位，不影响玩。
 * 材质：Tripo 只给一张颜色贴图。打包时从颜色推出一张材质贴图（G 粗糙度、B 金属度），鎏金在夕阳和天空反射下才会发亮；
 * 同一张颜色贴图再当凹凸贴图，浮雕、瓦楞接得住低角度的阳光。
 */
import * as THREE from 'three';
import { decodeDRG2, fetchBytes, staticGeometry } from './drg2.js';
import { PROP_SPOTS } from './layout.js';

/** 每个物件：颜色贴图在电影档 / 流畅档各用多大，材质贴图多大（文件名见打包脚本） */
const PROPS = {
  gate: { color: { cinema: 2048, smooth: 1024 }, mr: 1024, bump: 1 },
  lion: { color: { cinema: 1024, smooth: 512 }, mr: 512, bump: 1 },
  stone: { color: { cinema: 512, smooth: 512 }, mr: 512, bump: 1.5 },
};

/**
 * @param {THREE.Scene} scene
 * @param {{ gateBox: THREE.Object3D, stoneBox: THREE.Object3D }} layout 方块占位
 * @param {'cinema' | 'smooth'} tier
 * @param {string | ((file: string) => string)} src 模型目录的地址（以 / 结尾），或按文件名给地址的函数（预览页用内嵌的文件）
 * @param {THREE.WebGLRenderer} renderer
 */
export function loadProps(scene, layout, tier, src, renderer) {
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
      fetchBytes(url(`${name}.drg2.gz`)), tex(url(`${name}-${p.color[tier]}.webp`), true), tex(url(`${name}-mr-${p.mr}.webp`), false),
    ]);
    const geo = staticGeometry(decodeDRG2(buf));
    const material = new THREE.MeshStandardMaterial({
      map, roughnessMap: mr, metalnessMap: mr, roughness: 1, metalness: 1, bumpMap: map, bumpScale: p.bump,
    });
    return { geo, material };
  };
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
  ]);
}
