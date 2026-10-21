import { useEffect, useState } from 'react';
import {
  AGENT_TOOLS,
  CONTENT_CASES,
  INJECTION_SAMPLES,
  SCENARIO,
  parseList,
  type AiReviewResponse,
  type ChartData,
  type StepDefinition,
  type StepResult
} from '@zhian/shared';
import { api, type ProfileItem } from '../api';
import { AgentConsoleScene, type AttackHop } from '../scenes/AgentConsoleScene';
import { LabRoomScene } from '../scenes/LabRoomScene';
import { SandboxScene, type CellState } from '../scenes/SandboxScene';
import { ChartView } from './ChartView';
import { FieldInput } from './FieldInput';

const PREVIEW_STEPS = new Set(['S06', 'S08', 'S13', 'S17', 'S19', 'S21']);

type Input = Record<string, number | string>;

interface Props {
  step: StepDefinition;
  input: Input;
  result: StepResult | null;
  sessionId?: number;
  onChange: (key: string, value: number | string) => void;
  onProfile: (profile: ProfileItem[]) => void;
}

function Scene({ step, input, result }: { step: StepDefinition; input: Input; result: StepResult | null }) {
  const ratio = result ? result.score / result.maxScore : null;

  if (step.scene === 'labRoom') {
    if (step.id === 'S04') {
      const ambient = Number(input.ambientC ?? 30);
      const checks = parseList(input.checks);
      const hazard = checks.includes('配备水基灭火器') || checks.includes('把饮料放在机柜顶部以便取用');
      return (
        <LabRoomScene
          racksOn={4}
          heat={ambient > 27 ? Math.min(1, (ambient - 27) / 8) : 0.05}
          alarm={hazard || ambient > 27}
          caption={`机房温度 ${ambient} °C${hazard ? ' · 存在安全隐患' : ''}`}
        />
      );
    }
    if (step.id === 'S18') {
      return (
        <LabRoomScene
          racksOn={ratio === null ? 0 : Math.round(ratio * 4)}
          heat={0.05}
          alarm={ratio !== null && ratio < 1}
          caption={ratio === null ? '提交后按你的顺序执行上电' : ratio < 1 ? '上电顺序有误，部分设备报警' : '全部设备按序上电成功'}
        />
      );
    }
    return (
      <LabRoomScene
        racksOn={4}
        heat={ratio === null ? 1 : 1 - ratio}
        alarm={ratio === null || ratio < 1}
        caption={ratio === null ? '空调故障：GPU 温度持续升高' : ratio < 1 ? '处置顺序存在风险' : '温度受控，事件已记录上报'}
      />
    );
  }

  if (step.scene === 'sandbox') {
    if (step.id === 'S14') {
      const flagged = new Set(parseList(input.flagged));
      const verdicts = (result?.result.verdicts as Array<{ text: string; injected: boolean }> | undefined) ?? null;
      const items = INJECTION_SAMPLES.map((label) => {
        let state: CellState = flagged.has(label) ? 'flagged' : 'neutral';
        const verdict = verdicts?.find((item) => item.text === label);
        if (verdict) state = verdict.injected === flagged.has(label) ? 'correct' : 'wrong';
        return { label, state };
      });
      return <SandboxScene items={items} caption={verdicts ? '绿色判断正确，红色判断错误' : '黄色为你标记的可疑输入'} />;
    }
    const items = CONTENT_CASES.map((label, index) => ({
      label,
      state: (String(input[`case${index + 1}`] ?? '正常回答') === '正常回答' ? 'neutral' : 'flagged') as CellState
    }));
    return <SandboxScene items={items} caption="黄色为将被拦截或转人工的请求" />;
  }

  if (step.scene === 'agentConsole') {
    const tools = AGENT_TOOLS.map((name) => ({ name, level: String(input[`tool_${name}`] ?? '自动允许') }));
    const attack = (result?.result.trace as AttackHop[] | undefined) ?? null;
    return (
      <AgentConsoleScene
        tools={tools}
        attack={attack}
        caption={attack ? (result?.result['攻击结果'] === '外发被拦截' ? '攻击被拦截' : '红色数据包成功外发') : '提交后模拟一次诱导外发攻击'}
      />
    );
  }
  return null;
}

export function StepWorkspace({ step, input, result, sessionId, onChange, onProfile }: Props) {
  const [chart, setChart] = useState<ChartData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [review, setReview] = useState<AiReviewResponse | null>(null);
  const [report, setReport] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setReview(null);
    setReport('');
    setLocalError('');
    setChart(null);
    setPreview(null);
  }, [step.id]);

  const inputKey = JSON.stringify(input);
  useEffect(() => {
    if (!PREVIEW_STEPS.has(step.id)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.preview(step.id, input)
        .then((data) => {
          if (cancelled) return;
          setChart(data.chart);
          setPreview(data.preview);
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step.id, inputKey]);

  const runReview = async () => {
    setBusy(true);
    setLocalError('');
    try {
      setReview(await api.review(step.id, input, sessionId));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '智能体评审失败');
    } finally {
      setBusy(false);
    }
  };

  const runReport = async () => {
    if (!sessionId) return;
    setBusy(true);
    setLocalError('');
    try {
      const data = await api.report(sessionId);
      setReport(data.contentMd);
      onProfile(data.profile);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '报告生成失败');
    } finally {
      setBusy(false);
    }
  };

  const wideKinds = new Set(['checklist', 'order', 'text']);

  return (
    <div>
      {step.seq === 1 ? (
        <div className="scenario"><b>{SCENARIO.title}</b>{SCENARIO.text}</div>
      ) : null}
      {step.material ? <div className="material">{step.material}</div> : null}

      <Scene step={step} input={input} result={result} />

      {chart ? <ChartView chart={chart} /> : null}
      {preview ? <div className="material"><b>实时脱敏预览：</b>{preview}</div> : null}

      {step.fields.length > 0 ? (
        <div className="form-grid">
          {step.fields.map((field) => {
            const id = `${step.id}-${field.key}`;
            const wide = wideKinds.has(field.kind) || field.label.length > 12;
            return (
              <div className={`field${wide ? ' wide' : ''}`} key={field.key}>
                {field.kind === 'checklist' || field.kind === 'order'
                  ? <span className="field-label">{field.label}</span>
                  : <label htmlFor={id}>{field.label}{field.unit ? `（${field.unit}）` : ''}</label>}
                <FieldInput id={id} field={field} value={input[field.key]} onChange={(value) => onChange(field.key, value)} />
              </div>
            );
          })}
        </div>
      ) : null}

      {step.type === 'ai' ? (
        <div style={{ marginTop: 16 }}>
          <button className="ghost" onClick={runReview} disabled={busy}>{busy ? '评审中…' : '请安全助手评审我的方案'}</button>
          {review ? (
            <div className="risks">
              <span className="badge">来源：{review.source === 'model' ? '大模型' : '规则引擎'}</span>
              {review.risks.map((risk, index) => (
                <div key={index} className={`risk ${risk.level}`}><b>{risk.item}</b>{risk.reason}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {step.type === 'auto' ? (
        <div>
          <button className="ghost" onClick={runReport} disabled={busy || !sessionId}>{busy ? '生成中…' : '生成实验报告'}</button>
          {report ? <pre className="report">{report}</pre> : null}
        </div>
      ) : null}

      {localError ? <div className="error">{localError}</div> : null}
    </div>
  );
}
