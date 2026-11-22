import * as axe from 'axe-core';

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/**
 * axe-core's findings under `root`, at the given impacts, as one readable line
 * each — so a failing expectation names the rule and where it broke.
 * `region` is off: a component rendered on its own has no page landmarks.
 */
export async function axeFindings(
  root: Element,
  impacts: AxeImpact[] = ['critical'],
  rules: Record<string, { enabled: boolean }> = {},
): Promise<string[]> {
  stillColours();
  const result = await axe.run(root, {
    resultTypes: ['violations'],
    rules: { region: { enabled: false }, ...rules },
  });
  return result.violations
    .filter((v) => impacts.includes((v.impact ?? 'minor') as AxeImpact))
    .map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} — ` +
        v.nodes
          .slice(0, 3)
          .map((n) => `${n.target.join(' ')} (${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 160)})`)
          .join(' | '),
    );
}

/**
 * Colour transitions off: right after a theme switch the browser is still
 * fading text from one colour to the other, and axe would measure halfway.
 */
function stillColours(): void {
  if (document.getElementById('axe-still-colours')) return;
  const style = document.createElement('style');
  style.id = 'axe-still-colours';
  style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.appendChild(style);
}

/** Runs `run` with the dark theme on, set as ThemeService sets it: `dark` on <html>, the dark page background on <body>. */
export async function inDarkTheme<T>(run: () => Promise<T>): Promise<T> {
  const html = document.documentElement;
  const had = html.classList.contains('dark');
  const hadBody = document.body.classList.contains('dark:bg-gray-900');
  html.classList.add('dark');
  document.body.classList.add('dark:bg-gray-900');
  try {
    return await run();
  } finally {
    if (!had) html.classList.remove('dark');
    if (!hadBody) document.body.classList.remove('dark:bg-gray-900');
  }
}
