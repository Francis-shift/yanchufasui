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
      dispose = start(root.current, { parseUrl: '/api/parse' });
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return <div ref={root} className="game-root" />;
}
