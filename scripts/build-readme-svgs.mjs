// Generates every SVG in assets/readme/ and README.md from scripts/products.json.
// Run with `npm run build`. Fonts are subset per SVG and embedded as base64 WOFF2,
// images are downscaled and embedded as data URIs, so each SVG is self-contained.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as fontkit from 'fontkit';
import subsetFont from 'subset-font';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets/readme');
const data = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/products.json'), 'utf8'));

const W = 880;

// Every SVG is built once per theme; README.md swaps them with <picture> + prefers-color-scheme,
// which GitHub resolves from the viewer's GitHub theme setting.
// Accent: [color, border, fill]
const THEMES = {
  dark: {
    suffix: '',
    A: {
      t: ['#00f5d4', 'rgba(0,245,212,.3)', 'rgba(0,245,212,.08)'],
      p: ['#f72585', 'rgba(247,37,133,.35)', 'rgba(247,37,133,.1)'],
      y: ['#fee440', 'rgba(254,228,64,.3)', 'rgba(254,228,64,.08)'],
      v: ['#7b61ff', 'rgba(123,97,255,.4)', 'rgba(123,97,255,.12)'],
      g: ['#3fce4e', 'rgba(63,206,78,.3)', 'rgba(63,206,78,.08)'],
    },
    C: {
      page: '#0d1117',
      bgHero: '#06060b',
      card: '#09090b',
      bar: '#111116',
      chip: '#18181b',
      border: '#27272a',
      borderStrong: '#3f3f46',
      heading: '#fafafa',
      text2: '#e4e4e7',
      code: '#d4d4d8',
      body: '#a1a1aa',
      meta: '#71717a',
      teal: '#00f5d4',
      tealHover: '#5ffbe6',
      pink: '#f72585',
      yellow: '#fee440',
      violet: '#7b61ff',
      green: '#3fce4e',
      button: '#00f5d4',
      onButton: '#18181b',
      pillFill: 'rgba(0,245,212,.06)',
      pillBorder: 'rgba(0,245,212,.3)',
      photoPill: 'rgba(6,6,11,.8)',
      dot: 'rgba(255,255,255,.05)',
      glowTeal: 0.12,
      glowIndigo: 0.12,
      glowFooter: 0.14,
      techBg: 'rgba(39,39,42,.3)',
      techBorder: 'rgba(63,63,70,.4)',
      techText: '#a1a1aa',
    },
    // Brand colors that disappear on one background get swapped
    brand: {},
  },
  light: {
    suffix: '-light',
    A: {
      t: ['#0f766e', 'rgba(15,118,110,.3)', 'rgba(15,118,110,.08)'],
      p: ['#be185d', 'rgba(190,24,93,.3)', 'rgba(190,24,93,.08)'],
      y: ['#a16207', 'rgba(161,98,7,.3)', 'rgba(161,98,7,.08)'],
      v: ['#6d28d9', 'rgba(109,40,217,.3)', 'rgba(109,40,217,.08)'],
      g: ['#15803d', 'rgba(21,128,61,.3)', 'rgba(21,128,61,.08)'],
    },
    C: {
      page: '#ffffff',
      bgHero: '#fafafa',
      card: '#ffffff',
      bar: '#f4f4f5',
      chip: '#f4f4f5',
      border: '#e4e4e7',
      borderStrong: '#d4d4d8',
      heading: '#18181b',
      text2: '#27272a',
      code: '#3f3f46',
      body: '#52525b',
      meta: '#71717a',
      teal: '#0f766e',
      tealHover: '#0d9488',
      pink: '#be185d',
      yellow: '#a16207',
      violet: '#6d28d9',
      green: '#16a34a',
      button: '#00f5d4',
      onButton: '#18181b',
      pillFill: 'rgba(15,118,110,.06)',
      pillBorder: 'rgba(15,118,110,.3)',
      photoPill: 'rgba(255,255,255,.88)',
      dot: 'rgba(0,0,0,.07)',
      glowTeal: 0.16,
      glowIndigo: 0.1,
      glowFooter: 0.2,
      techBg: 'rgba(244,244,245,.8)',
      techBorder: 'rgba(228,228,231,.8)',
      techText: '#52525b',
    },
    brand: { '#9FEAF9': '#47848F' },
  },
};
let A;
let C;
let BRAND;
function setTheme(name) {
  ({ A, C, brand: BRAND } = THEMES[name]);
}
setTheme('dark');

// ---------- fonts ----------

const fs_ = (pkg, file) => path.join(ROOT, 'node_modules/@fontsource', pkg, 'files', file);
const FONT_FILES = {
  syne400: fs_('syne', 'syne-latin-400-normal.woff2'),
  syne700: fs_('syne', 'syne-latin-700-normal.woff2'),
  serif: fs_('libre-baskerville', 'libre-baskerville-latin-400-italic.woff2'),
  mono: fs_('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'),
  // Inter comes from local OTFs because the fontsource latin subset lacks → and ↗
  inter400: path.join(ROOT, 'scripts/fonts/Inter-Regular.otf'),
  inter500: path.join(ROOT, 'scripts/fonts/Inter-Medium.otf'),
  inter600: path.join(ROOT, 'scripts/fonts/Inter-SemiBold.otf'),
};
const FONTS = {};
for (const [key, file] of Object.entries(FONT_FILES)) {
  const buf = await fs.readFile(file);
  FONTS[key] = { buf, font: fontkit.create(buf) };
}

