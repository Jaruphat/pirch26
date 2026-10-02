// mIRC-style formatting: ^B bold, ^K color, ^U underline, ^I italic, ^O reset
export const B = '\x02', K = '\x03', U = '\x1F', I = '\x1D', O = '\x0F', R = '\x16';

// mIRC 16-color palette
export const PALETTE = [
  '#ffffff', '#000000', '#00007f', '#009300', '#ff0000', '#7f0000', '#9c009c', '#fc7f00',
  '#ffff00', '#00fc00', '#009393', '#00ffff', '#0000fc', '#ff00ff', '#7f7f7f', '#d2d2d2',
];
export const PALETTE_NAMES = [
  'ขาว', 'ดำ', 'กรมท่า', 'เขียว', 'แดง', 'น้ำตาล', 'ม่วง', 'ส้ม',
  'เหลือง', 'เขียวอ่อน', 'เขียวน้ำทะเล', 'ฟ้า', 'น้ำเงิน', 'ชมพู', 'เทา', 'เทาอ่อน',
];

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function appendText(parent, text) {
  // linkify safely
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.href = m[0];
    a.textContent = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    parent.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/** Render text with mIRC control codes into a DocumentFragment (XSS-safe: textContent only). */
export function renderFormatted(text, baseColor) {
  const frag = document.createDocumentFragment();
  const st = { b: false, i: false, u: false, fg: baseColor ?? null, bg: null };
  let buf = '';

  const flush = () => {
    if (!buf) return;
    const plain = !st.b && !st.i && !st.u && st.fg == null && st.bg == null;
    if (plain) { appendText(frag, buf); buf = ''; return; }
    const span = document.createElement('span');
    if (st.b) span.style.fontWeight = 'bold';
    if (st.i) span.style.fontStyle = 'italic';
    if (st.u) span.style.textDecoration = 'underline';
    if (st.fg != null) span.style.color = PALETTE[st.fg % 16];
    if (st.bg != null) span.style.backgroundColor = PALETTE[st.bg % 16];
    appendText(span, buf);
    frag.appendChild(span);
    buf = '';
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === B) { flush(); st.b = !st.b; }
    else if (c === I) { flush(); st.i = !st.i; }
    else if (c === U) { flush(); st.u = !st.u; }
    else if (c === O) { flush(); st.b = st.i = st.u = false; st.fg = baseColor ?? null; st.bg = null; }
    else if (c === R) { flush(); const t = st.fg; st.fg = st.bg ?? 0; st.bg = t ?? 1; }
    else if (c === K) {
      flush();
      const m = /^(\d{1,2})(?:,(\d{1,2}))?/.exec(text.slice(i + 1));
      if (m) {
        st.fg = parseInt(m[1], 10) % 16;
        if (m[2] != null) st.bg = parseInt(m[2], 10) % 16;
        i += m[0].length;
      } else { st.fg = baseColor ?? null; st.bg = null; }
    } else buf += c;
  }
  flush();
  return frag;
}

/** Strip control codes (for previews / nick matching). */
export function stripCodes(text) {
  return text.replace(/\x03(\d{1,2}(,\d{1,2})?)?|[\x02\x0F\x16\x1D\x1F]/g, '');
}

/** Split into grapheme clusters so Thai vowels/tone marks stay on their base letter. */
export function graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].map(s => s.segment);
  }
  return [...text];
}

const RAINBOW = [4, 7, 8, 3, 10, 12, 6, 13];
export function rainbow(text) {
  let n = 0;
  return graphemes(text).map(g => (/\s/.test(g) ? g : `${K}${String(RAINBOW[n++ % RAINBOW.length]).padStart(2, '0')}${g}`)).join('') + O;
}

// Stable nick color (like mIRC nick colors)
const NICK_COLORS = [2, 3, 4, 5, 6, 7, 10, 12, 13];
export function nickColor(nick) {
  let h = 0;
  for (const ch of nick.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[NICK_COLORS[h % NICK_COLORS.length]];
}
