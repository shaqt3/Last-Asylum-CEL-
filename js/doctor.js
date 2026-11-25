// The plague doctor mascot (Venetian "medico della peste", steampunk edition).
// He rises from the fog, follows you while you type your email and
// covers his goggles with his gloves while you type your password.

export function doctorSVG() {
  return `
<svg class="doctor" id="doctor" viewBox="0 0 240 250" role="img" aria-label="Plague doctor">
  <defs>
    <radialGradient id="dg-glass" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ffd27a"/>
      <stop offset=".45" stop-color="#ff7a2a"/>
      <stop offset="1" stop-color="#6b1606"/>
    </radialGradient>
    <linearGradient id="dg-brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f3d38a"/>
      <stop offset=".5" stop-color="#c9a24a"/>
      <stop offset="1" stop-color="#7a5a1e"/>
    </linearGradient>
    <linearGradient id="dg-bone" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4ead2"/>
      <stop offset="1" stop-color="#bfae88"/>
    </linearGradient>
    <linearGradient id="dg-leather" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3424"/>
      <stop offset="1" stop-color="#22170e"/>
    </linearGradient>
  </defs>

  <!-- gears behind -->
  <g class="dg-gear spin" style="transform-origin:46px 60px">
    <path d="M46 34l4 0 2 7 6 3 6-4 3 3-4 6 3 6 7 2 0 4-7 2-3 6 4 6-3 3-6-4-6 3-2 7-4 0-2-7-6-3-6 4-3-3 4-6-3-6-7-2 0-4 7-2 3-6-4-6 3-3 6 4 6-3z" fill="#5a4326"/>
    <circle cx="46" cy="60" r="8" fill="#15100b"/>
  </g>
  <g class="dg-gear spin rev" style="transform-origin:196px 44px">
    <path d="M196 26l3 0 1 5 4 2 4-3 2 2-3 4 2 4 5 1 0 3-5 1-2 4 3 4-2 2-4-3-4 2-1 5-3 0-1-5-4-2-4 3-2-2 3-4-2-4-5-1 0-3 5-1 2-4-3-4 2-2 4 3 4-2z" fill="#5a4326"/>
    <circle cx="196" cy="44" r="6" fill="#15100b"/>
  </g>

  <g class="dg-body">
    <g class="dg-head">
      <!-- hood -->
      <path d="M62 70 Q54 140 86 182 L154 182 Q186 140 178 70 Z" fill="#1b130c" stroke="#0b0805" stroke-width="2"/>
      <!-- mask -->
      <path d="M82 74 Q120 60 158 74 Q166 116 142 138 L98 138 Q74 116 82 74 Z" fill="url(#dg-bone)" stroke="#6d5a39" stroke-width="2"/>
      <!-- beak -->
      <g class="dg-beak">
        <path d="M100 120 Q124 110 146 122 Q186 150 214 214 Q174 182 134 164 Q106 152 100 120 Z" fill="url(#dg-bone)" stroke="#6d5a39" stroke-width="2"/>
        <path d="M118 130 Q160 150 196 196" fill="none" stroke="#8a744c" stroke-width="1.5" stroke-dasharray="4 4"/>
        <circle cx="128" cy="132" r="2.2" fill="#3a2a18"/>
        <circle cx="136" cy="134" r="2.2" fill="#3a2a18"/>
        <!-- brass straps -->
        <path d="M150 128 Q160 146 152 160" fill="none" stroke="url(#dg-brass)" stroke-width="5"/>
      </g>
      <!-- goggles -->
      <path d="M96 94 L144 94" stroke="url(#dg-brass)" stroke-width="5"/>
      <g class="dg-eyes">
        <circle cx="100" cy="96" r="16" fill="#120c07" stroke="url(#dg-brass)" stroke-width="6"/>
        <circle class="dg-glass" cx="100" cy="96" r="11" fill="url(#dg-glass)"/>
        <circle cx="140" cy="96" r="16" fill="#120c07" stroke="url(#dg-brass)" stroke-width="6"/>
        <circle class="dg-glass" cx="140" cy="96" r="11" fill="url(#dg-glass)"/>
        <circle class="dg-pupil" cx="100" cy="96" r="3.5" fill="#2a0a02"/>
        <circle class="dg-pupil" cx="140" cy="96" r="3.5" fill="#2a0a02"/>
        <circle cx="95" cy="91" r="2.5" fill="#fff6" />
        <circle cx="135" cy="91" r="2.5" fill="#fff6" />
        <g fill="#f6dc9a">
          <circle cx="100" cy="80" r="1.6"/><circle cx="116" cy="96" r="1.6"/><circle cx="84" cy="96" r="1.6"/>
          <circle cx="140" cy="80" r="1.6"/><circle cx="156" cy="96" r="1.6"/><circle cx="124" cy="96" r="1.6"/>
        </g>
      </g>
      <!-- hat -->
      <path d="M76 66 L84 16 Q120 4 156 16 L164 66 Z" fill="url(#dg-leather)" stroke="#0b0805" stroke-width="2"/>
      <path d="M79 50 Q120 42 161 50 L163 62 Q120 55 77 62 Z" fill="url(#dg-brass)"/>
      <rect x="112" y="46" width="16" height="14" rx="2" fill="none" stroke="#3a2a10" stroke-width="3"/>
      <circle class="dg-gear spin" style="transform-origin:148px 30px" cx="148" cy="30" r="6" fill="none" stroke="url(#dg-brass)" stroke-width="3" stroke-dasharray="3 2"/>
      <ellipse cx="120" cy="66" rx="94" ry="15" fill="url(#dg-leather)" stroke="#0b0805" stroke-width="2"/>
      <ellipse cx="120" cy="63" rx="80" ry="8" fill="#ffffff0d"/>
    </g>

    <!-- gloves (go up to cover the goggles) -->
    <g class="dg-hands">
      <g class="dg-hand dg-hand-l">
        <rect x="80" y="96" width="40" height="38" rx="12" fill="url(#dg-leather)" stroke="#0b0805" stroke-width="2"/>
        <rect x="80" y="74" width="9" height="30" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="90" y="70" width="9" height="32" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="100" y="71" width="9" height="31" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="110" y="76" width="9" height="28" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="80" y="128" width="40" height="10" rx="3" fill="url(#dg-brass)"/>
      </g>
      <g class="dg-hand dg-hand-r">
        <rect x="120" y="96" width="40" height="38" rx="12" fill="url(#dg-leather)" stroke="#0b0805" stroke-width="2"/>
        <rect x="121" y="76" width="9" height="28" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="131" y="71" width="9" height="31" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="141" y="70" width="9" height="32" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="151" y="74" width="9" height="30" rx="4.5" fill="#3f2c1e" stroke="#0b0805" stroke-width="1.5"/>
        <rect x="120" y="128" width="40" height="10" rx="3" fill="url(#dg-brass)"/>
      </g>
    </g>

    <!-- cloak -->
    <path d="M28 250 Q48 190 100 178 L140 178 Q192 190 212 250 Z" fill="#140e09" stroke="#0b0805" stroke-width="2"/>
    <path d="M120 180 L120 250" stroke="#2a1d12" stroke-width="3"/>
    <circle cx="112" cy="200" r="4" fill="url(#dg-brass)"/><circle cx="112" cy="220" r="4" fill="url(#dg-brass)"/>
    <circle cx="128" cy="200" r="4" fill="url(#dg-brass)"/><circle cx="128" cy="220" r="4" fill="url(#dg-brass)"/>
    <path d="M100 178 Q120 196 140 178" fill="none" stroke="url(#dg-brass)" stroke-width="3"/>
  </g>
</svg>`;
}