const family = key => `f-${key}`;
const em = (key, size) => size / FONTS[key].font.unitsPerEm;

// Advance widths per character (ligatures off so glyphs map 1:1 to chars), plus CSS letter-spacing.
function advances(key, size, str, ls = 0) {
  const run = FONTS[key].font.layout(str, { liga: false, clig: false, calt: false });
  if (run.positions.length !== [...str].length) throw new Error(`glyph/char mismatch in "${str}"`);
  return run.positions.map(p => p.xAdvance * em(key, size) + ls);
}
const measure = (key, size, str, ls = 0) => advances(key, size, str, ls).reduce((a, b) => a + b, 0);

// CSS `line-height: normal`
function normalLH(key, size) {
  const f = FONTS[key].font;
  return (f.ascent - f.descent + f.lineGap) * em(key, size);
}
// Baseline of a line box of height `lh` whose top is at `top`
function baseline(key, size, top, lh = normalLH(key, size)) {
  const f = FONTS[key].font;
  const content = (f.ascent - f.descent) * em(key, size);
  return top + (lh - content) / 2 + f.ascent * em(key, size);
}

function wrap(key, size, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(key, size, next) > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- svg document ----------

const n2 = n => +n.toFixed(2);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class Doc {
  constructor(w, h = 0) {
    this.w = w;
    this.h = h;
    this.chars = new Map();
    this.defs = [];
    this.css = [];
    this.body = [];
    this.n = 0;
  }
  id(prefix = 'i') {
    return `${prefix}${this.n++}`;
  }
  use(key, str) {
    if (!this.chars.has(key)) this.chars.set(key, new Set(' '));
    for (const c of str) this.chars.get(key).add(c);
  }
  text(key, size, str, x, y, { fill = C.heading, ls = 0, attrs = '' } = {}) {
    this.use(key, str);
    const spacing = ls ? ` letter-spacing="${n2(ls)}"` : '';
    return `<text x="${n2(x)}" y="${n2(y)}" font-family="${family(key)}" font-size="${size}" fill="${fill}"${spacing}${attrs}>${esc(str)}</text>`;
  }
  tspan(key, str, fill) {
    this.use(key, str);
    return `<tspan font-family="${family(key)}" fill="${fill}">${esc(str)}</tspan>`;
  }
  add(...parts) {
    this.body.push(...parts);
  }
  async render() {
    const faces = [];
    for (const [key, set] of this.chars) {
      const woff2 = await subsetFont(FONTS[key].buf, [...set].join(''), { targetFormat: 'woff2' });
      faces.push(`@font-face{font-family:${family(key)};src:url(data:font/woff2;base64,${woff2.toString('base64')}) format('woff2')}`);
    }
    const style = `<style>${[...faces, ...this.css].join('')}</style>`;
    const h = Math.ceil(this.h);
    // Optional page-colored backdrop: invisible on GitHub dark, keeps light text legible on GitHub light
    const bg = this.bg ? rect(0, 0, this.w, h, 14, `fill="${this.bg}"`) : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${h}" viewBox="0 0 ${this.w} ${h}">${style}<defs>${this.defs.join('')}</defs>${bg}${this.body.join('')}</svg>\n`;
  }
}

const rect = (x, y, w, h, r, attrs) => `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" rx="${n2(r)}" ${attrs}/>`;
// 1px stroke drawn inside the box, like a CSS border
const border = (x, y, w, h, r, color) => rect(x + 0.5, y + 0.5, w - 1, h - 1, Math.max(r - 0.5, 0), `fill="none" stroke="${color}"`);

const imageCache = new Map();
async function imageURI(file, w, h, { format = 'png', position = 'top' } = {}) {
  const k = `${file}|${w}|${h}|${format}`;
  if (imageCache.has(k)) return imageCache.get(k);
  // 2x for retina; cover-cropped here so the SVG needs no preserveAspectRatio tricks
  let img = sharp(path.join(ROOT, file), { density: 300 }).resize(Math.round(w * 2), Math.round(h * 2), { fit: 'cover', position });
  img = format === 'jpeg' ? img.jpeg({ quality: 82, mozjpeg: true }) : img.png({ palette: true, quality: 92, compressionLevel: 9 });
  const uri = `data:image/${format};base64,${(await img.toBuffer()).toString('base64')}`;
  imageCache.set(k, uri);
  return uri;
}

async function image(doc, file, x, y, w, h, r, opts) {
  const clip = doc.id('c');
  doc.defs.push(`<clipPath id="${clip}">${rect(x, y, w, h, r, '')}</clipPath>`);
  return `<image href="${await imageURI(file, w, h, opts)}" x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" clip-path="url(#${clip})"/>`;
}

// Rounded card with every child clipped to its corners
function cardFrame(doc, w, h, r, fill, inner, stroke = C.border) {
  const clip = doc.id('card');
  doc.defs.push(`<clipPath id="${clip}">${rect(0, 0, w, h, r, '')}</clipPath>`);
  return `<g clip-path="url(#${clip})">${rect(0, 0, w, h, r, `fill="${fill}"`)}${inner}</g>${border(0, 0, w, h, r, stroke)}`;
}

// Ellipse glow equivalent to CSS radial-gradient(ellipse rx ry at cx cy, color, transparent 70%)
function glow(doc, w, h, { cx, cy, rx, ry, color, alpha }) {
  const id = doc.id('g');
  doc.defs.push(
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${n2(cx * w)} ${n2(cy * h)}) scale(${n2(rx * w)} ${n2(ry * h)})">` +
      `<stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset=".7" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  return `<rect width="${w}" height="${n2(h)}" fill="url(#${id})"/>`;
}

// Chip with text vertically centered in a box of height `h`
function chip(doc, key, size, str, x, y, { padX, padY, ls = 0, color, fill = 'none', stroke, r = 5 }) {
  const lh = normalLH(key, size);
  const w = measure(key, size, str, ls) + padX * 2 + (stroke ? 2 : 0);
  const h = lh + padY * 2 + (stroke ? 2 : 0);
  const off = stroke ? 1 : 0;
  const bg = rect(x, y, w, h, r, `fill="${fill}"`) + (stroke ? border(x, y, w, h, r, stroke) : '');
  return { w, h, svg: bg + doc.text(key, size, str, x + off + padX, baseline(key, size, y + off + padY, lh), { fill: color, ls }) };
}

// Lays chips out left to right, wrapping at maxW
function chipRow(doc, items, x, y, maxW, gap, make) {
  let cx = x;
  let cy = y;
  let rowH = 0;
  const out = [];
  for (const item of items) {
    let c = make(cx, cy, item);
    if (cx > x && cx + c.w > x + maxW) {
      cx = x;
      cy += rowH + gap;
      rowH = 0;
      c = make(cx, cy, item);
    }
    out.push(c.svg);
    cx += c.w + gap;
    rowH = Math.max(rowH, c.h);
  }
  return { svg: out.join(''), h: cy + rowH - y };
}

function button(doc, label, { primary, h = 44 }) {
  const key = primary ? 'inter600' : 'inter500';
  const padX = primary ? 18 : 16;
  const w = Math.ceil(measure(key, 14, label) + padX * 2);
  doc.w = w;
  doc.h = h;
  // The secondary button is "transparent" on GitHub dark; a solid page-colored fill keeps it legible on the light theme.
  doc.add(primary ? rect(0, 0, w, h, 8, `fill="${C.button}"`) : rect(0, 0, w, h, 8, `fill="${C.page}"`) + border(0, 0, w, h, 8, C.borderStrong));
  doc.add(doc.text(key, 14, label, padX, baseline(key, 14, 0, h), { fill: primary ? C.onButton : C.text2 }));
  return doc;
}

// ---------- typewriter ----------

// Replays the mock's setTimeout loop; t=0 is the instant the first word finishes typing.
function typeTimeline(words) {
  let s = { li: 0, ci: words[0].length, del: false };
  let t = 0;
  let delay = 70;
  const states = [{ t: 0, li: 0, ci: s.ci }];
  for (;;) {
    t += delay;
    const w = words[s.li];
    let next;
    delay = s.del ? 35 : 70;
    if (!s.del && s.ci < w.length) next = { ci: s.ci + 1 };
    else if (!s.del) {
      next = { del: true };
      delay = 1800;
    } else if (s.ci > 0) next = { ci: s.ci - 1 };
    else {
      next = { del: false, li: (s.li + 1) % words.length };
      delay = 250;
    }
    s = { ...s, ...next };
    if (s.li === 0 && s.ci === words[0].length && 'ci' in next) return { T: t, states };
    states.push({ t, li: s.li, ci: s.ci });
  }
}

// @keyframes from a per-state value; step-end holds each value until the next change
function keyframes(name, states, T, valueOf) {
  const frames = [];
  let prev;
  for (const st of states) {
    const v = valueOf(st);
    if (v !== prev) frames.push(`${n2((st.t / T) * 100)}%{${v}}`);
    prev = v;
  }
  return `@keyframes ${name}{${frames.join('')}}`;
}

// ---------- sections ----------

async function hero(productCount) {
  const doc = new Doc(W);
  const P = 32;
  const parts = [];

  // Top row: logo + availability pill
  const logoSrc = (await fs.readFile(path.join(ROOT, 'assets/logo.svg'), 'utf8'))
    .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/(id="|url\(#)(\w+)/g, '$1logo-$2');
  parts.push(`<svg x="${P}" y="${P}" width="26" height="26" viewBox="0 0 48 48" fill="none">${logoSrc}</svg>`);

  const rowMid = P + 13;
  const pillText = 'Full-stack developer · ready to build';
  const pillLH = normalLH('mono', 11);
  const pillW = 1 + 11 + 7 + 8 + measure('mono', 11, pillText, 0.66) + 11 + 1;
  const pillH = pillLH + 12;
  const pillX = W - P - pillW;
  const pillY = rowMid - pillH / 2;
  parts.push(
    rect(pillX, pillY, pillW, pillH, pillH / 2, `fill="${C.pillFill}"`),
    border(pillX, pillY, pillW, pillH, pillH / 2, C.pillBorder),
    `<circle class="pulse" cx="${n2(pillX + 12 + 3.5)}" cy="${n2(rowMid)}" r="3.5" fill="${C.teal}"/>`,
    doc.text('mono', 11, pillText, pillX + 12 + 7 + 8, baseline('mono', 11, pillY + 6, pillLH), { fill: C.teal, ls: 0.66 }),
  );
  doc.css.push('@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}.pulse{animation:pulse 2s ease-in-out infinite}');

  // H1 with typewriter
  const h1Top = P + 26 + 40;
  const ls = -1.6;
  parts.push(doc.text('syne700', 80, 'Got an idea?', P, baseline('syne700', 80, h1Top, 80), { ls }));
  const line2 = baseline('syne700', 80, h1Top + 80, 80);
  parts.push(doc.text('syne700', 80, "I'll ", P, line2, { fill: C.teal, ls }));
  const typeX = P + measure('syne700', 80, "I'll ", ls);
  const words = ['prototype it.', 'build it.', 'ship it.', 'scale it.'];
  const { T, states } = typeTimeline(words);
  const dur = `${n2(T / 1000)}s`;
  const prefixW = words.map(w => {
    const adv = advances('syne700', 80, w, ls);
    return adv.reduce((acc, a) => [...acc, acc.at(-1) + a], [0]);
  });
  words.forEach((w, wi) => {
    [...w].forEach((ch, ci) => {
      if (ch === ' ') return;
      const cls = `w${wi}c${ci}`;
      doc.css.push(
        keyframes(cls, states, T, st => `opacity:${st.li === wi && st.ci > ci ? 1 : 0}`),
        `.${cls}{animation:${cls} ${dur} step-end infinite}`,
      );
      // Static state (reduced motion / no animation) shows "prototype it."
      parts.push(doc.text('syne700', 80, ch, typeX + prefixW[wi][ci], line2, { fill: C.teal, attrs: ` class="${cls}" opacity="${wi === 0 ? 1 : 0}"` }));
    });
  });
  const fullW = prefixW[0].at(-1);
  doc.css.push(
    keyframes('cpos', states, T, st => `transform:translateX(${n2(prefixW[st.li][st.ci] - fullW)}px)`),
    '@keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}',
    `.cursor{animation:cpos ${dur} step-end infinite,blink 1s step-end infinite}`,
    '@media (prefers-reduced-motion:reduce){.pulse,.cursor,[class^="w"]{animation:none}}',
  );
  parts.push(doc.text('syne400', 80, '|', typeX + fullW + 3.2, line2, { fill: C.teal, attrs: ' class="cursor"' }));

  // Subline
  let y = h1Top + 160 + 18;
  const subLH = 26 * 1.35;
  for (const line of wrap('serif', 26, 'From napkin sketch to working prototype — in under two days.', W - P * 2)) {
    parts.push(doc.text('serif', 26, line, P, baseline('serif', 26, y, subLH), { fill: C.body }));
    y += subLH;
  }

  // Body copy with bold runs
  y += 18;
  const reg = { key: 'inter400', fill: C.body };
  const bold = { key: 'inter600', fill: C.heading };
  const segs = [
    { ...reg, text: 'Timothy Murphy — a full-stack developer who turns your vision into reality. Need a ' },
    { ...bold, text: 'web app' },
    { ...reg, text: ', ' },
    { ...bold, text: 'mobile app' },
    { ...reg, text: ', or ' },
    { ...bold, text: 'desktop tool' },
    { ...reg, text: '? I ship fast across every platform.' },
  ];
  const tokens = [[]];
  for (const seg of segs) {
    seg.text.split(' ').forEach((p, i) => {
      if (i > 0) tokens.push([]);
      if (p) tokens.at(-1).push({ ...seg, text: p });
    });
  }
  const wordsB = tokens.filter(t => t.length);
  const wordW = wd => wd.reduce((a, r) => a + measure(r.key, 15, r.text), 0);
  const space = measure('inter400', 15, ' ');
  const lines = [[]];
  let lineW = 0;
  for (const wd of wordsB) {
    const ww = wordW(wd);
    if (lines.at(-1).length && lineW + space + ww > 560) {
      lines.push([]);
      lineW = 0;
    }
    lineW += (lines.at(-1).length ? space : 0) + ww;
    lines.at(-1).push(wd);
  }
  for (const line of lines) {
    const runs = [];
    line.forEach((wd, wi) => {
      wd.forEach((r, ri) => {
        const text = r.text + (wi < line.length - 1 && ri === wd.length - 1 ? ' ' : '');
        const last = runs.at(-1);
        if (last && last.key === r.key) last.text += text;
        else runs.push({ ...r, text });
      });
    });
    const spans = runs.map(r => doc.tspan(r.key, r.text, r.fill)).join('');
    parts.push(`<text x="${P}" y="${n2(baseline('inter400', 15, y, 24))}" font-size="15">${spans}</text>`);
    y += 24;
  }

  // Stat strip
  y += 36;
  const stripTop = y;
  const valLH = normalLH('syne700', 32);
  const labLH = normalLH('mono', 11);
  const stripH = 18 + valLH + labLH + 18;
  const colW = W / 3;
  const stats = [
    ['< 48h', 'first draft'],
    ['15+', 'years shipping'],
    [String(productCount), 'live products'],
  ];
  parts.push(`<rect x="0" y="${n2(stripTop)}" width="${W}" height="1" fill="${C.border}"/>`);
  stats.forEach(([v, l], i) => {
    const x = colW * i + 32;
    if (i) parts.push(`<rect x="${n2(colW * i - 1)}" y="${n2(stripTop)}" width="1" height="${n2(stripH)}" fill="${C.border}"/>`);
    parts.push(
      doc.text('syne700', 32, v, x, baseline('syne700', 32, stripTop + 1 + 18, valLH)),
      doc.text('mono', 11, l.toUpperCase(), x, baseline('mono', 11, stripTop + 1 + 18 + valLH, labLH), { fill: C.meta, ls: 0.88 }),
    );
  });
  doc.h = stripTop + 1 + stripH;

  // Background layers
  const dots = doc.id('dots');
  doc.defs.push(`<pattern id="${dots}" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1" fill="${C.dot}"/></pattern>`);
  const bg =
    `<rect width="${W}" height="${n2(doc.h)}" fill="url(#${dots})"/>` +
    glow(doc, W, doc.h, { cx: 0.85, cy: 0, rx: 0.6, ry: 0.7, color: '#00f5d4', alpha: C.glowTeal }) +
    glow(doc, W, doc.h, { cx: 0, cy: 1, rx: 0.5, ry: 0.6, color: '#6366f1', alpha: C.glowIndigo });
  doc.add(cardFrame(doc, W, doc.h, 14, C.bgHero, bg + parts.join('')));
  return doc;
}

// Section header with ~56px section gap baked in above (GitHub adds 16px paragraph margin)
function header(num, title, { sub, divider = false } = {}) {
  const doc = new Doc(W);
  doc.bg = C.page;
  if (divider) {
    const id = doc.id('div');
    doc.defs.push(
      `<linearGradient id="${id}"><stop offset="0" stop-color="${C.teal}" stop-opacity="0"/><stop offset=".5" stop-color="${C.teal}"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></linearGradient>`,
    );
    doc.add(`<rect x="0" y="12" width="${W}" height="1" fill="url(#${id})" opacity=".3"/>`);
  }
  const top = 40;
  const titleLH = normalLH('syne700', 32);
  const base = baseline('syne700', 32, top, titleLH);
  const numW = measure('mono', 14, num);
  doc.add(doc.text('mono', 14, num, 0, base, { fill: C.teal }), doc.text('syne700', 32, title, numW + 12, base));
  let y = top + titleLH;
  if (sub) {
    const lh = normalLH('inter400', 14.5);
    doc.add(doc.text('inter400', 14.5, sub, 0, baseline('inter400', 14.5, y + 6, lh), { fill: C.body }));
    y += 6 + lh;
  }
  doc.h = y + 4;
  return { doc, bottom: y };
}

async function featured(p) {
  const f = p.featured;
  const doc = new Doc(W);
  const colW = W / 2;
  const pad = 24;
  const x = colW + pad;
  const innerW = colW - pad * 2;
  const parts = [];
  let y = pad;

  const tags = chipRow(doc, f.tags, x, y, innerW, 6, (cx, cy, [n, k]) => chip(doc, 'mono', 11, n, cx, cy, { padX: 7, padY: 2, color: A[k][0], stroke: A[k][1] }));
  parts.push(tags.svg);
  y += tags.h + 12;

  parts.push(await image(doc, p.icon, x, y, 40, 40, 10));
  parts.push(doc.text('syne700', 24, p.name, x + 52, baseline('syne700', 24, y + 20 - normalLH('syne700', 24) / 2)));
  y += 40 + 12;

  const kLH = normalLH('mono', 11);
  parts.push(doc.text('mono', 11, f.kicker.toUpperCase(), x, baseline('mono', 11, y, kLH), { fill: C.meta, ls: 0.88 }));
  y += kLH + 12;

  const dLH = 14.5 * 1.6;
  for (const line of wrap('inter400', 14.5, f.desc, innerW)) {
    parts.push(doc.text('inter400', 14.5, line, x, baseline('inter400', 14.5, y, dLH), { fill: C.body }));
    y += dLH;
  }
  y += 12;

  const lLH = normalLH('inter600', 14);
  parts.push(doc.text('inter600', 14, 'View live site ↗', x, baseline('inter600', 14, y, lLH), { fill: C.teal }));
  y += lLH + pad;

  doc.h = Math.max(220, y);
  const shot = `${rect(0, 0, colW, doc.h, 0, `fill="${C.chip}"`)}<image href="${await imageURI(f.shot, colW, doc.h)}" width="${colW}" height="${n2(doc.h)}"/>`;
  doc.add(cardFrame(doc, W, doc.h, 14, C.card, shot + parts.join('')));
  return doc;
}

const CARD_W = 280;

function cardLayout(p) {
  const inner = CARD_W - 32;
  return { lines: wrap('inter400', 13.5, p.desc, inner) };
}

async function card(p, cardH) {
  const doc = new Doc(CARD_W, cardH);
  const pad = 16;
  const inner = CARD_W - pad * 2;
  const parts = [];

  parts.push(await image(doc, p.icon, pad, pad, 36, 36, 9));
  parts.push(doc.text('syne700', 16, p.name, pad + 46, baseline('syne700', 16, pad + 18 - normalLH('syne700', 16) / 2)));
  const label = p.platform.toUpperCase();
  const chipW = measure('mono', 10, label, 0.6) + 14;
  const chipH = normalLH('mono', 10) + 6;
  const c = chip(doc, 'mono', 10, label, CARD_W - pad - chipW, pad + 18 - chipH / 2, { padX: 7, padY: 3, ls: 0.6, color: A[p.accent][0], fill: A[p.accent][2] });
  parts.push(c.svg);

  let y = pad + 36 + 10;
  const dLH = 13.5 * 1.55;
  for (const line of cardLayout(p).lines) {
    parts.push(doc.text('inter400', 13.5, line, pad, baseline('inter400', 13.5, y, dLH), { fill: C.body }));
    y += dLH;
  }

  // Tags pinned to the bottom, like the mock's flex:1 description
  const tagH = normalLH('mono', 11) + 4;
  const tags = chipRow(doc, p.tags, pad, cardH - pad - tagH, inner, 5, (cx, cy, t) => chip(doc, 'mono', 11, t, cx, cy, { padX: 7, padY: 2, color: C.body, fill: C.chip }));
  parts.push(tags.svg);
  doc.add(cardFrame(doc, CARD_W, cardH, 12, C.card, parts.join('')));
  return doc;
}

async function about() {
  const doc = new Doc(W);
  const gap = 16;
  const colW = (W - gap) / 2;
  const K = C.pink,
    Y = C.yellow,
    V = C.violet,
    S = C.teal,
    M = C.tealHover,
    D = C.code;
  const code = [
    [
      ['class', K],
      [' ', D],
      ['Developer', Y],
      [' ', D],
      ['extends', K],
      [' ', D],
      ['Human', Y],
    ],
    [['{', D]],
    [
      ['  public', K],
      [' ', D],
      ['$name', V],
      [' = ', D],
      ["'Timothy Murphy'", S],
      [';', D],
    ],
    [
      ['  public', K],
      [' ', D],
      ['$role', V],
      [' = ', D],
      ["'Full Stack Developer'", S],
      [';', D],
    ],
    [
      ['  public', K],
      [' ', D],
      ['$years', V],
      [' = ', D],
      ['15', Y],
      [';', D],
    ],
    [],
    [
      ['  public function', K],
      [' ', D],
      ['getCurrentFocus', M],
      ['()', D],
    ],
    [['  {', D]],
    [
      ['    return', K],
      [' ', D],
      ["'You bring the vision.", S],
    ],
    [
      ["            I handle the code.'", S],
      [';', D],
    ],
    [['  }', D]],
    [['}', D]],
  ];

  // Code window
  const barLH = normalLH('mono', 12);
  const barH = 10 + barLH + 10;
  const lineH = 12.5 * 1.75;
  const H = 1 + barH + 1 + 18 + code.length * lineH + 18 + 1;
  doc.h = H;
  const charW = measure('mono', 12.5, 'x');
  const parts = [`<rect x="0" y="0" width="${n2(colW)}" height="${n2(barH + 1)}" fill="${C.bar}"/>`, `<rect x="0" y="${n2(barH + 1)}" width="${n2(colW)}" height="1" fill="${C.border}"/>`];
  const barMid = 1 + barH / 2;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => parts.push(`<circle cx="${15 + 5 + i * 17}" cy="${n2(barMid)}" r="5" fill="${c}"/>`));
  parts.push(doc.text('mono', 12, 'Developer.php', 15 + 3 * 10 + 2 * 7 + 10, baseline('mono', 12, barMid - barLH / 2, barLH), { fill: C.meta }));
  code.forEach((tokens, i) => {
    if (!tokens.length) return;
    // Leading indentation becomes an x offset so SVG whitespace collapsing can't eat it
    const indent = tokens[0][0].match(/^ */)[0].length;
    const toks = tokens.map(([t, c], j) => [j === 0 ? t.slice(indent) : t, c]);
    const spans = toks.map(([t, c]) => doc.tspan('mono', t, c)).join('');
    const y = baseline('mono', 12.5, 1 + barH + 1 + 18 + i * lineH, lineH);
    parts.push(`<text x="${n2(21 + indent * charW)}" y="${n2(y)}" font-size="12.5" xml:space="preserve">${spans}</text>`);
  });
  const clip = doc.id('code');
  doc.defs.push(`<clipPath id="${clip}">${rect(0, 0, colW, H, 12, '')}</clipPath>`);
  doc.add(`<g clip-path="url(#${clip})">${rect(0, 0, colW, H, 12, `fill="${C.card}"`)}${parts.join('')}</g>${border(0, 0, colW, H, 12, C.border)}`);

  // Photo
  const px = colW + gap;
  doc.add(rect(px, 0, colW, H, 12, `fill="${C.chip}"`), await image(doc, 'assets/profile.jpg', px, 0, colW, H, 12, { format: 'jpeg', position: 'centre' }), border(px, 0, colW, H, 12, C.border));
  const pillText = 'Currently available';
  const pLH = normalLH('mono', 11);
  const pillH = pLH + 12;
  const pillW = 1 + 10 + 7 + 7 + measure('mono', 11, pillText) + 10 + 1;
  const pillX = px + 12;
  const pillY = H - 12 - pillH;
  doc.add(
    rect(pillX, pillY, pillW, pillH, pillH / 2, `fill="${C.photoPill}"`),
    border(pillX, pillY, pillW, pillH, pillH / 2, C.border),
    `<circle cx="${n2(pillX + 11 + 3.5)}" cy="${n2(pillY + pillH / 2)}" r="3.5" fill="${C.green}"/>`,
    doc.text('mono', 11, pillText, pillX + 11 + 7 + 7, baseline('mono', 11, pillY + 6, pLH), { fill: C.text2 }),
  );
  return doc;
}

