import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSessionStore } from '../stores/session';

const ENV_LABEL: Record<string, string> = { mock: '模拟环境 · 合成数据', test: '官方测试环境', production: '实验空间正式环境' };
const STATE_LABEL: Record<string, string> = {
  sending: '提交中',
  accepted: '平台已接受',
  rejected: '平台拒绝',
  result_unknown: '结果未知，待对账',
  pending_retry: '平台未找到记录，可重新提交',
  blocked: '存在阻断项，未提交'
};
const ATTACHMENT_LABEL: Record<string, string> = {
  none: '—',
  pending: '待上传',
  accepted: '已上传',
  rejected: '上传失败',
  unknown: '结果未知',
  duplicate_reported: '平台提示已存在',
  missing_report: '报告文件缺失',
  too_large: '文件过大'
};

/** 实验空间同步：只在从实验空间进入的会话中显示；本地练习不受影响 */
export function IlabSyncBlock() {
  const ilab = useSessionStore((state) => state.ilab);
  const sync = useSessionStore((state) => state.ilabSync);
  const session = useSessionStore((state) => state.session);
  const refresh = useSessionStore((state) => state.refreshIlab);
  const finalize = useSessionStore((state) => state.finalizeIlab);
  const reconcile = useSessionStore((state) => state.reconcileIlab);
  const retryAttachment = useSessionStore((state) => state.retryIlabAttachment);
  const [confirming, setConfirming] = useState(false);
  const [pdfError, setPdfError] = useState('');

  useEffect(() => {
    void refresh();
  }, [refresh, session?.totalScore]);

  if (!ilab?.bound) return null;
  const readiness = ilab.readiness;
  const outbox = ilab.outbox;
  const accepted = outbox?.state === 'accepted';
  const loading = sync.status === 'loading';
  const blockers = sync.data?.blockers ?? readiness?.blockers ?? [];
  const warnings = sync.data?.warnings ?? readiness?.warnings ?? [];

  const openPdf = async () => {
    if (!session) return;
    setPdfError('');
    try {
      const blob = await api.ilabReportBlob(session.sessionId);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : '报告不可用');
    }
  };

  return (
    <section className="ilab-block" aria-live="polite">
      <header>
        <h3>实验空间同步</h3>
        <span className={`source-chip${ilab.synthetic ? ' warn' : ''}`}>{ENV_LABEL[ilab.environment ?? ''] ?? ilab.environment}</span>
      </header>
      {ilab.synthetic ? <p className="note warn">当前为本地模拟环境：所有记录都是合成数据，只用于功能验证，不会发送到实验空间。</p> : null}
      <dl className="kv">
        <div><dt>实验记录编号</dt><dd>{ilab.originId}</dd></div>
        <div><dt>实际交互步骤</dt><dd>{readiness?.interactionVerified ?? 0} / {readiness?.interactionCandidates ?? 23}（需 ≥ 20）</dd></div>
        <div><dt>导出整数总分</dt><dd>{readiness?.exportTotal ?? '—'}（原始分 {readiness?.rawTotal ?? '—'}{readiness?.scorePolicyConfirmed ? '' : '，口径待确认'}）</dd></div>
        <div><dt>回传状态</dt><dd>{outbox ? STATE_LABEL[outbox.state] ?? outbox.state : '未提交'}</dd></div>
        <div><dt>报告附件</dt><dd>{outbox ? ATTACHMENT_LABEL[outbox.attachmentState] ?? outbox.attachmentState : '—'}</dd></div>
        {outbox?.lastErrorSummary ? <div><dt>最近错误</dt><dd>{outbox.lastErrorCode}：{outbox.lastErrorSummary}</dd></div> : null}
      </dl>

      {!accepted && blockers.length ? (
        <div className="issue-list bad">
          <b>以下问题需处理后才能提交（不会自动补齐）：</b>
          <ul>{blockers.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
        </div>
      ) : null}
      {warnings.length ? (
        <details className="issue-list">
          <summary>提示 {warnings.length} 条</summary>
          <ul>{warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
        </details>
      ) : null}

      {sync.data && !sync.data.ok ? <p className="error-text">{sync.data.message}</p> : null}
      {sync.data?.ok ? <p className="ok-text">{sync.data.message}</p> : null}
      {sync.status === 'error' ? <p className="error-text">{sync.error}</p> : null}

      <div className="ilab-actions">
        {accepted ? (
          <>
            {outbox?.attachmentState !== 'accepted' && outbox?.attachmentState !== 'duplicate_reported' ? (
              <button type="button" className="ghost" disabled={loading} onClick={() => void retryAttachment()}>重新上传报告附件</button>
            ) : null}
            <span className="muted small">记录已被接受，本会话只读；如需重做请在任务记录中开始新的实验。</span>
          </>
        ) : outbox?.state === 'result_unknown' ? (
          <button type="button" className="ghost" disabled={loading} onClick={() => void reconcile()}>{loading ? '查询中…' : '查询平台确认结果'}</button>
        ) : confirming ? (
          <div className="confirm">
            <p>提交后本次实验的成绩、用时与 AI 使用情况将被冻结，平台接受后不可修改。确定结束实验并提交吗？</p>
            <button type="button" className="primary" disabled={loading} onClick={() => { setConfirming(false); void finalize(); }}>{loading ? '提交中…' : '确定结束并提交'}</button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>取消</button>
          </div>
        ) : (
          <button type="button" className="primary" disabled={loading || blockers.length > 0} onClick={() => setConfirming(true)}>
            {outbox?.state === 'pending_retry' ? '用同一记录编号重新提交' : '结束实验并提交到实验空间'}
          </button>
        )}
        {ilab.report ? <button type="button" className="ghost" onClick={() => void openPdf()}>查看报告 PDF</button> : null}
      </div>
      {pdfError ? <p className="error-text">{pdfError}</p> : null}
    </section>
  );
}
