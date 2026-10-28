// @ts-check
/**
 * 五条龙的检查页（只给本机预览面板用：python tools/build_preview.py dragons --dragon preview/assets/dragon-6k.bin）。
 * 面板里的页面不能超过 512 KB，整场游戏再加一条龙放不下，所以单拎出来：同一套天光、广场、特效和龙，没有敌人和规则，
 * 看每条龙的一套动作在固定镜头里出不出画面、擦不擦东西，落地的火海、旋风、雷大概什么样。游戏本身不引用这个文件。
 * 减面版的龙没有贴图，四条借冰龙模型的都用 dragon.js LOOK 里的底色（贴图换色要在正式站上看）。
 * 调试接口 window.dc：fly(元素, [x, z]) 召一条；step(秒) 按 1/60 秒往前算、不画；at(秒) 算到召唤后第几秒；
 * render() 画一帧；view('game' | 'high' | 'side' 或 [[镜头], [看的点]])；flight() 飞到哪了；log() 砸中、劈雷的时刻。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradePass } from '../fx/grade.js';
import { DragonFx } from '../fx/dragon.js';
import { FusionFx } from '../fx/fusions.js';
import { Particles } from '../fx/particles.js';
import { SpellFx } from '../fx/spells.js';
import { TIERS } from '../quality.js';
import { buildEnvironment } from '../world/environment.js';
import { buildLayout, CASTER_POS, groundHeightAt } from '../world/layout.js';

/** 机位：[镜头位置, 看的点]。game 是游戏里横屏的固定机位 */
const VIEWS = {
  game: [[5.6, 7.4, 16.8], [0, 1.0, -3.5]],
  high: [[0, 34, 20], [0, 0, -4]],
  side: [[26, 6, -2], [0, 4, -3]],
};

/** @param {HTMLElement} root @param {string | undefined} mesh 减面版龙的地址 */
export function startDragonCheck(root, mesh) {
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
  buildLayout(scene, { tex: 1024, reflect: false });
  const particles = new Particles(scene, q.particles);
  particles.floorAt = (x, z) => (groundHeightAt(x, z) ?? -60) + 0.03;
  const ink = new Particles(scene, q.ink, { ink: true });
  ink.floorAt = particles.floorAt;
  const fx = new SpellFx(scene, particles, CASTER_POS.clone().setY(1.5), { ink, quality: q });
  fx.groundAt = groundHeightAt;
  const fusions = new FusionFx(fx, particles, 1);
  const dragon = new DragonFx(fx, particles, mesh ? { mesh } : {});

  let view = VIEWS.game, clock = 0;
  /** @type {string[]} */
  const log = [];
  const f1 = (/** @type {THREE.Vector3} */ v) => v.toArray().map((x) => +x.toFixed(1));
  /** 落地、劈雷：只演样子（火海、旋风、闪电），不结算 @param {string} el @param {THREE.Vector3} T */
  const hooks = (el, T) => ({
    impact: (/** @type {THREE.Vector3} */ p) => {
      log.push(`${clock.toFixed(2)} 秒 砸中 ${f1(p)}`);
      if (el === 'fire') fx.groundFire(p, 4, 4);
      if (el === 'wind') fusions.gale(p, 5, 3);
    },
    strike: (/** @type {THREE.Vector3} */ from, /** @type {number} */ i) => {
      const to = T.clone().add(new THREE.Vector3(Math.cos(i * 2.4) * 2, 0.8, Math.sin(i * 2.4) * 2));
      fx.arc(from, to, { forks: 2 });
      fx.burst(to, 'thunder', 1.4, 0.6);
      log.push(`${clock.toFixed(2)} 秒 第 ${i + 1} 道雷 从 ${f1(from)}`);
    },
  });
  /** @param {number} dt */
  const step = (dt) => {
    clock += dt;
    dragon.update(dt); fusions.update(dt, camera); fx.update(dt); particles.update(dt); ink.update(dt);
    env.setDim(fx.dimLevel);
    env.update(dt, camera.position);
  };
  const render = () => {
    const w = root.clientWidth || 960, h = root.clientHeight || 540;
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const [p, t] = view;
    camera.position.set(p[0], p[1], p[2]); camera.lookAt(t[0], t[1], t[2]);
    fx.cameraPos.copy(camera.position);
    env.aim(new THREE.Vector3(t[0], t[1], t[2]).sub(camera.position));
    grade.tick(0, 0, new THREE.Vector2(0.5, 0.5), w / h);
    composer.render();
  };
  const dc = {
    scene, env, fx, dragon,
    /** 召一条：落点 at = [x, z]（地面高度自己取） @param {string} [el] @param {number[]} [at] */
    fly: async (el = 'ice', at = [0, -3]) => {
      await dragon.preload(el);
      const T = new THREE.Vector3(at[0], groundHeightAt(at[0], at[1]) ?? 0, at[1]);
      log.length = 0; clock = 0;
      dragon.summon(T, el, hooks(el, T));
      return dc.flight();
    },
    /** @param {number} sec */
    step: (sec) => { for (let t = 0; t < sec - 1e-6; t += 1 / 60) step(1 / 60); return dc.flight(); },
    /** @param {number} sec */
    at: (sec) => dc.step(sec - clock),
    render: () => { render(); return dc.flight(); },
    /** @param {keyof typeof VIEWS | number[][]} v */
    view: (v) => { view = typeof v === 'string' ? VIEWS[v] : v; render(); },
    flight: () => {
      const f = dragon.active;
      return f && { t: +clock.toFixed(2), el: f.el, pick: f.plan.pick, s: +f.s.toFixed(1), sHit: +f.sHit.toFixed(1), L: +f.L.toFixed(1),
        impacted: f.impacted, mesh: !!f.model, head: f1(f.headPos), tail: f1(f.tailPos) };
    },
    log: () => [...log],
  };
  /** @type {any} */ (window).dc = dc;
  addEventListener('resize', render);
  render();
  return dc;
}