// "What I build with" grid, matching the tech cards in idevtim-site's About section.
// Icons use their brand color (the site's hover state) since GitHub has no hover.
function stack() {
  const { doc, bottom } = header('04.', 'What I build with');
  const techs = data.technologies;
  const cols = 5;
  const gap = 12;
  const cardW = (W - gap * (cols - 1)) / cols;
  const nameLH = normalLH('mono', 12);
  const cardH = 20 + 32 + 10 + nameLH + 20;
  const y0 = bottom + 20;
  techs.forEach((t, i) => {
    const x = (i % cols) * (cardW + gap);
    const y = y0 + Math.floor(i / cols) * (cardH + gap);
    const nameW = measure('mono', 12, t.name);
    doc.add(
      rect(x, y, cardW, cardH, 12, `fill="${C.techBg}"`),
      border(x, y, cardW, cardH, 12, C.techBorder),
      `<path d="${t.svg}" fill="${BRAND[t.color] ?? t.color}" transform="translate(${n2(x + cardW / 2 - 16)} ${y + 20}) scale(${32 / 24})"/>`,
      doc.text('mono', 12, t.name, x + (cardW - nameW) / 2, baseline('mono', 12, y + 20 + 32 + 10, nameLH), { fill: C.techText }),
    );
  });
  doc.h = y0 + Math.ceil(techs.length / cols) * (cardH + gap) - gap;
  return doc;
}

