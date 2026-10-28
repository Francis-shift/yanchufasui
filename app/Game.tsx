'use client';

import { useEffect, useRef } from 'react';

/** 北京线路：火山引擎函数服务，经 API 网关的默认域名访问（源码 cn-func/）。构建时配了 NEXT_PUBLIC_PARSE_URL 就用它 */
const CN_PARSE_URL = process.env.NEXT_PUBLIC_PARSE_URL || 'https://sid78qptt76cd70t46mml.apigateway-cn-beijing.volceapi.com/parse';

/**
 * 只负责挂载：游戏本体在 game/ 里，是不依赖 React 的浏览器模块，
 * 同一份代码也能打成单文件页面做画面验证。
 */
export default function Game() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('../game/main.js').then(({ start }) => {
      if (cancelled || !root.current) return;
      dispose = start(root.current, {
        // 先走北京（与模型同机房，国内手机实测一来一回约 0.8 秒），不通再走网站自带的新加坡线路
        parseUrl: [CN_PARSE_URL, '/api/parse'],
        lab: new URLSearchParams(location.search).has('lab'),   // 特效试验场：地址加 ?lab
        // 龙：气势槽过半（要召的是哪条看槽的颜色）或第一次召唤时才下载那一条（每条模型 gzip 后约 230～320 KB，贴图约 220 KB）；
        // 别的龙的模型下不成就借冰龙的换色
        dragon: {
          mesh: '/models/ice-dragon.drg2.gz', tex: '/models/ice-dragon-1024.webp',
          models: Object.fromEntries(['fire', 'thunder', 'wind', 'earth'].map((el) =>
            [el, { mesh: `/models/${el}-dragon.drg2.gz`, tex: `/models/${el}-dragon-1024.webp` }])),
        },
        // 场景物件（牌坊、石兽、镇山石）：开局后台下载，电脑约 1.6 MB、手机约 1 MB；没到之前是方块占位
        models: '/models/',
        // 小傀儡的骨骼模型（三种小怪共用，模型约 96 KB、贴图约 76 KB）：开局就下，没到之前是方块
        grunt: { mesh: '/models/grunt.rig.gz', tex: '/models/grunt-512.webp' },
        // 施法者（模型约 159 KB、贴图约 45 KB）：开局就下，没到之前是胶囊占位
        caster: { mesh: '/models/caster.rig.gz', tex: '/models/caster-512.webp' },
      });
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return <div ref={root} className="game-root" />;
}
