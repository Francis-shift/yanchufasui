// @ts-check
/**
 * 广场上空的小东西（10-25，台面"光影与生活痕迹"那一项）：
 *   - 浮尘：逆光里飘着的细尘，越朝太阳看越亮（前向散射），背着太阳只剩一点点；整个在着色器里飘，不占 CPU；
 *   - 松针：二十来根被风带着翻转飘下来，落到台面上躺几秒，缩没了再从上风处换一根。
 * 风往 +x、+z 吹，跟台面上的云影同向。入侵后天被黑雾盖住，浮尘跟着暗下去。
 */
import * as THREE from 'three';
import { rng } from '../fx/common.js';
import { SUN_DIR } from './environment.js';

/**
 * @param {THREE.Scene} scene
 * @param {{ R: number, motes: number, needles: number }} o 广场半径；浮尘、松针各几个（流畅档少一点）
 */
export function buildAmbience(scene, o) {
  const rnd = rng(19), time = { value: 0 }, inv = { value: 0 }, h = { value: 1080 };

  // 浮尘：广场上空随机撒点，各自绕着原位慢慢漂
  const pos = new Float32Array(o.motes * 3), seed = new Float32Array(o.motes);
  for (let i = 0; i < o.motes; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * o.R;
    pos.set([Math.cos(a) * r, 0.3 + rnd() * 4.5, Math.sin(a) * r], i * 3);
    seed[i] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const motes = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uTime: time, uInv: inv, uSun: { value: SUN_DIR }, uH: h },
    vertexShader: /* glsl */ `
      attribute float seed; uniform float uTime, uH; uniform vec3 uSun; varying float vA;
      void main() {
        float t = uTime * (0.6 + seed * 0.5), s = seed * 6.2832;
        vec3 p = position + vec3(sin(t * 0.21 + s) * 0.7, sin(t * 0.13 + s * 1.7) * 0.35, cos(t * 0.17 + s * 2.3) * 0.7);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        // 前向散射（g = 0.6 的 Henyey-Greenstein）：顺着太阳看过去最亮，游戏机位斜对着太阳，大约在 0.6
        float c = dot(normalize((modelMatrix * vec4(p, 1.)).xyz - cameraPosition), uSun);
        vA = min(0.05 + 0.45 * 0.64 / pow(1.36 - 1.2 * c, 1.5), 1.5);
        vA *= 0.55 + 0.45 * sin(uTime * (1.3 + seed) + s);   // 一闪一闪（翻到亮面）
        // 4～9 厘米（夸大了，真的尘从游戏机位看不见）；小于 1.5 像素就别再缩，把亮度摊薄，免得远处闪烁
        float px = (0.04 + seed * 0.05) * projectionMatrix[1][1] * uH * 0.5 / -mv.z;
        gl_PointSize = clamp(px, 1.5, 40.);
        vA *= min(1., px / 1.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uInv; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1., 0.84, 0.6) * 1.4, vA * (1. - uInv) * smoothstep(0.5, 0.1, d));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  motes.frustumCulled = false;
  // 点的大小按像素算：画到哪张图（主画面、倒影）就按那张图的高
  motes.onBeforeRender = (r) => { const rt = r.getRenderTarget(); h.value = rt ? rt.height : r.domElement.height; };
  scene.add(motes);

  // 松针：细长的小片，两面都画；位置、翻转每帧在 CPU 上算
  const needles = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 0.014),
    new THREE.MeshStandardMaterial({ color: 0x6b5530, roughness: 0.8, side: THREE.DoubleSide }), o.needles);
  const fresh = () => {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (o.R - 1);
    return { p: new THREE.Vector3(Math.cos(a) * r - 3, 7 + rnd() * 4, Math.sin(a) * r - 2), spin: new THREE.Vector3(rnd() * 3, rnd() * 3, rnd() * 3),
      rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), fall: 0.35 + rnd() * 0.3, rest: 0, phase: rnd() * 6 };
  };
  const list = Array.from({ length: o.needles }, () => { const n = fresh(); n.p.y = 0.5 + rnd() * 10; return n; });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  scene.add(needles);

  return {
    /** @param {number} k 入侵程度 */
    setInvasion(k) { inv.value = k; },
    /** @param {number} dt 游戏时间 */
    update(dt) {
      time.value += dt;
      list.forEach((n, i) => {
        if (n.rest > 0) {                        // 躺在地上，最后半秒缩没
          n.rest -= dt;
          if (n.rest <= 0) Object.assign(n, fresh());
        }
        else {
          // 一边落一边被风带着左右飘、翻转
          n.p.x += (0.45 + Math.sin(time.value * 0.9 + n.phase) * 0.35) * dt;
          n.p.z += (0.3 + Math.cos(time.value * 0.7 + n.phase) * 0.25) * dt;
          n.p.y -= n.fall * dt;
          n.rot.x += n.spin.x * dt; n.rot.y += n.spin.y * dt; n.rot.z += n.spin.z * dt;
          if (n.p.y <= 0.005 && n.p.x * n.p.x + n.p.z * n.p.z < o.R * o.R) { n.p.y = 0.005; n.rot.set(-Math.PI / 2, 0, n.rot.z); n.rest = 3 + n.phase; }
          else if (n.p.y < -3) Object.assign(n, fresh());   // 飘出台边，落进云里
        }
        m4.compose(n.p, q.setFromEuler(n.rot), sc.setScalar(n.rest > 0 ? Math.min(1, n.rest / 0.5) : 1));
        needles.setMatrixAt(i, m4);
      });
      needles.instanceMatrix.needsUpdate = true;
    },
  };
}