function footer() {
  const doc = new Doc(W);
  const P = 32;
  const kLH = normalLH('mono', 11);
  const tLH = 40 * 1.05;
  const sLH = normalLH('serif', 24);
  doc.h = P + kLH + 8 + tLH + 8 + sLH + P;
  const parts = [glow(doc, W, doc.h, { cx: 1, cy: 1, rx: 0.7, ry: 1.2, color: '#00f5d4', alpha: C.glowFooter })];
  let y = P;
  parts.push(doc.text('mono', 11, 'READY TO BUILD', P, baseline('mono', 11, y, kLH), { fill: C.teal, ls: 1.1 }));
  y += kLH + 8;
  parts.push(doc.text('syne700', 40, 'Got an idea?', P, baseline('syne700', 40, y, tLH)));
  y += tLH + 8;
  parts.push(doc.text('serif', 24, 'Prototype in under two days.', P, baseline('serif', 24, y, sLH), { fill: C.body }));

  const label = 'Start a conversation →';
  const bLH = normalLH('inter600', 14);
  const bw = measure('inter600', 14, label) + 40;
  const bh = bLH + 24;
  const bx = W - P - bw;
  const by = doc.h - P - bh;
  parts.push(rect(bx, by, bw, bh, 8, `fill="${C.button}"`), doc.text('inter600', 14, label, bx + 20, baseline('inter600', 14, by + 12, bLH), { fill: C.onButton }));
  doc.add(cardFrame(doc, W, doc.h, 14, C.bgHero, parts.join('')));
  return doc;
}

