/* ============================================================
   SETTINGS.JS — Profile & Settings panel for PrepTare
   ============================================================
   Full-screen slide-in panel with 4 sections:
     1. Account       — display name + email
     2. Family Members— add/remove/rename + avatar cycle
     3. Macro Targets — per-member calculator or manual entry
     4. Preferences   — nutrition mode, prep frequency, prep day, units
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

let _settActiveMember   = 0;
let _settInputMode      = 'calculator'; // 'calculator' | 'manual'
let _settCalcActivity   = 1.55;
let _settCalcHeightUnit = 'imperial';
let _settCalcGoal       = 'maintenance';
let _settCalcStates     = {};           // per-member field snapshots

const SETT_AVATAR_COLORS = [
  'avatar-green', 'avatar-blue', 'avatar-amber', 'avatar-pink',
  'avatar-purple', 'avatar-teal', 'avatar-coral', 'avatar-slate',
];

/* ============================================================
   OPEN / CLOSE
   ============================================================ */

function openSettings() {
  // Reset per-session state
  _settActiveMember   = 0;
  _settInputMode      = 'calculator';
  _settCalcActivity   = 1.55;
  _settCalcHeightUnit = 'imperial';
  _settCalcGoal       = 'maintenance';
  _settCalcStates     = {};

  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.remove('hidden');

  // Close the user-menu dropdown
  const dd = document.getElementById('user-menu-dropdown');
  if (dd) dd.classList.add('hidden');

  _renderSettings();
}

function closeSettings() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.add('hidden');

  // Refresh main app view
  if (typeof renderAll           === 'function') renderAll();
  if (typeof renderMealCalendar  === 'function') renderMealCalendar();
  if (typeof updateProgress      === 'function') updateProgress();
}

/* ============================================================
   MAIN RENDER
   ============================================================ */

function _renderSettings() {
  const body = document.getElementById('settings-body');
  if (!body) return;
  body.innerHTML =
    _settAccountSection() +
    _settMembersSection() +
    _settMacrosSection() +
    _settPrefsSection();
}

/* ============================================================
   SECTION 1: ACCOUNT
   ============================================================ */

function _settAccountSection() {
  const user  = typeof currentUser    !== 'undefined' ? currentUser    : null;
  const prof  = typeof currentProfile !== 'undefined' ? currentProfile : null;
  const name  = prof?.displayName || user?.displayName || '';
  const email = user?.email || '';
  return `
<div class="sett-section">
  <p class="sett-section-title">Account</p>
  <div class="sett-field">
    <label class="sett-label" for="sett-display-name">Display Name</label>
    <input
      id="sett-display-name"
      class="sett-input"
      type="text"
      value="${escapeHtml(name)}"
      placeholder="Your name"
      onblur="settSaveDisplayName(this.value)"
    />
  </div>
  <div class="sett-field">
    <label class="sett-label">Email</label>
    <p class="sett-readonly">${escapeHtml(email)}</p>
  </div>
</div>`;
}

function settSaveDisplayName(value) {
  const trimmed = value.trim();
  const prof    = typeof currentProfile !== 'undefined' ? currentProfile : null;
  const user    = typeof currentUser    !== 'undefined' ? currentUser    : null;
  if (!trimmed || trimmed === (prof?.displayName || '')) return;

  // Update Firebase Auth profile
  if (user && typeof user.updateProfile === 'function') {
    user.updateProfile({ displayName: trimmed }).catch(() => {});
  }

  // Persist to Firestore via auth.js helper
  if (user && typeof saveUserProfile === 'function') {
    saveUserProfile(user.uid, { displayName: trimmed });
  }

  // Update in-memory profile
  if (prof) prof.displayName = trimmed;

  // Refresh the header avatar/name
  if (typeof renderUserMenu === 'function') renderUserMenu(prof);
}

/* ============================================================
   SECTION 2: FAMILY MEMBERS
   ============================================================ */

function _settMembersSection() {
  return `
<div class="sett-section">
  <p class="sett-section-title">Family Members</p>
  <p class="sett-section-desc">Tap an avatar to cycle its color. Names auto-save on change.</p>
  <div id="sett-member-list">${_settMemberListHTML()}</div>
  <button class="sett-add-btn" onclick="settAddMember()">
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    Add family member
  </button>
</div>`;
}