/**
 * Hooks the doctor to a login/register form.
 * lines: { idle, email, pass, peek, error } — already translated.
 */
export function attachDoctor(root, form, lines) {
  const doc = root.querySelector('#doctor');
  const bubble = root.querySelector('#doc-bubble');
  if (!doc) return { error() {} };
  const say = (txt) => {
    if (!bubble) return;
    bubble.textContent = txt;
    bubble.classList.remove('pop');
    void bubble.offsetWidth; // restart animation
    bubble.classList.add('pop');
  };
  const set = (state) => {
    doc.classList.remove('look', 'cover', 'peek');
    if (state) doc.classList.add(state);
  };
  say(lines.idle);

  const pass = form.querySelector('input[type=password], input[name=password]');
  const email = form.querySelector('input[name=email]');
  const nick = form.querySelector('input[name=nick]');
  const toggle = form.querySelector('[data-show-pass]');

  // Pupils follow the caret while typing the email.
  const follow = (input) => {
    const ratio = Math.min(1, (input.value.length || 0) / 28);
    const dx = -5 + ratio * 10;
    doc.style.setProperty('--px', `${dx}px`);
  };
  for (const input of [email, nick].filter(Boolean)) {
    input.addEventListener('focus', () => { set('look'); follow(input); say(lines.email); });
    input.addEventListener('input', () => follow(input));
    input.addEventListener('blur', () => set(''));
  }
  if (pass) {
    pass.addEventListener('focus', () => { set(pass.type === 'text' ? 'peek' : 'cover'); say(pass.type === 'text' ? lines.peek : lines.pass); });
    pass.addEventListener('input', () => {
      doc.classList.remove('giggle'); void doc.offsetWidth; doc.classList.add('giggle');
    });
    pass.addEventListener('blur', () => { set(''); say(lines.idle); });
  }
  if (toggle && pass) {
    toggle.addEventListener('click', () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
      toggle.textContent = pass.type === 'password' ? '👁' : '🙈';
      pass.focus();
      set(pass.type === 'text' ? 'peek' : 'cover');
      say(pass.type === 'text' ? lines.peek : lines.pass);
    });
  }
  return {
    error() {
      set('');
      say(lines.error);
      doc.classList.remove('shake'); void doc.getBoundingClientRect(); doc.classList.add('shake');
    },
  };
}
