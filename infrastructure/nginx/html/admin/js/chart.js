// Bar charts of the panel (activity per day, API usage). Plain HTML and CSS: the bars scale with
// the card and the labels stay sharp. Each chart carries a table with the same data for screen
// readers. niceScale is pure (tested in infrastructure/nginx/tests).
import { el } from './dom.js';

/**
 * Top of the axis and its ticks: a round number at or above `max` (1, 2, 2.5 or 5 times a power
 * of ten). Counts (`integer`) never get fractional ticks.
 */
export function niceScale(max, { ticks = 4, integer = true } = {}) {
  if (!(max > 0)) return { max: ticks, step: 1, ticks: Array.from({ length: ticks + 1 }, (_, index) => index) };
  const rough = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const factors = integer && magnitude < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = factors.map((factor) => factor * magnitude).find((candidate) => candidate >= rough);
  if (integer) step = Math.max(1, Math.round(step));
  // toPrecision drops the binary rounding of decimal steps (0.1 * 3 is 0.30000000000000004).
  const tidy = (value) => Number(value.toPrecision(12));
  const top = tidy(step * Math.ceil(tidy(max / step)));
  const values = [];
  for (let value = 0; value <= top + step / 2; value += step) values.push(tidy(value));
  return { max: top, step, ticks: values };
}

/**
 * bars: [{ label, values: [number, ...], title }]; series: [{ label, tone }] in the same order as
 * `values` (stacked from the bottom). format(value) writes the axis and the table.
 */
export function barChart({ bars, series, format = String, caption, integer = true }) {
  const totals = bars.map((bar) => bar.values.reduce((sum, value) => sum + value, 0));
  const scale = niceScale(Math.max(0, ...totals), { integer });
  const plot = el('div', { class: 'chart__plot', 'aria-hidden': 'true' });
  const axis = el('div', { class: 'chart__axis', 'aria-hidden': 'true' });
  for (const tick of [...scale.ticks].reverse()) {
    const line = el('span', { class: 'chart__tick' }, format(tick));
    axis.append(line);
  }
  const columns = el('div', { class: 'chart__columns' });
  // Labels that fit: up to 16 on wide charts, 8 on phones and 5 on the smallest ones, counted back
  // from the last bar so that today always has one (the tooltips and the table keep every day).
  const wideStep = Math.ceil(bars.length / 16);
  const narrowStep = Math.ceil(bars.length / 8);
  const compactStep = Math.ceil(bars.length / 5);
  bars.forEach((bar, index) => {
    const fromEnd = bars.length - 1 - index;
    const labelClass = ['chart__label',
      fromEnd % wideStep === 0 ? 'chart__label--wide' : null,
      fromEnd % narrowStep === 0 ? 'chart__label--narrow' : null,
      fromEnd % compactStep === 0 ? 'chart__label--compact' : null].filter(Boolean).join(' ');
    const stack = el('div', { class: 'chart__stack', title: bar.title ?? `${bar.label}: ${format(totals[index])}` });
    bar.values.forEach((value, part) => {
      if (value <= 0) return;
      const segment = el('span', { class: `chart__bar chart__bar--${series[part]?.tone ?? 'primary'}` });
      // CSSOM (not a style attribute): allowed by the panel's content security policy.
      segment.style.height = `${(value / scale.max) * 100}%`;
      stack.append(segment);
    });
    columns.append(el('div', { class: 'chart__column' }, el('div', { class: 'chart__track' }, stack),
      el('span', { class: labelClass }, bar.label)));
  });
  plot.append(axis, columns);

  const legend = series.length > 1
    ? el('ul', { class: 'chart__legend', 'aria-hidden': 'true' }, series.map((item) =>
      el('li', {}, el('span', { class: `chart__swatch chart__bar--${item.tone}` }), item.label)))
    : null;

  const data = el('table', { class: 'sr-only' },
    el('caption', {}, caption),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Día'),
      series.map((item) => el('th', { scope: 'col' }, item.label)))),
    el('tbody', {}, bars.map((bar) => el('tr', {}, el('th', { scope: 'row' }, bar.label),
      bar.values.map((value) => el('td', {}, format(value)))))));

  return el('figure', { class: 'chart' }, plot, legend, data);
}
