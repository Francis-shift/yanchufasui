import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '言出法随',
  description: '说一句中文就能施法的 3D 守关游戏',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // 安卓 Chrome 弹出键盘时让页面跟着变矮（与微信一致），游戏按剩下的高度重新取景
  interactiveWidget: 'resizes-content',
  themeColor: '#9fc3e8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
