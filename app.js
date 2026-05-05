'use strict';

// ===== Tax Data =====

// Brackets use {over, max, rate, base} where:
//   base  = cumulative tax at the start of this bracket
//   over  = "each $1 over X" threshold (matches ATO wording)
const TAX_CONFIGS = {
  '2025-26': {
    label: '2025–26',
    superRate: 0.12,
    brackets: [
      { over: 0,       max: 18200,    rate: 0,     base: 0      },
      { over: 18200,   max: 45000,    rate: 0.16,  base: 0      },
      { over: 45000,   max: 135000,   rate: 0.30,  base: 4288   },
      { over: 135000,  max: 190000,   rate: 0.37,  base: 31288  },
      { over: 190000,  max: Infinity, rate: 0.45,  base: 51638  },
    ],
    lito: { max: 700, phase1Start: 37500, phase1End: 45000, phase1Rate: 0.05, phase2End: 66667, phase2Rate: 0.015 },
    medicareThreshold: 26000,
    medicareRate: 0.02,
    medicareShadeIn: 0.10,
  },
  '2024-25': {
    label: '2024–25',
    superRate: 0.115,
    brackets: [
      { over: 0,       max: 18200,    rate: 0,     base: 0      },
      { over: 18200,   max: 45000,    rate: 0.16,  base: 0      },
      { over: 45000,   max: 135000,   rate: 0.30,  base: 4288   },
      { over: 135000,  max: 190000,   rate: 0.37,  base: 31288  },
      { over: 190000,  max: Infinity, rate: 0.45,  base: 51638  },
    ],
    lito: { max: 700, phase1Start: 37500, phase1End: 45000, phase1Rate: 0.05, phase2End: 66667, phase2Rate: 0.015 },
    medicareThreshold: 26000,
    medicareRate: 0.02,
    medicareShadeIn: 0.10,
  },
  '2023-24': {
    label: '2023–24',
    superRate: 0.11,
    brackets: [
      { over: 0,       max: 18200,    rate: 0,     base: 0      },
      { over: 18200,   max: 45000,    rate: 0.19,  base: 0      },
      { over: 45000,   max: 120000,   rate: 0.325, base: 5092   },
      { over: 120000,  max: 180000,   rate: 0.37,  base: 29467  },
      { over: 180000,  max: Infinity, rate: 0.45,  base: 51667  },
    ],
    lito: { max: 700, phase1Start: 37500, phase1End: 45000, phase1Rate: 0.05, phase2End: 66667, phase2Rate: 0.015 },
    medicareThreshold: 24276,
    medicareRate: 0.02,
    medicareShadeIn: 0.10,
  },
};

const HISTORY_KEY = 'au_tax_history';
const MAX_HISTORY = 10;

let sortState = { key: null, dir: 'asc' };

// ===== Tax Calculation =====

function calcIncomeTax(income, brackets) {
  for (const b of brackets) {
    if (income <= b.max) {
      return b.base + Math.max(0, income - b.over) * b.rate;
    }
  }
  return 0;
}

function calcLITO(income, lito) {
  if (income <= lito.phase1Start) return lito.max;
  if (income <= lito.phase1End) {
    return Math.max(0, lito.max - (income - lito.phase1Start) * lito.phase1Rate);
  }
  if (income <= lito.phase2End) {
    const atPhase1End = lito.max - (lito.phase1End - lito.phase1Start) * lito.phase1Rate;
    return Math.max(0, atPhase1End - (income - lito.phase1End) * lito.phase2Rate);
  }
  return 0;
}

function calcMedicare(income, config) {
  const { medicareThreshold, medicareRate, medicareShadeIn } = config;
  if (income <= medicareThreshold) return 0;
  // Shade-in ends when 10% of excess equals 2% of income
  // (income - threshold) * 0.10 = income * 0.02  →  income = threshold / 0.8
  const fullLevyStart = medicareThreshold / (1 - medicareRate / medicareShadeIn);
  if (income < fullLevyStart) {
    return (income - medicareThreshold) * medicareShadeIn;
  }
  return income * medicareRate;
}

function getMarginalRate(income, brackets) {
  for (const b of brackets) {
    if (income <= b.max) return b.rate;
  }
  return brackets.at(-1).rate;
}

function calculate(grossIncome, yearKey) {
  const config = TAX_CONFIGS[yearKey];
  const taxBeforeOffset = calcIncomeTax(grossIncome, config.brackets);
  const lito = Math.min(calcLITO(grossIncome, config.lito), taxBeforeOffset);
  const incomeTax = Math.max(0, taxBeforeOffset - lito);
  const medicare = calcMedicare(grossIncome, config);
  const totalTax = incomeTax + medicare;
  const netIncome = grossIncome - totalTax;
  const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;
  const marginalRate = getMarginalRate(grossIncome, config.brackets);
  const superAmount = grossIncome * config.superRate;

  return {
    grossIncome,
    yearKey,
    yearLabel: config.label,
    taxBeforeOffset,
    lito,
    incomeTax,
    medicare,
    totalTax,
    netIncome,
    effectiveRate,
    marginalRate,
    superAmount,
    superRate: config.superRate,
  };
}

// ===== Formatting =====

function fmt(amount) {
  return '$' + Math.round(amount).toLocaleString('en-AU');
}

function fmtPct(rate) {
  return (rate * 100).toFixed(2) + '%';
}

