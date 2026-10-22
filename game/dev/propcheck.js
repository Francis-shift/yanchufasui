// @ts-check
/**
 * 物件材质检查页（只给本机预览面板用：python tools/build_preview.py props --asset ...）。
 * 面板里的页面不能超过 512 KB，整场游戏加牌坊模型放不下，所以单拎出来：同一套傍晚天光、调色、物件加载与材质，
 * 只摆内嵌进来的模型（石兽、镇山石），看鎏金反不反光、浮雕接不接得住低角度的阳光。游戏本身不引用这个文件。
 * 调试接口 window.pc：view('lion' | 'stone' | 'game')、snap(w, h) 返回 JPEG 地址。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradePass } from '../fx/grade.js';
import { TIERS } from '../quality.js';
import { buildEnvironment } from '../world/environment.js';
import { PROP_SPOTS } from '../world/layout.js';
import { loadProps } from '../world/props.js';

/** 机位：[镜头位置, 看的点] */
const VIEWS = {
  lion: [[-0.6, 2.6, -1.2], [-3.58, 1.5, -6.4]],
  stone: [[2.2, 4.6, -4.4], [0, 4.9, -8.6]],
  game: [[5.6, 7.4, 16.8], [0, 1.0, -3.5]],
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
  const ground = new THREE.Mesh(new THREE.CircleGeometry(11, 64), new THREE.MeshStandardMaterial({ color: 0xcfc8bc, roughness: 0.55 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const dummy = { gateBox: new THREE.Object3D(), stoneBox: new THREE.Object3D() };
  const ready = loadProps(scene, dummy, 'smooth', (f) => assets[f] || `missing:${f}`, renderer);

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
