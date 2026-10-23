import { useState } from 'react';
import { BRAND, passwordPolicyIssues } from '@zhian/shared';
import { api } from '../api';
import { useSessionStore } from '../stores/session';

/** 首次登录或密码被重置后强制修改；也可从管理后台主动打开 */
export function ChangePassword({ forced = true, onDone }: { forced?: boolean; onDone?: () => void }) {
  const user = useSessionStore((state) => state.user);
  const setUser = useSessionStore((state) => state.setUser);
  const logout = useSessionStore((state) => state.logout);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = newPassword ? passwordPolicyIssues(newPassword) : [];
  const mismatch = confirm.length > 0 && confirm !== newPassword;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.changePassword(oldPassword, newPassword);
      setUser(result.user);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-layer">
      <header className="login-brand">
        <span className="brand-mark" aria-hidden>安</span>
        <strong>{BRAND.name}</strong>
      </header>
      <section className="login-hero">
        <h1>{forced ? '请先修改初始密码' : '修改密码'}</h1>
        <p className="login-full">初始密码由管理员生成、只显示一次。修改后才能进入实验或管理后台，其他设备上的登录会被注销。</p>
      </section>
      <form className="login-card" onSubmit={submit} data-block-keys>
        <h2>{user?.username ?? ''}</h2>
        <div className="field">
          <label htmlFor="old-password">当前密码</label>
          <input id="old-password" type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-password">新密码</label>
          <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} aria-describedby="pw-policy" />
          <p id="pw-policy" className={`small ${issues.length ? 'error-text' : 'muted'}`}>
            {issues.length ? `还需要：${issues.join('、')}` : '至少 10 位，同时包含字母和数字，不能包含账号'}
          </p>
        </div>
        <div className="field">
          <label htmlFor="confirm-password">再次输入新密码</label>
          <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch ? <p className="small error-text">两次输入不一致</p> : null}
        </div>
        <button className="primary block" type="submit" disabled={busy || !oldPassword || !newPassword || issues.length > 0 || confirm !== newPassword}>
          {busy ? '提交中…' : '确认修改'}
        </button>
        {error ? <div className="error-text" role="alert">{error}</div> : null}
        {forced ? (
          <button type="button" className="ghost block" onClick={logout}>退出登录</button>
        ) : (
          <button type="button" className="ghost block" onClick={onDone}>取消</button>
        )}
      </form>
    </div>
  );
}
