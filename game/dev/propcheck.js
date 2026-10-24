// @ts-check
/**
 * 物件材质检查页（只给本机预览面板用：python tools/build_preview.py props --asset ...）。
 * 面板里的页面不能超过 512 KB，整场游戏加牌坊模型放不下，所以单拎出来：同一套傍晚天光、调色、物件加载与材质，
 * 只摆内嵌进来的模型（石兽、镇山石、山石），看鎏金反不反光、浮雕接不接得住低角度的阳光、山石跟远山接不接得上。游戏本身不引用这个文件。
 * 调试接口 window.pc：view('lion' | 'stone' | 'game' | 'left' | 'right' | 'peak' | 'base' | 'far' | 'censer' | 'huabiao' | 'rim' | 'stairs')、snap(w, h) 返回 JPEG 地址。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradePass } from '../fx/grade.js';
import { TIERS } from '../quality.js';
import { buildEnvironment } from '../world/environment.js';
import { buildLayout, PROP_SPOTS } from '../world/layout.js';
import { loadProps } from '../world/props.js';

/** 机位：[镜头位置, 看的点] */
const VIEWS = {
  lion: [[-0.6, 2.6, -1.2], [-3.58, 1.5, -6.4]],
  stone: [[2.2, 4.6, -4.4], [0, 4.9, -8.6]],
  game: [[5.6, 7.4, 16.8], [0, 1.0, -3.5]],
  // 中景石峰：从广场边上看左右两组
  left: [[-6, 3, -10], [-28, 1, -34]],
  right: [[6, 3, -10], [22, 0, -44]],
  // 邻峰（从广场上顺着索桥看）、台底（从广场外面看）、远山（拉远，左右都进画）
  peak: [[-6, 4, -2], [-27, -3, -16]],
  base: [[18, 3, 22], [0, -5, 0]],
  far: [[5.6, 7.4, 16.8], [-10, 4, -120]],
  // 右边的香炉、华表；栏杆：台边（从广场里看向石阶口和桥头）、石阶两侧（从台边往下看）
  censer: [[4.6, 2.2, 5.2], [7.2, 0.7, 1.5]],
  huabiao: [[7.4, 2.4, 0.6], [4.2, 2.4, -3.0]],
  rim: [[2, 2.4, 4], [-4, 0.3, -10]],
  stairs: [[9, 3, -12], [0, -4, -19]],
};

/** @param {HTMLElement} root @param {Record<string, string>} assets 文件名 → 地址 */
export function startPropCheck(root, assets) {
  const q = TIERS.cinema;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  root.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1500);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), q.bloom.strength, q.bloom.radius, q.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new GradePass(q.grade);
  composer.addPass(grade);
  const env = buildEnvironment(scene, renderer);
  env.setShadowMap(q.shadowMap);
  const layout = buildLayout(scene, { tex: 1024 });   // 广场、索桥、邻峰都在（台底、邻峰的山石换得对不对要放在一起看）
  const ready = loadProps(scene, layout, 'smooth', (f) => assets[f] || `missing:${f}`, renderer, env);

  let w = 960, h = 540, view = 'lion';
  const render = () => {
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const [p, t] = VIEWS[view];
    camera.position.set(...p); camera.lookAt(new THREE.Vector3(...t));
    env.aim(new THREE.Vector3(...t).sub(camera.position));
    grade.tick(0, 0, new THREE.Vector2(0.5, 0.5), w / h);
    composer.render();
  };
  const pc = {
    ready, spots: PROP_SPOTS, scene, renderer, env,
    /** @param {keyof typeof VIEWS} v */
    view: (v) => { view = v; render(); return v; },
    snap: (sw = 960, sh = 540) => { w = sw; h = sh; render(); return renderer.domElement.toDataURL('image/jpeg', 0.8); },
  };
  /** @type {any} */ (window).pc = pc;
  ready.then(() => render());
  render();
  return pc;
}