// ---------- readme ----------

function readme(products) {
  // Dark SVG by default, light variant when the viewer's GitHub theme is light
  const img = (file, alt, attrs = 'width="100%"') =>
    `<picture><source media="(prefers-color-scheme: light)" srcset="assets/readme/${file.replace('.svg', '-light.svg')}"><img src="assets/readme/${file}" ${attrs} alt="${esc(alt)}"/></picture>`;
  const streak = 'https://streak-stats.demolab.com?user=idevtim&hide_border=true';
  const streakDark = `${streak}&theme=dark&background=0D1117&ring=00F5D4&fire=F72585&currStreakLabel=00F5D4&sideLabels=A1A1AA&dates=71717A`;
  const streakLight = `${streak}&background=FFFFFF&stroke=E4E4E7&ring=0F766E&fire=BE185D&currStreakNum=18181B&sideNums=18181B&currStreakLabel=0F766E&sideLabels=52525B&dates=71717A`;
  const link = (url, inner) => `<a href="${esc(url)}">${inner}</a>`;
  const featuredList = products.filter(p => p.featured);
  const rows = [];
  for (let i = 0; i < products.length; i += 3) rows.push(products.slice(i, i + 3));

  return `<!-- Generated by scripts/build-readme-svgs.mjs from scripts/products.json. Edit those and run \`npm run build\`. -->

${link('https://www.idevtim.com', img('hero.svg', "Got an idea? I'll prototype it. — Timothy Murphy, Full-Stack Developer"))}

<p align="center">
  ${link('https://www.idevtim.com', img('btn-book.svg', 'Book a free 30-min call', 'height="44"'))}
  ${link('https://x.com/idevtim', img('btn-x.svg', 'X @idevtim', 'height="44"'))}
  ${link('https://linkedin.com/in/idevtim', img('btn-linkedin.svg', 'LinkedIn', 'height="44"'))}
</p>

${img('h-featured.svg', '01. Featured work')}

${featuredList.map(p => link(p.url, img(`featured-${p.slug}.svg`, `${p.name} — ${p.featured.kicker}. ${p.featured.desc}`))).join('\n\n')}

${img('h-everything.svg', "02. Everything I've built")}

${rows.map(r => `<p>\n${r.map(p => `  ${link(p.url, img(`card-${p.slug}.svg`, `${p.name} (${p.platform}) — ${p.desc}`, 'width="32%"'))}`).join('\n')}\n</p>`).join('\n\n')}

${img('h-about.svg', '03. About me')}

${img('about.svg', "class Developer extends Human { $name = 'Timothy Murphy'; $role = 'Full Stack Developer'; $years = 15; getCurrentFocus(): 'You bring the vision. I handle the code.' } — photo of Timothy, currently available")}

${img('stack.svg', `04. What I build with — ${data.technologies.map(t => t.name).join(', ')}`)}

<p align="center"><picture><source media="(prefers-color-scheme: light)" srcset="${esc(streakLight)}"><img src="${esc(streakDark)}" height="180" alt="GitHub Streak"/></picture></p>

${link('https://www.idevtim.com', img('footer.svg', 'Got an idea? Prototype in under two days. Start a conversation →'))}
`;
}

