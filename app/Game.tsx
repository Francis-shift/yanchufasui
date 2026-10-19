'use client';

import { useEffect, useRef } from 'react';

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
        parseUrl: '/api/parse',
        // 冰龙：气势槽过半或第一次召唤时才下载（模型 gzip 后约 310 KB，贴图约 220 KB）
        dragon: { mesh: '/models/ice-dragon.drg2.gz', tex: '/models/ice-dragon-1024.webp' },
      });
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return <div ref={root} className="game-root" />;
}