function _settMemberListHTML() {
  return MEMBERS.map((m, i) => `
    <div class="sett-member-row" data-idx="${i}">
      <div class="sett-member-avatar ${escapeHtml(m.avatarClass)}" onclick="settCycleAvatar(${i})" title="Cycle color">
        ${escapeHtml(m.initials)}
      </div>
      <input
        type="text"
        class="sett-input"
        value="${escapeHtml(m.name)}"
        placeholder="Name"
        style="flex:1;"
        oninput="settUpdateMemberName(${i}, this.value)"
        onblur="settSaveMembers()"
        aria-label="Member name"
      />
      ${MEMBERS.length > 1 ? `
      <button class="sett-remove-btn" onclick="settRemoveMember(${i})" aria-label="Remove ${escapeHtml(m.name)}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>` : ''}
    </div>`).join('');
}

function settUpdateMemberName(idx, value) {
  if (!MEMBERS[idx]) return;
  MEMBERS[idx].name     = value.trim();
  MEMBERS[idx].initials = generateInitials(value || '?');
  // Update avatar initials in-place without full re-render
  const rows = document.querySelectorAll('#sett-member-list .sett-member-avatar');
  if (rows[idx]) rows[idx].textContent = generateInitials(value || '?');
}

function settSaveMembers() {
  // Sync any in-flight name inputs
  document.querySelectorAll('#sett-member-list .sett-input').forEach((input, i) => {
    if (MEMBERS[i]) {
      MEMBERS[i].name     = input.value.trim();
      MEMBERS[i].initials = generateInitials(input.value || '?');
    }
  });
  if (typeof saveMembers      === 'function') saveMembers();
  if (typeof saveMemberPhases === 'function') saveMemberPhases();
  if (typeof saveMemberMacros === 'function') saveMemberMacros();
}

function settAddMember() {
  const colorIdx = MEMBERS.length % SETT_AVATAR_COLORS.length;
  const id       = `member-${Date.now()}`;
  const newMember = {
    id,
    name:        '',
    initials:    '?',
    avatarClass: SETT_AVATAR_COLORS[colorIdx],
    maintenance: { cal: 2000, protein: 150, carbs: 200, fat: 65 },
  };
  MEMBERS.push(newMember);

  if (state && state.memberPhases) {
    state.memberPhases[id] = 'maintenance';
  }
  if (state && state.memberMacros && typeof initMemberMacros === 'function') {
    state.memberMacros[id] = initMemberMacros(newMember.maintenance);
  }

  settSaveMembers();

  // Re-render member list and macro tabs
  const list = document.getElementById('sett-member-list');
  if (list) list.innerHTML = _settMemberListHTML();

  const tabs = document.getElementById('sett-macro-tabs');
  if (tabs) tabs.innerHTML = _settMacroTabsHTML();

  // Focus the new name input
  const inputs = document.querySelectorAll('#sett-member-list .sett-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function settRemoveMember(idx) {
  if (MEMBERS.length <= 1) return;
  const removed = MEMBERS.splice(idx, 1)[0];

  if (state && state.memberPhases) delete state.memberPhases[removed.id];
  if (state && state.memberMacros) delete state.memberMacros[removed.id];

  // Clamp active member index
  _settActiveMember = Math.min(_settActiveMember, MEMBERS.length - 1);

  settSaveMembers();

  // Re-render both member list and macro section
  const list = document.getElementById('sett-member-list');
  if (list) list.innerHTML = _settMemberListHTML();

  _settRefreshMacrosSection();
}

function settCycleAvatar(idx) {
  if (!MEMBERS[idx]) return;
  const curr = SETT_AVATAR_COLORS.indexOf(MEMBERS[idx].avatarClass);
  MEMBERS[idx].avatarClass = SETT_AVATAR_COLORS[(curr + 1) % SETT_AVATAR_COLORS.length];
  settSaveMembers();

  // Re-render member list and macro tabs
  const list = document.getElementById('sett-member-list');
  if (list) list.innerHTML = _settMemberListHTML();

  const tabs = document.getElementById('sett-macro-tabs');
  if (tabs) tabs.innerHTML = _settMacroTabsHTML();
}

/* ============================================================
   SECTION 3: MACRO TARGETS
   ============================================================ */

function _settMacrosSection() {
  return `
<div class="sett-section" id="sett-macros-section">
  <p class="sett-section-title">Macro Targets</p>
  <p class="sett-section-desc">Maintenance calories &amp; macros per person. Deficit/bulk phases scale automatically.</p>
  <div class="sett-macro-tabs" id="sett-macro-tabs">
    ${_settMacroTabsHTML()}
  </div>
  <div id="sett-macro-panel">
    ${_settMacroPanelHTML()}
  </div>
</div>`;
}

function _settMacroTabsHTML() {
  return MEMBERS.map((m, i) => `
    <button
      class="sett-macro-tab ${i === _settActiveMember ? 'active' : ''}"
      onclick="settSelectMacroMember(${i})"
    >
      <span class="sett-macro-tab-avatar ${escapeHtml(m.avatarClass)}">${escapeHtml(m.initials)}</span>
      ${escapeHtml(m.name || '?')}
    </button>`).join('');
}

function _settMacroPanelHTML() {
  const m   = MEMBERS[_settActiveMember];
  if (!m) return '';
  const mac = m.maintenance;
  const isSimple = state && state.portionMode === 'simple';

  if (isSimple) {
    // Basic mode: calories only
    return `
<div class="sett-macro-fields">
  <div class="sett-field">
    <label class="sett-label" for="sett-mac-cal">Daily Calories</label>
    <div class="onb-input-unit">
      <input type="number" class="onb-input sett-input" id="sett-mac-cal"
        value="${mac.cal}" min="800" max="6000"
        oninput="settUpdateMacro('cal', this.value)" />
      <span class="onb-unit">kcal</span>
    </div>
  </div>
</div>`;
  }

  // Advanced mode: mode choice + calculator or manual
  return `
<div class="sett-macro-fields">
  <div class="sett-input-mode-cards">
    <button class="sett-input-mode-card ${_settInputMode === 'calculator' ? 'selected' : ''}"
            onclick="settSetInputMode('calculator')">
      <div class="sett-input-mode-icon">🧮</div>
      <div class="sett-input-mode-title">Calculate for me</div>
    </button>
    <button class="sett-input-mode-card ${_settInputMode === 'manual' ? 'selected' : ''}"
            onclick="settSetInputMode('manual')">
      <div class="sett-input-mode-icon">✏️</div>
      <div class="sett-input-mode-title">Enter manually</div>
    </button>
  </div>
  ${_settInputMode === 'calculator' ? _settCalcHTML(m) : _settManualHTML(mac)}
</div>`;
}

function settSelectMacroMember(idx) {
  _settSaveCalcState(_settActiveMember);
  _settActiveMember = idx;

  // Update tab highlights
  const tabs = document.getElementById('sett-macro-tabs');
  if (tabs) tabs.innerHTML = _settMacroTabsHTML();

  _settRestoreCalcState(idx);
}

function settSetInputMode(mode) {
  _settInputMode = mode;
  const panel = document.getElementById('sett-macro-panel');
  if (panel) panel.innerHTML = _settMacroPanelHTML();
}

/* ── Calc state save / restore (per-member snapshots) ──── */

function _settSaveCalcState(idx) {
  if (_settInputMode !== 'calculator') return;
  const s = {
    sex:        document.getElementById('sett-calc-sex')?.value    || 'male',
    age:        document.getElementById('sett-calc-age')?.value    || '',
    weight:     document.getElementById('sett-calc-weight')?.value || '',
    heightUnit: _settCalcHeightUnit,
    activity:   _settCalcActivity,
    goal:       _settCalcGoal,
  };
  if (_settCalcHeightUnit === 'metric') {
    s.heightCm = document.getElementById('sett-calc-height-cm')?.value || '';
  } else {
    s.heightFt = document.getElementById('sett-calc-height-ft')?.value || '';
    s.heightIn = document.getElementById('sett-calc-height-in')?.value || '';
  }
  _settCalcStates[idx] = s;
}

function _settRestoreCalcState(idx) {
  const s = _settCalcStates[idx];
  if (s) {
    _settCalcHeightUnit = s.heightUnit;
    _settCalcActivity   = s.activity;
    _settCalcGoal       = s.goal;
  }
  const panel = document.getElementById('sett-macro-panel');
  if (panel) panel.innerHTML = _settMacroPanelHTML();
  if (_settInputMode !== 'calculator' || !s) return;
  requestAnimationFrame(() => {
    const sex = document.getElementById('sett-calc-sex');
    const age = document.getElementById('sett-calc-age');
    const wt  = document.getElementById('sett-calc-weight');
    if (sex && s.sex)    sex.value = s.sex;
    if (age && s.age)    age.value = s.age;
    if (wt  && s.weight) wt.value  = s.weight;
    if (s.heightUnit === 'metric') {
      const hcm = document.getElementById('sett-calc-height-cm');
      if (hcm && s.heightCm) hcm.value = s.heightCm;
    } else {
      const hft = document.getElementById('sett-calc-height-ft');
      const hin = document.getElementById('sett-calc-height-in');
      if (hft && s.heightFt) hft.value = s.heightFt;
      if (hin && s.heightIn) hin.value = s.heightIn;
    }
    settRunCalc();
  });
}

/* ── Calculator HTML ─────────────────────────────────────── */

function _settCalcHTML(member) {
  const metric = _settCalcHeightUnit === 'metric';
  const activities = [
    { factor: 1.2,   emoji: '🪑', name: 'Sedentary',     desc: 'Little or no exercise' },
    { factor: 1.375, emoji: '🚶', name: 'Lightly Active', desc: '1–3 days/wk' },
    { factor: 1.55,  emoji: '🏃', name: 'Moderate',       desc: '3–5 days/wk' },
    { factor: 1.725, emoji: '🏋️', name: 'Very Active',    desc: '6–7 days/wk' },
    { factor: 1.9,   emoji: '🔥', name: 'Extra Active',   desc: 'Intense training' },
  ];
  return `
<div class="onb-calc">
  <div class="onb-field-row">
    <div class="onb-field">
      <label class="onb-label">Sex</label>
      <select class="onb-input" id="sett-calc-sex" onchange="settRunCalc()">
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
    </div>
    <div class="onb-field">
      <label class="onb-label">Age</label>
      <input type="number" class="onb-input" id="sett-calc-age"
        placeholder="e.g. 35" min="10" max="100" oninput="settRunCalc()" />
    </div>
  </div>

  <div class="onb-field">
    <div class="onb-label-row">
      <label class="onb-label">Height</label>
      <div class="onb-unit-toggle">
        <button class="onb-unit-btn ${!metric ? 'active' : ''}" onclick="settSetHeightUnit('imperial')">ft / in</button>
        <button class="onb-unit-btn ${metric  ? 'active' : ''}" onclick="settSetHeightUnit('metric')">cm</button>
      </div>
    </div>
    ${metric ? `
      <div class="onb-input-unit">
        <input type="number" class="onb-input" id="sett-calc-height-cm"
          placeholder="e.g. 178" min="120" max="250" oninput="settRunCalc()" />
        <span class="onb-unit">cm</span>
      </div>
    ` : `
      <div class="onb-height-ftIn">
        <div class="onb-input-unit">
          <select class="onb-input" id="sett-calc-height-ft" onchange="settRunCalc()">
            <option value="">ft</option>
            ${[3,4,5,6,7,8].map(f => `<option value="${f}">${f} ft</option>`).join('')}
          </select>
        </div>
        <div class="onb-input-unit">
          <select class="onb-input" id="sett-calc-height-in" onchange="settRunCalc()">
            <option value="">in</option>
            ${[0,1,2,3,4,5,6,7,8,9,10,11].map(i => `<option value="${i}">${i} in</option>`).join('')}
          </select>
        </div>
      </div>
    `}
  </div>

  <div class="onb-field">
    <label class="onb-label">Weight (${metric ? 'kg' : 'lbs'})</label>
    <div class="onb-input-unit">
      <input type="number" class="onb-input" id="sett-calc-weight"
        placeholder="${metric ? 'e.g. 80' : 'e.g. 185'}"
        min="${metric ? '30' : '66'}" max="${metric ? '300' : '660'}"
        oninput="settRunCalc()" />
      <span class="onb-unit">${metric ? 'kg' : 'lbs'}</span>
    </div>
  </div>

  <div class="onb-field">
    <label class="onb-label">Activity level</label>
    <div class="activity-grid">
      ${activities.map(c => `
        <div class="activity-card ${_settCalcActivity === c.factor ? 'active' : ''}"
             data-factor="${c.factor}"
             onclick="settSetActivity(${c.factor})">
          <span class="activity-emoji">${c.emoji}</span>
          <span class="activity-name">${c.name}</span>
          <span class="activity-desc">${c.desc}</span>
          <span class="activity-factor">×${c.factor}</span>
        </div>`).join('')}
    </div>
  </div>

  <div class="onb-field">
    <label class="onb-label">Goal</label>
    <div class="onb-goal-btns">
      <button class="onb-goal-btn ${_settCalcGoal === 'deficit'     ? 'selected' : ''}"
              data-goal="deficit"     onclick="settSetGoal('deficit')">Cut (−20%)</button>
      <button class="onb-goal-btn ${_settCalcGoal === 'maintenance' ? 'selected' : ''}"
              data-goal="maintenance" onclick="settSetGoal('maintenance')">Maintain</button>
      <button class="onb-goal-btn ${_settCalcGoal === 'bulk'        ? 'selected' : ''}"
              data-goal="bulk"        onclick="settSetGoal('bulk')">Bulk (+20%)</button>
    </div>
  </div>

  <div class="onb-calc-result hidden" id="sett-calc-result"></div>
</div>`;
}

/* ── Manual HTML ─────────────────────────────────────────── */

function _settManualHTML(mac) {
  return `
<div class="onb-manual-fields">
  <div class="onb-field-row">
    <div class="onb-field">
      <label class="onb-label">Daily Calories</label>
      <div class="onb-input-unit">
        <input type="number" class="onb-input" id="sett-mac-cal"
          value="${mac.cal}" min="800" max="6000"
          oninput="settUpdateMacro('cal', this.value)" />
        <span class="onb-unit">kcal</span>
      </div>
    </div>
    <div class="onb-field">
      <label class="onb-label">Protein</label>
      <div class="onb-input-unit">
        <input type="number" class="onb-input" id="sett-mac-protein"
          value="${mac.protein}" min="0" max="500"
          oninput="settUpdateMacro('protein', this.value)" />
        <span class="onb-unit">g</span>
      </div>
    </div>
  </div>
  <div class="onb-field-row">
    <div class="onb-field">
      <label class="onb-label">Carbs</label>
      <div class="onb-input-unit">
        <input type="number" class="onb-input" id="sett-mac-carbs"
          value="${mac.carbs}" min="0" max="800"
          oninput="settUpdateMacro('carbs', this.value)" />
        <span class="onb-unit">g</span>
      </div>
    </div>
    <div class="onb-field">
      <label class="onb-label">Fat</label>
      <div class="onb-input-unit">
        <input type="number" class="onb-input" id="sett-mac-fat"
          value="${mac.fat}" min="0" max="300"
          oninput="settUpdateMacro('fat', this.value)" />
        <span class="onb-unit">g</span>
      </div>
    </div>
  </div>
</div>`;
}

/* ── Calculator interaction handlers ─────────────────────── */

function settSetHeightUnit(unit) {
  // Snapshot current values before the re-render wipes inputs
  const saved = {
    sex:    document.getElementById('sett-calc-sex')?.value,
    age:    document.getElementById('sett-calc-age')?.value,
    weight: document.getElementById('sett-calc-weight')?.value,
  };
  _settCalcHeightUnit = unit;
  const panel = document.getElementById('sett-macro-panel');
  if (panel) panel.innerHTML = _settMacroPanelHTML();
  requestAnimationFrame(() => {
    const sex = document.getElementById('sett-calc-sex');
    const age = document.getElementById('sett-calc-age');
    const wt  = document.getElementById('sett-calc-weight');
    if (sex && saved.sex)    sex.value = saved.sex;
    if (age && saved.age)    age.value = saved.age;
    if (wt  && saved.weight) wt.value  = saved.weight;
    settRunCalc();
  });
}

function settSetActivity(factor) {
  _settCalcActivity = factor;
  // Update card highlights in-place (no re-render, preserves inputs)
  document.querySelectorAll('#sett-macro-panel .activity-card').forEach(card => {
    card.classList.toggle('active', parseFloat(card.dataset.factor) === factor);
  });
  settRunCalc();
}

function settSetGoal(goal) {
  _settCalcGoal = goal;
  document.querySelectorAll('#sett-macro-panel .onb-goal-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.goal === goal);
  });
  settRunCalc();
}

function settRunCalc() {
  const sex    = document.getElementById('sett-calc-sex')?.value;
  const age    = parseFloat(document.getElementById('sett-calc-age')?.value);
  const result = document.getElementById('sett-calc-result');

  // Height
  let heightCm;
  if (_settCalcHeightUnit === 'metric') {
    heightCm = parseFloat(document.getElementById('sett-calc-height-cm')?.value);
  } else {
    const ft  = parseFloat(document.getElementById('sett-calc-height-ft')?.value) || 0;
    const ins = parseFloat(document.getElementById('sett-calc-height-in')?.value) || 0;
    const totalIn = ft * 12 + ins;
    heightCm = totalIn > 0 ? totalIn * 2.54 : NaN;
  }

  // Weight
  const weightRaw = parseFloat(document.getElementById('sett-calc-weight')?.value);
  const weightKg  = _settCalcHeightUnit === 'metric' ? weightRaw : weightRaw * 0.4536;
  const weightLb  = _settCalcHeightUnit === 'metric' ? weightRaw * 2.205 : weightRaw;

  if (!age || !heightCm || isNaN(heightCm) || !weightRaw || isNaN(weightKg)) {
    if (result) result.classList.add('hidden');
    return;
  }

  // Mifflin-St Jeor BMR
  const bmr = sex === 'male'
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
    : (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;

  const goalFactor  = _settCalcGoal === 'deficit' ? 0.8 : _settCalcGoal === 'bulk' ? 1.2 : 1.0;
  const tdee        = Math.round(bmr * _settCalcActivity * goalFactor);
  const protein     = Math.round(weightLb * 0.85);
  const fat         = Math.round((tdee * 0.28) / 9);
  const carbs       = Math.max(0, Math.round((tdee - protein * 4 - fat * 9) / 4));

  // Live-update the member's stored maintenance values
  const m = MEMBERS[_settActiveMember];
  if (m) {
    m.maintenance = { cal: tdee, protein, fat, carbs };
    // Rebuild phase macros
    if (typeof initMemberMacros === 'function') {
      state.memberMacros[m.id] = initMemberMacros(m.maintenance);
    }
    if (typeof saveMembers      === 'function') saveMembers();
    if (typeof saveMemberMacros === 'function') saveMemberMacros();
  }

  // Show result summary
  if (result) {
    result.classList.remove('hidden');
    result.innerHTML = `
      <div class="onb-calc-result-label">Your daily targets</div>
      <div class="onb-calc-result-grid">
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${tdee}</span>
          <span class="onb-calc-result-unit">kcal</span>
        </div>
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${protein}g</span>
          <span class="onb-calc-result-unit">protein</span>
        </div>
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${carbs}g</span>
          <span class="onb-calc-result-unit">carbs</span>
        </div>
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${fat}g</span>
          <span class="onb-calc-result-unit">fat</span>
        </div>
      </div>`;
  }
}

function settUpdateMacro(field, value) {
  const m = MEMBERS[_settActiveMember];
  if (!m) return;
  m.maintenance[field] = parseInt(value, 10) || 0;
  if (typeof initMemberMacros === 'function') {
    state.memberMacros[m.id] = initMemberMacros(m.maintenance);
  }
  if (typeof saveMembers      === 'function') saveMembers();
  if (typeof saveMemberMacros === 'function') saveMemberMacros();
}

/* Helper: re-render the whole macros section in-place */
function _settRefreshMacrosSection() {
  const sec = document.getElementById('sett-macros-section');
  if (sec) sec.outerHTML = _settMacrosSection();
}

/* ============================================================
   SECTION 4: PREFERENCES
   ============================================================ */

function _settPrefsSection() {
  return `<div class="sett-section" id="sett-prefs-section">${_settPrefsContent()}</div>`;
}

function _settPrefsContent() {
  const portionMode  = (state && state.portionMode === 'simple') ? 'basic' : 'advanced';
  const prepDays     = state?.prefs?.prepDays    || 7;
  const weekStartDay = state?.prefs?.weekStartDay ?? 1;
  const portionUnit  = state?.portionUnit        || 'imperial';

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  return `
<p class="sett-section-title">Preferences</p>

<div class="sett-pref-group">
  <label class="sett-label">Nutrition Mode</label>
  <div class="sett-toggle-row">
    <button class="sett-toggle-btn ${portionMode === 'basic'    ? 'selected' : ''}"
            onclick="settSetPortionMode('basic')">Basic (calories only)</button>
    <button class="sett-toggle-btn ${portionMode === 'advanced' ? 'selected' : ''}"
            onclick="settSetPortionMode('advanced')">Advanced (macros)</button>
  </div>
</div>

<div class="sett-pref-group">
  <label class="sett-label">Prep Frequency</label>
  <div class="sett-toggle-row">
    <button class="sett-toggle-btn ${prepDays === 5  ? 'selected' : ''}"
            onclick="settSetPrepDays(5)">Every 5 days</button>
    <button class="sett-toggle-btn ${prepDays === 7  ? 'selected' : ''}"
            onclick="settSetPrepDays(7)">Every 7 days</button>
    <button class="sett-toggle-btn ${prepDays === 14 ? 'selected' : ''}"
            onclick="settSetPrepDays(14)">Every 14 days</button>
  </div>
</div>

<div class="sett-pref-group">
  <label class="sett-label">Prep Day</label>
  <div class="sett-day-row">
    ${days.map((d, i) => `
      <button class="sett-day-btn ${weekStartDay === i ? 'selected' : ''}"
              onclick="settSetPrepDay(${i})">${d}</button>`).join('')}
  </div>
</div>

<div class="sett-pref-group">
  <label class="sett-label">Units</label>
  <div class="sett-toggle-row">
    <button class="sett-toggle-btn ${portionUnit === 'imperial' ? 'selected' : ''}"
            onclick="settSetUnits('imperial')">Imperial (lbs, oz)</button>
    <button class="sett-toggle-btn ${portionUnit === 'metric'   ? 'selected' : ''}"
            onclick="settSetUnits('metric')">Metric (kg, g)</button>
  </div>
</div>`;
}

function _settRefreshPrefs() {
  const sec = document.getElementById('sett-prefs-section');
  if (sec) sec.innerHTML = _settPrefsContent();
}

function _settSavePrefsToCloud() {
  const user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (user && typeof saveUserProfile === 'function') {
    saveUserProfile(user.uid, { prefs: state.prefs });
  }
}

function settSetPortionMode(mode) {
  state.portionMode = mode === 'basic' ? 'simple' : 'macro';
  localStorage.setItem('preptarePortionMode', state.portionMode);
  const user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (user && typeof saveUserProfile === 'function') {
    saveUserProfile(user.uid, { mode });
  }
  _settRefreshPrefs();
  // Also re-render macro panel since basic/advanced affects it
  const panel = document.getElementById('sett-macro-panel');
  if (panel) panel.innerHTML = _settMacroPanelHTML();
}

function settSetPrepDays(days) {
  if (!state.prefs) state.prefs = {};
  state.prefs.prepDays = days;
  if (typeof savePrefs === 'function') savePrefs();
  _settSavePrefsToCloud();
  _settRefreshPrefs();
}

function settSetPrepDay(dayIdx) {
  if (!state.prefs) state.prefs = {};
  state.prefs.weekStartDay = dayIdx;
  if (typeof savePrefs === 'function') savePrefs();
  _settSavePrefsToCloud();
  _settRefreshPrefs();
}

function settSetUnits(unit) {
  state.portionUnit = unit;
  localStorage.setItem('preptarePortionUnit', unit);
  if (!state.prefs) state.prefs = {};
  state.prefs.units = unit;
  if (typeof savePrefs === 'function') savePrefs();
  _settSavePrefsToCloud();
  _settRefreshPrefs();
}