// ===== History (localStorage) =====

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addToHistory(result) {
  const history = loadHistory();
  // Remove duplicate entry for same gross + year if it already exists
  const filtered = history.filter(
    h => !(h.grossIncome === result.grossIncome && h.yearKey === result.yearKey)
  );
  filtered.unshift(result);
  const trimmed = filtered.slice(0, MAX_HISTORY);
  saveHistory(trimmed);
  return trimmed;
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ===== DOM Helpers =====

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = pct.toFixed(2) + '%';
}

// ===== Render Results =====

function renderResults(r) {
  const section = document.getElementById('results');
  section.hidden = false;

  setText('results-year-label', r.yearLabel);

  // Summary cards
  setText('r-gross', fmt(r.grossIncome));
  setText('r-tax', fmt(r.incomeTax));
  setText('r-medicare', fmt(r.medicare));
  setText('r-net', fmt(r.netIncome));

  // Tax bar
  const taxPct = r.grossIncome > 0 ? (r.incomeTax / r.grossIncome) * 100 : 0;
  const medicarePct = r.grossIncome > 0 ? (r.medicare / r.grossIncome) * 100 : 0;
  const netPct = 100 - taxPct - medicarePct;
  setWidth('bar-tax', taxPct);
  setWidth('bar-medicare', medicarePct);
  setWidth('bar-net', netPct);

  // Breakdown table
  setText('t-gross', fmt(r.grossIncome));
  setText('t-tax-before', '−' + fmt(r.taxBeforeOffset));
  setText('t-lito', '+' + fmt(r.lito));
  setText('t-medicare', '−' + fmt(r.medicare));
  setText('t-total-tax', '−' + fmt(r.totalTax));
  setText('t-net-annual', fmt(r.netIncome));
  setText('t-net-monthly', fmt(r.netIncome / 12));
  setText('t-net-fortnightly', fmt(r.netIncome / 26));
  setText('t-net-weekly', fmt(r.netIncome / 52));
  setText('t-super', fmt(r.superAmount) + ' (' + (r.superRate * 100) + '%)');
  setText('t-effective', fmtPct(r.effectiveRate));
  setText('t-marginal', fmtPct(r.marginalRate));

  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ===== Sort =====

function sortHistory(history) {
  if (!sortState.key) return history;
  return [...history].sort((a, b) => {
    const av = a[sortState.key];
    const bv = b[sortState.key];
    if (av < bv) return sortState.dir === 'asc' ? -1 : 1;
    if (av > bv) return sortState.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('#history-table th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortState.key) {
      th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ===== Render History Table =====

function renderHistory(history) {
  const section = document.getElementById('history-section');
  const tbody = document.getElementById('history-body');
  const countEl = document.getElementById('history-count');

  if (!history.length) {
    section.hidden = true;
    updateSortHeaders();
    return;
  }

  section.hidden = false;
  countEl.textContent = `(${history.length} of ${MAX_HISTORY})`;

  // Remember the most-recently-added entry before sorting so we can highlight it
  const latestKey = history[0].grossIncome + '_' + history[0].yearKey;

  tbody.innerHTML = sortHistory(history).map(r => {
    const isLatest = r.grossIncome + '_' + r.yearKey === latestKey;
    return `
      <tr class="${isLatest ? 'latest' : ''}">
        <td><strong>${fmt(r.grossIncome)}</strong></td>
        <td>${r.yearLabel}</td>
        <td class="td-deduction">${fmt(r.incomeTax)}</td>
        <td class="td-offset">${fmt(r.lito)}</td>
        <td class="td-deduction">${fmt(r.medicare)}</td>
        <td class="td-deduction"><strong>${fmt(r.totalTax)}</strong></td>
        <td class="td-net">${fmt(r.netIncome)}</td>
        <td class="td-rate">${fmtPct(r.effectiveRate)}</td>
        <td class="td-rate">${fmtPct(r.marginalRate)}</td>
      </tr>
    `;
  }).join('');

  updateSortHeaders();
}

// ===== Salary Input Formatting =====

function parseSalary(raw) {
  return parseFloat(raw.replace(/,/g, '').replace(/\$/g, '')) || 0;
}

function formatSalaryInput(input) {
  const raw = input.value.replace(/[^0-9]/g, '');
  if (!raw) { input.value = ''; return; }
  input.value = parseInt(raw, 10).toLocaleString('en-AU');
}

// ===== Main =====

function onCalculate() {
  const salaryInput = document.getElementById('salary');
  const yearKey = document.getElementById('tax-year').value;
  const gross = parseSalary(salaryInput.value);

  if (!gross || gross <= 0) {
    salaryInput.focus();
    salaryInput.style.borderColor = 'red';
    setTimeout(() => { salaryInput.closest('.input-wrapper').style.outline = ''; }, 1500);
    return;
  }

  const result = calculate(gross, yearKey);
  renderResults(result);

  const history = addToHistory(result);
  renderHistory(history);
}

function onClearHistory() {
  clearHistory();
  renderHistory([]);
}

function init() {
  const calculateBtn = document.getElementById('calculate-btn');
  const clearBtn = document.getElementById('clear-btn');
  const salaryInput = document.getElementById('salary');

  calculateBtn.addEventListener('click', onCalculate);
  clearBtn.addEventListener('click', onClearHistory);

  salaryInput.addEventListener('input', () => formatSalaryInput(salaryInput));

  salaryInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') onCalculate();
  });

  // Sortable column headers
  document.querySelectorAll('#history-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      renderHistory(loadHistory());
    });
  });

  // Render any existing history on load
  renderHistory(loadHistory());
}

document.addEventListener('DOMContentLoaded', init);