// ---------- build ----------

const { products } = data;
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const cardH = Math.ceil(16 + 36 + 10 + Math.max(...products.map(p => cardLayout(p).lines.length)) * 13.5 * 1.55 + 10 + normalLH('mono', 11) + 4 + 16);

let total = 0;
for (const theme of Object.keys(THEMES)) {
  setTheme(theme);
  const outputs = {
    'hero.svg': await hero(products.length),
    'btn-book.svg': button(new Doc(0), 'Book a free 30-min call →', { primary: true }),
    'btn-x.svg': button(new Doc(0), 'X / @idevtim', {}),
    'btn-linkedin.svg': button(new Doc(0), 'LinkedIn', {}),
    'h-featured.svg': header('01.', 'Featured work', { sub: 'Three products, told properly. Everything else is one scroll below.' }).doc,
    'h-everything.svg': header('02.', "Everything I've built", { sub: `${products.length} products across web, iPhone, Mac and the browser.`, divider: true }).doc,
    'h-about.svg': header('03.', 'About me', { divider: true }).doc,
    'about.svg': await about(),
    'stack.svg': stack(),
    'footer.svg': footer(),
  };
  for (const p of products) {
    if (p.featured) outputs[`featured-${p.slug}.svg`] = await featured(p);
    outputs[`card-${p.slug}.svg`] = await card(p, cardH);
  }

  for (const [file, doc] of Object.entries(outputs)) {
    const name = file.replace('.svg', `${THEMES[theme].suffix}.svg`);
    const svg = await doc.render();
    await fs.writeFile(path.join(OUT, name), svg);
    const kb = Buffer.byteLength(svg) / 1024;
    total += kb;
    console.log(`${name.padEnd(28)} ${kb.toFixed(1).padStart(7)} KB${kb > 1024 ? '  ⚠ over 1 MB' : ''}`);
  }
}
console.log(`${'total'.padEnd(28)} ${total.toFixed(1).padStart(7)} KB`);

await fs.writeFile(path.join(ROOT, 'README.md'), readme(products));
console.log('README.md written');
