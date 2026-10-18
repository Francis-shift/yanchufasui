'use client';

import { useEffect, useRef } from 'react';

/** 手机检查页：只负责挂载 game/check.js */
export default function Check() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('../../game/check.js').then(({ startCheck }) => {
      if (cancelled || !root.current) return;
      dispose = startCheck(root.current);
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return <div ref={root} className="game-root" />;
}
