// @ts-check
/**
 * 镇山石（设计文档第 2 节"场景物件可点名"）：铁链一断，石头连着铁链往下掉，落地后留在门洞正中挡路。
 * 模型到之前掉方块占位，模型到了一起掉（掉到一半才到也接得上）。落地那一刻才挡路，调用方在 onLand 里让流场重算、结算砸中的敌人。
 * 开新的一局才吊回去。
 */
import { stoneDrop } from '../rules/arbiter.js';
import { DROP } from '../rules/numbers.js';
import { OBJECTS, PROP_SPOTS, setDropped } from './layout.js';

const HEIGHT = PROP_SPOTS.stone.y, LAND = DROP.hold + Math.sqrt((2 * HEIGHT) / DROP.g);
/** 落地时歪多少：端端正正落下来太假 */
const TILT = 0.3;

export class Zhenshan {
  /** @param {import('three').Object3D} box 石头占位 @param {import('three').Object3D} chains 铁链 */
  constructor(box, chains) {
    /** 铁链断了几秒，-1 是还吊着 */
    this.t = -1;
    this.down = false;
    /** @type {(() => void) | null} */
    this.onLand = null;
    this.chains = chains;
    this.chainY = chains.position.y;
    /** @type {{ o: import('three').Object3D, y: number }[]} */
    this.parts = [];
    this.use(box);
  }

  /** 接上一块要跟着掉的石头 @param {import('three').Object3D} o */
  use(o) {
    this.parts.push({ o, y: o.position.y });
    this.pose();
  }

  /** 铁链上断开的地方（打火花用） */
  get ring() { return { x: OBJECTS.rope.x, y: HEIGHT + 1.9, z: OBJECTS.rope.z }; }

  /**
   * 断铁链。已经断了的不算。
   * @param {() => void} onLand 砸到地上时调一次 @returns {boolean} 这一下断了没有
   */
  cut(onLand) {
    if (this.t >= 0) return false;
    this.t = 0; this.onLand = onLand;
    return true;
  }

  /** @param {number} dt */
  update(dt) {
    if (this.t < 0 || this.down) return;
    this.t = Math.min(LAND, this.t + dt);
    this.pose();
    if (this.t < LAND) return;
    this.down = true;
    this.chains.visible = false;
    setDropped({ x: OBJECTS.rope.x, z: OBJECTS.rope.z, r: DROP.body });
    this.onLand?.();
    this.onLand = null;
  }

  /** 吊回去（开新的一局） @returns {boolean} 有没有落下来过（挡路的地方变了，流场要重算） */
  reset() {
    const any = this.down;
    this.t = -1; this.down = false; this.onLand = null;
    this.chains.visible = true;
    this.pose();
    if (any) setDropped(null);
    return any;
  }

  pose() {
    const fell = this.t < 0 ? 0 : stoneDrop(this.t, HEIGHT);
    this.chains.position.y = this.chainY - fell;
    for (const { o, y } of this.parts) {
      o.position.y = y - fell;
      o.rotation.z = TILT * (fell / HEIGHT);
    }
  }
}
