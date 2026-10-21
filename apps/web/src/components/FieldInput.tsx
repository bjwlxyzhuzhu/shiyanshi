import { joinList, parseList, type StepField } from '@zhian/shared';

interface Props {
  id: string;
  field: StepField;
  value: number | string | undefined;
  onChange: (value: number | string) => void;
  disabled?: boolean;
}

function Checklist({ field, value, onChange, disabled }: Props) {
  const selected = new Set(parseList(value));
  const toggle = (option: string) => {
    if (selected.has(option)) selected.delete(option);
    else selected.add(option);
    onChange(joinList((field.options ?? []).filter((item) => selected.has(item))));
  };
  return (
    <div className="checklist" role="group" aria-label={field.label}>
      {(field.options ?? []).map((option) => (
        <label key={option} className={`check-row${selected.has(option) ? ' on' : ''}${disabled ? ' disabled' : ''}`}>
          <input type="checkbox" checked={selected.has(option)} disabled={disabled} onChange={() => toggle(option)} />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function OrderList({ field, value, onChange, disabled }: Props) {
  const items = parseList(value);
  const list = items.length ? items : field.options ?? [];
  const move = (index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(joinList(next));
  };
  return (
    <ol className="order-list" aria-label={field.label}>
      {list.map((item, index) => (
        <li key={item} className="order-row">
          <span className="num">{index + 1}</span>
          <span className="label">{item}</span>
          <button type="button" aria-label={`上移 ${item}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`下移 ${item}`} disabled={disabled || index === list.length - 1} onClick={() => move(index, 1)}>↓</button>
        </li>
      ))}
    </ol>
  );
}

export function FieldInput(props: Props) {
  const { id, field, value, onChange, disabled } = props;

  if (field.kind === 'checklist') return <Checklist {...props} />;
  if (field.kind === 'order') return <OrderList {...props} />;

  if (field.kind === 'select') {
    return (
      <select id={id} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  if (field.kind === 'number') {
    const hasRange = field.min !== undefined && field.max !== undefined;
    const numeric = value === '' || value === undefined ? '' : Number(value);
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={numeric}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
        {hasRange ? (
          <input
            type="range"
            aria-label={`${field.label} 滑块`}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={numeric === '' ? field.min : numeric}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        ) : null}
      </div>
    );
  }

  return <input id={id} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

