const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: '覆盖指令', pattern: /忽略(以上|之前|前面)?(所有|全部)?的?指令|ignore\s+(all\s+)?previous\s+instructions/i },
  { name: '角色越狱', pattern: /开发者模式|不受限制|不需要遵守|DAN\b/i },
  { name: '间接注入', pattern: /<!--[\s\S]*?-->/ },
  { name: '数据外发', pattern: /发送到\s*\S+@\S+/ },
  { name: '索取机密', pattern: /系统提示词|system\s+prompt|API\s*key/i }
];

export interface InjectionVerdict {
  text: string;
  injected: boolean;
  matched: string[];
}

export function detectInjection(text: string): InjectionVerdict {
  const matched = PATTERNS.filter((item) => item.pattern.test(text)).map((item) => item.name);
  return { text, injected: matched.length > 0, matched };
}
