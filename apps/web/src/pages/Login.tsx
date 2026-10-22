import { useState } from 'react';
import { BRAND } from '@zhian/shared';
import { api } from '../api';
import { useSessionStore } from '../stores/session';

const ILAB_ERRORS: Record<string, string> = {
  missing_ticket: '没有收到实验空间的登录票据。',
  ticket_expired: '实验空间登录票据已过期（约 2 分钟有效）。',
  ticket_invalid: '实验空间登录票据无效。',
  ticket_replayed: '该登录票据已被使用过。',
  bad_signature: '实验空间签名校验失败，请联系管理员检查服务器配置。',
  exchange_unavailable: '暂时无法连接实验空间（外连未开启或网络不可用）。',
  handoff_invalid: '实验空间登录信息已失效。'
};

/** 登录：真实账号验证；背后是同一个三维基地的静止展示镜头 */
export function Login({ ilabError = null }: { ilabError?: string | null }) {
  const login = useSessionStore((state) => state.login);
  const loading = useSessionStore((state) => state.loading);
  const error = useSessionStore((state) => state.error);
  const [username, setUsername] = useState('student');
  const [password, setPassword] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void login(username, password);
  };

  return (
    <div className="login-layer">
      <header className="login-brand">
        <span className="brand-mark" aria-hidden>安</span>
        <strong>{BRAND.name}</strong>
      </header>
      <section className="login-hero">
        <h1>进入实验，守护每一次智能决策</h1>
        <p className="login-full">{BRAND.fullName}</p>
        <p className="login-tags">24 步交互 · 五维能力画像 · {BRAND.direction}</p>
      </section>
      <form className="login-card" onSubmit={submit} data-block-keys>
        <h2>进入实验</h2>
        <div className="field">
          <label htmlFor="username">账号</label>
          <input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <button className="primary block" type="submit" disabled={loading || !password || !username}>
          {loading ? '登录中…' : '开始实验'}
        </button>
        {error ? <div className="error-text" role="alert">{error}</div> : null}
        {ilabError ? (
          <div className="error-text" role="alert">
            {ILAB_ERRORS[ilabError] ?? `实验空间登录失败（${ilabError}）。`}请回到实验空间点击“我要做实验”重新进入；本地账号练习不受影响。
          </div>
        ) : null}
        {import.meta.env.DEV ? (
          <button
            type="button"
            className="ghost block"
            onClick={() => {
              void api.ilabMockLaunchUrl().then(({ url }) => { window.location.href = url; }).catch(() => undefined);
            }}
          >
            模拟从实验空间进入（仅开发 · 合成数据）
          </button>
        ) : null}
        <p className="muted small center">请使用管理员分配的账号</p>
      </form>
      <p className="login-foot">建议使用键盘与鼠标完成实验；不支持三维时自动切换为 HTML 实验模式</p>
    </div>
  );
}
