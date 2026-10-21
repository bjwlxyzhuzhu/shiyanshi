import { useState } from 'react';
import { BRAND, DIMENSIONS, SCENARIO } from '@zhian/shared';
import { useSessionStore } from '../stores/session';

export function Login() {
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
    <div className="app-shell" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="hazard" />
      <div className="login-wrap">
        <section className="login-hero">
          <div>
            <div className="brand">
              <div className="brand-mark">安</div>
              <span className="badge" style={{ background: 'transparent', color: '#cfd5e0', borderColor: '#39435a' }}>{BRAND.direction}</span>
            </div>
            <h1>{BRAND.name}</h1>
            <p>{BRAND.fullName}</p>
            <p style={{ marginTop: 18, fontSize: 13 }}>{SCENARIO.text}</p>
          </div>
          <div className="login-stages">
            {DIMENSIONS.map((dimension, index) => (
              <div key={dimension.key}><b>0{index + 1}</b>{dimension.label}</div>
            ))}
          </div>
        </section>

        <section className="login-panel">
          <form className="login-card" onSubmit={submit}>
            <h2>进入实验</h2>
            <p>24 步交互 · 约 4 学时 · 自动赋分与能力画像</p>
            <div className="field">
              <label htmlFor="username">账号</label>
              <input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">密码</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <button className="primary" style={{ width: '100%' }} type="submit" disabled={loading || !password}>
              {loading ? '登录中…' : '开始实验'}
            </button>
            {error ? <div className="error">{error}</div> : null}
            <div className="hint">演示账号见项目 README；正式使用请由管理员分配账号。</div>
          </form>
        </section>
      </div>
    </div>
  );
}
