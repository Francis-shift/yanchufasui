// @ts-check
/**
 * 调色与冲击后期：放在色调映射之后（画面已是显示用的颜色），做电影常用的几件事——
 * S 形对比、饱和度、暗部偏青亮部偏暖、暗角、细颗粒；命中的一瞬间朝落点径向模糊、边缘轻微色散，再跑一圈折射（圈多大多强见 shock.js）。
 * 只处理整屏的观感；"大招时世界变暗、特效照样亮"由场景灯光与天空完成（environment.js setDim），不在这里压。
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
    uImpact: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uShock: { value: new THREE.Vector4(0.5, 0.5, 0, 1) },   // 圈心 x、y，半径，宽度（半径、宽度按屏高 = 1）
    uShockAmp: { value: 0 },
    uInk: { value: new THREE.Vector4(0.5, 0.5, 0, 0) },   // 水墨（法域）：铺开的圆心 x、y，半径（屏高 = 1），浓淡 0～1
    uTexel: { value: new THREE.Vector2(0.001, 0.001) },   // 水墨描边隔多远取样（一个像素多宽，取 1.5 倍）
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast; uniform float uSaturation; uniform float uVignette;
    uniform float uGrain; uniform float uTime; uniform float uImpact; uniform vec2 uCenter; uniform float uAspect;
    uniform vec4 uShock; uniform float uShockAmp; uniform vec4 uInk; uniform vec2 uTexel;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main(){
      vec2 uv = vUv;
      if (uShockAmp > 0.00001) {
        // 冲击波：圈的内外两侧朝相反方向偏，像一圈透镜；按屏幕比例算，圈才是圆的。长度夹住，圈心那点不除以 0
        vec2 sd = (vUv - uShock.xy) * vec2(uAspect, 1.);
        float sl = max(length(sd), 0.0001), sx = (sl - uShock.z) / uShock.w;
        uv -= sd / sl * uShockAmp * sx * exp(-sx * sx) * vec2(1. / uAspect, 1.);
      }
      vec2 toC = uCenter - uv;
      vec3 c;
      if (uImpact > 0.001) {
        // 径向模糊：沿着朝落点的方向取 8 个样本，越靠外越糊；色散只在边缘
        vec3 acc = vec3(0.); float wsum = 0.;
        for (int i = 0; i < 8; i++) {
          float k = float(i) / 7.;
          float w = 1. - k * 0.6;
          acc += texture2D(tDiffuse, uv + toC * k * 0.024 * uImpact).rgb * w; wsum += w;
        }
        c = acc / wsum;
        vec2 ca = (uv - 0.5) * 0.0028 * uImpact;
        c.r = mix(c.r, texture2D(tDiffuse, uv + ca).r, 0.6);
        c.b = mix(c.b, texture2D(tDiffuse, uv - ca).b, 0.6);
      } else {
        c = texture2D(tDiffuse, uv).rgb;
      }
      // S 形对比（以中灰为轴）与饱和度
      c = clamp((c - 0.5) * uContrast + 0.5, 0., 1.);
      c = mix(c, c * c * (3. - 2. * c), (uContrast - 1.) * 1.5);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      // 暗部偏青、亮部偏暖（电影里常见的冷暖分离，压得很轻）
      c += vec3(-0.012, 0.004, 0.02) * (1. - l) * (1. - l) + vec3(0.018, 0.008, -0.012) * l * l;
      if (uInk.w > 0.001) {
        // 水墨：从脚下铺开，亮度换成纸和墨，明暗交界描一道墨线；浓的颜色（法术、红圈）留着。边上按小格子抖一下，铺开的边是毛的
        vec2 id = (vUv - uInk.xy) * vec2(uAspect, 1.);
        float edge = smoothstep(uInk.z, uInk.z - 0.1, length(id) + (hash(floor(vUv * 160.)) - 0.5) * 0.05);
        float g = lum(c);
        float gx = lum(texture2D(tDiffuse, uv + vec2(uTexel.x, 0.)).rgb) - lum(texture2D(tDiffuse, uv - vec2(uTexel.x, 0.)).rgb);
        float gy = lum(texture2D(tDiffuse, uv + vec2(0., uTexel.y)).rgb) - lum(texture2D(tDiffuse, uv - vec2(0., uTexel.y)).rgb);
        vec3 ink = mix(vec3(0.07, 0.065, 0.06), vec3(0.93, 0.9, 0.83), smoothstep(0.08, 0.8, g));
        ink *= 1. - 0.8 * smoothstep(0.04, 0.2, length(vec2(gx, gy)));
        float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
        c = mix(c, mix(ink, c, smoothstep(0.45, 0.8, sat)), edge * uInk.w);
      }
      // 暗角：按画面比例做成椭圆
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.);
      c *= 1. - uVignette * smoothstep(0.35, 1.05, length(d) * 1.25);
      // 细颗粒：每帧换图案
      c += (hash(vUv * 1000. + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
    }`,
};

export class GradePass extends ShaderPass {
  /** @param {import('../quality.js').Quality['grade']} g */
  constructor(g) {
    super(GradeShader);
    this.g = g;
    const u = this.uniforms;
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    u.uVignette.value = g.vignette;
    u.uGrain.value = g.grain;
  }

  /**
   * 每帧调用。impact 0～1 是这一刻的冲击强度（落点爆炸时冲上去、很快衰减），center 是落点在屏幕上的位置（0～1）。
   * shock 是这一刻的冲击波圈（x、y 是圈心在屏幕上的位置）；g.impact 为 0 的档（手机流畅档）不画，也不多算。
   * @param {number} dt @param {number} impact @param {THREE.Vector2} center @param {number} aspect
   * @param {{ x: number, y: number, r: number, w: number, amp: number }} [shock]
   * @param {{ x: number, y: number, r: number, k: number }} [ink] 水墨（法域）：不看 g.impact，手机流畅档也要有
   */
  tick(dt, impact, center, aspect, shock, ink) {
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 100;
    u.uImpact.value = impact * this.g.impact;
    u.uCenter.value.copy(center);
    u.uAspect.value = aspect;
    u.uShockAmp.value = shock ? shock.amp * this.g.impact : 0;
    if (shock) u.uShock.value.set(shock.x, shock.y, shock.r, shock.w);
    u.uInk.value.w = ink ? ink.k : 0;
    if (ink) {
      u.uInk.value.set(ink.x, ink.y, ink.r, ink.k);
      u.uTexel.value.set(1.5 / (1080 * aspect), 1.5 / 1080);   // 按 1080 高算：屏幕小的线粗一点，反正水墨是粗的
    }
  }
}
