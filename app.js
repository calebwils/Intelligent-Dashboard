/**
 * AIFORCE AGENCY — PROCUREMENT & AP INTELLIGENCE DASHBOARD 2.0
 * High-Performance Financial Engineering & Real-Time Google Sheets Engine
 * Language: Français | Devise: FCFA (XOF), EUR, USD
 */

// ==========================================================================
// CONFIGURATION GLOBALE & SOURCES DE DONNÉES
// ==========================================================================

const CONFIG = {
  sheetId: '10Zhtwgra9yr67Qt-LnflXNCMubBd8HWMSQ1YwcgJmog',
  gid: '0',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/10Zhtwgra9yr67Qt-LnflXNCMubBd8HWMSQ1YwcgJmog/edit?usp=sharing',
  csvExportUrl: 'https://docs.google.com/spreadsheets/d/10Zhtwgra9yr67Qt-LnflXNCMubBd8HWMSQ1YwcgJmog/export?format=csv&gid=0',
  gvizUrl: 'https://docs.google.com/spreadsheets/d/10Zhtwgra9yr67Qt-LnflXNCMubBd8HWMSQ1YwcgJmog/gviz/tq?gid=0',
  syncIntervalSeconds: 30,
  
  // Taux de conversion de devises
  rates: {
    XOF: 1,
    EUR: 1 / 655.957,
    USD: 1 / 605.0
  },
  currencySymbols: {
    XOF: 'FCFA',
    EUR: '€',
    USD: '$'
  },

  // Palette officielle AIFORCE AGENCY
  brandColors: {
    navy: '#0B1120',
    blue: '#0284C7',
    cyan: '#06B6D4',
    emerald: '#10B981',
    amber: '#F59E0B',
    coral: '#EF4444',
    indigo: '#6366F1',
    slate: '#64748B'
  }
};

// ==========================================================================
// ÉTAT DE L'APPLICATION (APPLICATION STATE)
// ==========================================================================

const state = {
  invoices: [],
  filteredInvoices: [],
  currentCurrency: 'XOF',
  theme: localStorage.getItem('aiforce_theme') || 'dark',
  currentTab: 'overview',
  chartMode: 'monthly', // 'monthly' | 'cumulative'
  lastSynced: null,
  syncCountdown: CONFIG.syncIntervalSeconds,
  syncTimerId: null,
  countdownTimerId: null,
  isSyncing: false,
  charts: {},
  sort: {
    column: 'sn',
    direction: 'asc'
  },
  pagination: {
    currentPage: 1,
    pageSize: 25
  },
  filters: {
    search: '',
    status: 'ALL',
    approval: 'ALL',
    vendor: 'ALL',
    dept: 'ALL',
    costCenter: 'ALL',
    requester: 'ALL',
    paymentType: 'ALL'
  },
  posTable: {
    search: '',
    status: 'ALL',
    sortColumn: 'poValue',
    sortDir: 'desc'
  },
  vendorsTable: {
    search: '',
    filter: 'ALL',
    sortColumn: 'totalTtc',
    sortDir: 'desc'
  },
  analytics: {
    subView: 'departments',
    search: '',
    sort: {
      departments: { col: 'totalTtc', dir: 'desc' },
      costCenters: { col: 'totalTtc', dir: 'desc' },
      requesters: { col: 'totalTtc', dir: 'desc' }
    }
  },
  sheetsTable: {
    search: '',
    currentPage: 1,
    pageSize: 25,
    sortCol: 'sn',
    sortDir: 'asc',
    activePresetFilter: null
  },
  ai: {
    isOpen: false,
    isThinking: false,
    isExpanded: false,
    model: (localStorage.getItem('aiforce_ai_model') && localStorage.getItem('aiforce_ai_model') !== 'qwen-plus')
      ? localStorage.getItem('aiforce_ai_model')
      : 'qwen-flash',
    baseUrl: localStorage.getItem('aiforce_ai_base_url') || 'https://ws-hrpprn3nx2citb4c.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    apiKey: localStorage.getItem('aiforce_ai_key') || '',
    hasServerKey: false,
    chats: [],
    activeChatId: null,
    editingChatId: null,
    history: []
  }
};

// ==========================================================================
// FORMATTEURS & UTILITAIRES FINANCIERS
// ==========================================================================

function parseCleanNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val)
    .replace(/\u202f/g, '')
    .replace(/\s+/g, '')
    .replace(/%/g, '')
    .replace(/,/g, '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatCurrency(amountXof, targetCurrency = state.currentCurrency, withSymbol = true) {
  const rate = CONFIG.rates[targetCurrency] || 1;
  const converted = amountXof * rate;
  const symbol = CONFIG.currencySymbols[targetCurrency] || 'FCFA';

  let formatted = '';
  if (targetCurrency === 'XOF') {
    formatted = Math.round(converted).toLocaleString('fr-FR');
  } else {
    formatted = converted.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  return withSymbol ? `${formatted} ${symbol}` : formatted;
}

function parseFrenchDate(dateStr) {
  if (!dateStr) return null;
  // Handle GViz Date(YYYY, MM, DD)
  if (typeof dateStr === 'string' && dateStr.startsWith('Date(')) {
    const parts = dateStr.replace(/Date\(|\)/g, '').split(',');
    return new Date(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
  }
  // Handle DD/MM/YYYY
  if (typeof dateStr === 'string' && dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
  }
  // Handle ISO or standard date
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateFr(dateObj) {
  if (!dateObj) return '-';
  const d = typeof dateObj === 'string' ? parseFrenchDate(dateObj) : dateObj;
  if (!d || isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// ==========================================================================
// MOTEUR DE SYNCHRONISATION EN DIRECT GOOGLE SHEETS
// ==========================================================================

/**
 * Charge les données en direct depuis Google Sheets avec fallback JSONP et local
 */
async function loadGoogleSheetData(isManual = false) {
  if (state.isSyncing) return;
  state.isSyncing = true;
  setSyncStatusUI('syncing', 'Synchronisation...');

  if (isManual) {
    const spinIcon = document.getElementById('syncIconSpin');
    if (spinIcon) spinIcon.classList.add('spin');
  }

  try {
    let rawRecords = null;

    // Étape 1 : Essai JSONP via Google Visualization API (Bypasse tous les CORS)
    try {
      rawRecords = await fetchViaGvizJsonp();
      console.log('✅ Synchronisation Google Sheets réussie via GViz JSONP:', rawRecords.length, 'lignes');
    } catch (gvizErr) {
      console.warn('Tentative GViz JSONP échouée, essai de fetch direct CSV...', gvizErr);
    }

    // Étape 2 : Essai direct Fetch CSV
    if (!rawRecords || rawRecords.length === 0) {
      try {
        const resp = await fetch(`${CONFIG.csvExportUrl}&_t=${Date.now()}`, { cache: 'no-cache' });
        if (resp.ok) {
          const csvText = await resp.text();
          rawRecords = parseCsvToObjects(csvText);
          console.log('✅ Synchronisation Google Sheets réussie via CSV Fetch direct');
        }
      } catch (fetchErr) {
        console.warn('Fetch direct CSV bloqué par CORS ou réseau...', fetchErr);
      }
    }

    // Étape 3 : Fallback Local (data.json ou cache)
    if (!rawRecords || rawRecords.length === 0) {
      if (state.invoices.length === 0) {
        try {
          const localResp = await fetch('./data.json');
          if (localResp.ok) {
            rawRecords = await localResp.json();
            console.log('ℹ️ Données chargées depuis le fallback local data.json');
          }
        } catch (localErr) {
          console.error('Erreur lecture fallback local:', localErr);
        }
      }
    }

    // Normalisation et intégration des données
    if (rawRecords && rawRecords.length > 0) {
      const normalized = normalizeInvoiceRecords(rawRecords);
      const prevCount = state.invoices.length;
      state.invoices = normalized;
      state.lastSynced = new Date();
      
      localStorage.setItem('aiforce_sheet_cache', JSON.stringify(rawRecords));
      setSyncStatusUI('success', 'Google Sheets En Direct');
      updateSyncBannerText();

      // Application des filtres & rendu
      populateVendorFilter();
      populateDeptFilter();
      populateCostCenterFilter();
      populateRequesterFilter();
      updateGlobalFilterDropdowns();
      applyFilters();
      renderAllViews();

      if (isManual) {
        showToast(`Synchronisation Google Sheets réussie (${normalized.length} factures)`, 'success');
      } else if (prevCount > 0 && prevCount !== normalized.length) {
        showToast(`Mise à jour Google Sheets détectée : ${normalized.length} factures synchronisées`, 'success');
      }
    } else {
      setSyncStatusUI('warning', 'Connecté (Cache local)');
    }

  } catch (globalErr) {
    console.error('Erreur critique synchronisation Google Sheets:', globalErr);
    setSyncStatusUI('warning', 'Hors-ligne (Données locales)');
    showToast('Connexion Google Sheets instable. Affichage des données en cache.', 'warning');
  } finally {
    state.isSyncing = false;
    const spinIcon = document.getElementById('syncIconSpin');
    if (spinIcon) spinIcon.classList.remove('spin');
    resetCountdown();
  }
}

/**
 * Exécute une requête JSONP vers Google Visualization API (Aucune restriction CORS)
 */
function fetchViaGvizJsonp() {
  return new Promise((resolve, reject) => {
    const callbackName = 'gvizCallback_' + Math.floor(Math.random() * 1000000);
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout de la requête Google Sheets'));
    }, 12000);

    window[callbackName] = function(response) {
      cleanup();
      try {
        if (!response || !response.table) {
          reject(new Error('Format de réponse Google Sheets invalide'));
          return;
        }
        const cols = response.table.cols.map(c => (c && c.label) ? c.label.trim() : '');
        const rows = response.table.rows.map(r => {
          const rowObj = {};
          r.c.forEach((cell, idx) => {
            const colName = cols[idx] || `Col_${idx}`;
            if (cell) {
              rowObj[colName] = cell.f !== undefined ? cell.f : (cell.v !== null ? cell.v : '');
            } else {
              rowObj[colName] = '';
            }
          });
          return rowObj;
        });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.src = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=responseHandler:${callbackName}&gid=${CONFIG.gid}&_t=${Date.now()}`;
    script.onerror = function(err) {
      cleanup();
      reject(err);
    };
    document.head.appendChild(script);
  });
}

/**
 * Analyseur CSV robuste avec gestion des guillemets et séparateurs
 */
function parseCsvToObjects(csvText) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let curVal = '';

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const next = csvText[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        curVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push(curVal.trim());
      curVal = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      row.push(curVal.trim());
      if (row.some(cell => cell.length > 0)) lines.push(row);
      row = [];
      curVal = '';
    } else {
      curVal += c;
    }
  }
  if (curVal.length > 0 || row.length > 0) {
    row.push(curVal.trim());
    if (row.some(cell => cell.length > 0)) lines.push(row);
  }

  if (lines.length < 2) return [];
  const headers = lines[0].map(h => h.replace(/^["']|["']$/g, '').trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = lines[i][idx] !== undefined ? lines[i][idx] : '';
    });
    records.push(obj);
  }
  return records;
}

/**
 * Normalise les champs des enregistrements de factures
 */
function normalizeInvoiceRecords(records) {
  return records.map((r, idx) => {
    const sn = parseInt(r['SN']) || (idx + 1);
    const invoiceNo = String(r['Invoice No.'] || `INV-${sn}`).trim();
    const vendorName = String(r['Vendor Name'] || 'Fournisseur Inconnu').trim();
    const vendorCode = String(r['Vendor Code'] || '').trim();
    const poNumber = String(r['PO Number'] || 'PO-NON-DEFINI').trim();
    const poStatus = String(r['PO Status'] || '').trim();
    const poValue = parseCleanNumber(r['PO Value']);
    
    const invoiceDate = parseFrenchDate(r['Invoice Date']);
    const receiptDate = parseFrenchDate(r['Invoice Receipt Date']);
    const dueDate = parseFrenchDate(r['Due Date']);
    const approvalDate = parseFrenchDate(r['Invoice Approval Date']);
    const paymentDate = parseFrenchDate(r['Payment Date']);

    const valHt = parseCleanNumber(r['Invoice Value HT']);
    const valVat = parseCleanNumber(r['VAT Amount']);
    const valTtc = parseCleanNumber(r['Invoice Value TTC']);
    const paidAmount = parseCleanNumber(r['Invoice Paid Amount']);
    const outstanding = parseCleanNumber(r['Invoice Outstanding']);
    
    const remainingPo = parseCleanNumber(r['Remaining PO Balance']);
    const poVariance = parseCleanNumber(r['PO Variance']);
    const overInvoiced = String(r['Over-Invoiced Flag'] || '').toLowerCase().includes('yes') || String(r['Over-Invoiced Flag'] || '').toLowerCase().includes('oui');

    const paymentStatus = String(r['Payment Status'] || 'Pending').trim();
    const invoiceStatus = String(r['Invoice Status'] || 'Approved').trim();
    const department = String(r['Department'] || 'Operations').trim();
    const paymentType = String(r['Type of Payment'] || 'Bank Transfer').trim();
    const requester = String(r['Requester'] || '').trim();
    const costCenter = String(r['Cost Center'] || '').trim();
    const payRef = String(r['Payment Reference'] || '').trim();
    const workDesc = String(r['Work Description'] || '').trim();
    const remarks = String(r['Remarks'] || '').trim();
    const exceptionReason = String(r['Exception / Hold Reason'] || '').trim();
    const sesGrnNo = String(r['SES/GRN No.'] || '').trim();
    const sesGrnStatus = String(r['SES/GRN Status'] || '').trim();

    const cycleDays = parseCleanNumber(r['Invoice Receipt → Payment Days']);
    const step1Days = parseCleanNumber(r['Invoice Receipt → PC Request Days']);
    const step2Days = parseCleanNumber(r['PC Sent → GRN/SES Days']);
    const step3Days = parseCleanNumber(r['GRN/SES → Finance Days']);
    const step4Days = parseCleanNumber(r['Finance → Payment Days']);

    // Champs exhaustifs du Google Sheets (54 colonnes)
    const companyCode = String(r['Company Code'] || 'BIS').trim();
    const invoiceType = String(r['Invoice Type'] || 'Material').trim();
    const pcType = String(r['PC Type'] || 'Standard').trim();
    const poCreationDate = parseFrenchDate(r['PO Creation Date']);
    const poApprovalDate = parseFrenchDate(r['PO Approval Date']);
    const currency = String(r['Currency'] || 'XOF').trim();
    const paymentTerms = String(r['Payment Terms'] || '30').trim();
    const pcSentDate = parseFrenchDate(r['PC Sent Date']);
    const grnReceivedDate = parseFrenchDate(r['GRN/SES Received Date']);
    const submitFinanceDate = parseFrenchDate(r['Submit to Finance Date']);
    const previousInvoiced = parseCleanNumber(r['Previous Invoiced Value']);
    const cumulativeInvoiced = parseCleanNumber(r['Cumulative Invoiced Value']);
    const poUtilization = String(r['PO Utilization %'] || '').trim();
    const previousPaid = parseCleanNumber(r['Previous Paid Amount']);
    const cumulativePaid = parseCleanNumber(r['Cumulative Paid Amount']);
    const poUnpaidBalance = parseCleanNumber(r['PO Unpaid Balance']);
    const finalInvoiceFlag = String(r['Final Invoice Flag'] || 'No').trim();

    return {
      sn,
      invoiceNo,
      vendorName,
      vendorCode,
      poNumber,
      poStatus,
      poValue,
      invoiceDate,
      receiptDate,
      dueDate,
      approvalDate,
      paymentDate,
      valHt,
      valVat,
      valTtc,
      paidAmount,
      outstanding,
      remainingPo,
      poVariance,
      overInvoiced,
      paymentStatus,
      invoiceStatus,
      department,
      paymentType,
      requester,
      costCenter,
      payRef,
      workDesc,
      remarks,
      exceptionReason,
      sesGrnNo,
      sesGrnStatus,
      cycleDays,
      step1Days,
      step2Days,
      step3Days,
      step4Days,
      companyCode,
      invoiceType,
      pcType,
      poCreationDate,
      poApprovalDate,
      currency,
      paymentTerms,
      pcSentDate,
      grnReceivedDate,
      submitFinanceDate,
      previousInvoiced,
      cumulativeInvoiced,
      poUtilization,
      previousPaid,
      cumulativePaid,
      poUnpaidBalance,
      finalInvoiceFlag
    };
  });
}

// ==========================================================================
// MISE À JOUR DE L'INTERFACE DE SYNCHRONISATION
// ==========================================================================

function setSyncStatusUI(status, label) {
  const dot = document.getElementById('headerSyncDot');
  const text = document.getElementById('headerSyncText');
  const bannerDot = document.getElementById('bannerBeaconDot');

  if (dot) {
    dot.className = 'beacon-dot';
    if (status === 'warning') dot.classList.add('warning');
    if (status === 'syncing') dot.classList.add('syncing');
  }
  if (bannerDot) {
    bannerDot.className = 'beacon-dot';
    if (status === 'warning') bannerDot.classList.add('warning');
    if (status === 'syncing') bannerDot.classList.add('syncing');
  }
  if (text) text.textContent = label;
}

function updateSyncBannerText() {
  const bannerTime = document.getElementById('bannerSyncTimestamp');
  const bannerRows = document.getElementById('bannerRowsCount');
  const modalRows = document.getElementById('modalRowsCount');
  const modalLast = document.getElementById('modalLastSync');

  const nowStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (bannerTime) bannerTime.textContent = `Mis à jour à ${nowStr}`;
  if (bannerRows) bannerRows.textContent = state.invoices.length;
  if (modalRows) modalRows.textContent = state.invoices.length;
  if (modalLast) modalLast.textContent = `Aujourd'hui à ${nowStr}`;
}

function resetCountdown() {
  state.syncCountdown = CONFIG.syncIntervalSeconds;
  updateCountdownDisplay();
}

function updateCountdownDisplay() {
  const countEl = document.getElementById('headerSyncCountdown');
  if (countEl) countEl.textContent = `${state.syncCountdown}s`;
}

function startAutoSyncLoop() {
  // Décompte chaque seconde
  if (state.countdownTimerId) clearInterval(state.countdownTimerId);
  state.countdownTimerId = setInterval(() => {
    state.syncCountdown--;
    if (state.syncCountdown <= 0) {
      loadGoogleSheetData(false);
    } else {
      updateCountdownDisplay();
    }
  }, 1000);
}

function triggerManualSync() {
  loadGoogleSheetData(true);
}

// ==========================================================================
// CALCUL DES MÉTRIQUES STRATÉGIQUES & KPI
// ==========================================================================

function calculateExecutiveMetrics(invoices) {
  // Calcul de la valeur des Bons de Commande (prise en compte des avenants/valeur max approuvée)
  const poMap = new Map();
  invoices.forEach(inv => {
    if (inv.poNumber) {
      const cur = poMap.get(inv.poNumber) || 0;
      poMap.set(inv.poNumber, Math.max(cur, inv.poValue));
    }
  });

  const totalPoValue = Array.from(poMap.values()).reduce((sum, v) => sum + v, 0);
  const totalInvoicedTtc = invoices.reduce((sum, inv) => sum + inv.valTtc, 0);
  const totalInvoicedHt = invoices.reduce((sum, inv) => sum + inv.valHt, 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.outstanding, 0);

  // Cycle time moyen (jours)
  const validCycles = invoices.filter(inv => inv.cycleDays > 0).map(inv => inv.cycleDays);
  const avgCycle = validCycles.length > 0 ? (validCycles.reduce((a, b) => a + b, 0) / validCycles.length) : 0;

  // Alertes : Surfacturations (Over-Invoiced Flag) et Exceptions documentaires
  const overInvoicedCases = invoices.filter(inv => inv.overInvoiced);
  const exceptionCases = invoices.filter(inv => inv.invoiceStatus === 'Exception' || inv.invoiceStatus === 'On Hold' || (inv.exceptionReason && inv.exceptionReason.trim().length > 0));

  // Nombre de factures soldées vs en attente
  const paidCount = invoices.filter(inv => inv.paymentStatus === 'Paid').length;
  const pendingCount = invoices.filter(inv => inv.paymentStatus !== 'Paid').length;

  return {
    totalPoValue,
    totalInvoicedTtc,
    totalInvoicedHt,
    totalPaid,
    totalOutstanding,
    avgCycle,
    paidRate: totalInvoicedTtc > 0 ? (totalPaid / totalInvoicedTtc) * 100 : 0,
    paidCount,
    pendingCount,
    distinctPoCount: poMap.size,
    totalInvoicesCount: invoices.length,
    overInvoicedCount: overInvoicedCases.length,
    exceptionCount: exceptionCases.length,
    alertCount: overInvoicedCases.length + exceptionCases.length,
    overInvoicedCases,
    exceptionCases
  };
}

function updateGlobalNavBadges() {
  const navInvoices = document.getElementById('navInvoicesBadge');
  const navPos = document.getElementById('navPosBadge');
  const navVendors = document.getElementById('navVendorsBadge');
  const navAudit = document.getElementById('navAuditBadge');

  if (navInvoices) navInvoices.textContent = state.invoices.length;
  if (navPos) {
    const uniquePos = new Set(state.invoices.map(i => i.poNumber).filter(Boolean)).size;
    navPos.textContent = uniquePos;
  }
  if (navVendors) {
    const uniqueVendors = new Set(state.invoices.map(i => i.vendorName).filter(Boolean)).size;
    navVendors.textContent = uniqueVendors;
  }
  if (navAudit) {
    const overInvoicedCount = state.invoices.filter(i => i.overInvoiced).length;
    navAudit.textContent = overInvoicedCount;
  }
}

function renderKpiCards(metrics) {
  // Met à jour les KPI avec la devise active
  const elPoVal = document.getElementById('kpiPoValue');
  const elInvTtc = document.getElementById('kpiInvoicedTtc');
  const elInvHt = document.getElementById('kpiInvoicedHt');
  const elInvCount = document.getElementById('kpiInvoicedCount');
  const elPaid = document.getElementById('kpiPaidAmount');
  const elPaidRate = document.getElementById('kpiPaidRate');
  const elOut = document.getElementById('kpiOutstandingAmount');
  const elPendingCount = document.getElementById('kpiPendingCount');
  const elCycle = document.getElementById('kpiAvgCycle');
  const elAlert = document.getElementById('kpiAlertCount');

  if (elPoVal) elPoVal.textContent = formatCurrency(metrics.totalPoValue, state.currentCurrency, false);
  if (elInvTtc) elInvTtc.textContent = formatCurrency(metrics.totalInvoicedTtc, state.currentCurrency, false);
  if (elInvHt) elInvHt.textContent = `${(metrics.totalInvoicedHt / 1000000).toFixed(1)}M`;
  if (elInvCount) elInvCount.textContent = `${metrics.totalInvoicesCount} factures`;
  if (elPaid) elPaid.textContent = formatCurrency(metrics.totalPaid, state.currentCurrency, false);
  if (elPaidRate) elPaidRate.textContent = `${metrics.paidRate.toFixed(1)}% décaissé`;
  if (elOut) elOut.textContent = formatCurrency(metrics.totalOutstanding, state.currentCurrency, false);
  if (elPendingCount) elPendingCount.textContent = `${metrics.pendingCount} en attente`;
  if (elCycle) elCycle.textContent = metrics.avgCycle.toFixed(1);
  if (elAlert) elAlert.textContent = `${metrics.overInvoicedCount}`;

  // Mettre à jour les labels de devise
  ['currLabel1', 'currLabel2', 'currLabel3', 'currLabel4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = CONFIG.currencySymbols[state.currentCurrency];
  });

  // Toujours mettre à jour les badges du menu sur la base globale
  updateGlobalNavBadges();
}

// ==========================================================================
// VISUALISATIONS GRAPHIQUES (CHART.JS)
// ==========================================================================

function getChartThemeColors() {
  const isDark = state.theme === 'dark';
  return {
    textColor: isDark ? '#94A3B8' : '#475569',
    gridColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
    tooltipBg: isDark ? '#141F35' : '#FFFFFF',
    tooltipBorder: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.12)',
    tooltipText: isDark ? '#F8FAFC' : '#0F172A'
  };
}

function initOrUpdateCharts() {
  const theme = getChartThemeColors();

  renderTrajectoryChart(theme);
  renderDepartmentChart(theme);
  renderAgingChart(theme);
  renderSlaCharts(theme);
  renderAnalyticsCharts(theme);
}

/**
 * Graphique 1 : Trajectoire Financière (Facturé vs Décaissements)
 */
function renderTrajectoryChart(theme) {
  const ctx = document.getElementById('trajectoryChart');
  if (!ctx) return;

  // Agrégation par mois (ex: Mars 2026, Avril 2026...)
  const monthlyData = {};
  state.filteredInvoices.forEach(inv => {
    const d = inv.invoiceDate;
    if (!d) return;
    const monthKey = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { invoiced: 0, paid: 0, sortKey: d.getFullYear() * 100 + d.getMonth() };
    }
    monthlyData[monthKey].invoiced += inv.valTtc;
    monthlyData[monthKey].paid += inv.paidAmount;
  });

  const sortedKeys = Object.keys(monthlyData).sort((a, b) => monthlyData[a].sortKey - monthlyData[b].sortKey);
  
  let invoicedVals = sortedKeys.map(k => monthlyData[k].invoiced * CONFIG.rates[state.currentCurrency]);
  let paidVals = sortedKeys.map(k => monthlyData[k].paid * CONFIG.rates[state.currentCurrency]);

  if (state.chartMode === 'cumulative') {
    let accInv = 0, accPaid = 0;
    invoicedVals = invoicedVals.map(v => accInv += v);
    paidVals = paidVals.map(v => accPaid += v);
  }

  if (state.charts.trajectory) state.charts.trajectory.destroy();

  state.charts.trajectory = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedKeys,
      datasets: [
        {
          label: 'Total Facturé TTC',
          data: invoicedVals,
          backgroundColor: 'rgba(2, 132, 199, 0.75)',
          borderColor: '#0284C7',
          borderWidth: 1.5,
          borderRadius: 6
        },
        {
          label: 'Règlements Décaissés',
          data: paidVals,
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderColor: '#10B981',
          borderWidth: 1.5,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', weight: '600', size: 11 } }
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          titleColor: theme.tooltipText,
          bodyColor: theme.tooltipText,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(c) {
              return ` ${c.dataset.label} : ${Math.round(c.raw).toLocaleString('fr-FR')} ${CONFIG.currencySymbols[state.currentCurrency]}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: theme.gridColor },
          ticks: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
        },
        y: {
          grid: { color: theme.gridColor },
          ticks: {
            color: theme.textColor,
            font: { family: 'JetBrains Mono', size: 10 },
            callback: v => `${(v / 1000000).toFixed(1)}M`
          }
        }
      }
    }
  });
}

/**
 * Graphique 2 : Répartition par Département
 */
function renderDepartmentChart(theme) {
  const ctx = document.getElementById('deptChart');
  if (!ctx) return;

  const deptMap = {};
  state.filteredInvoices.forEach(inv => {
    deptMap[inv.department] = (deptMap[inv.department] || 0) + (inv.valTtc * CONFIG.rates[state.currentCurrency]);
  });

  const labels = Object.keys(deptMap);
  const values = Object.values(deptMap);

  const colors = [
    '#0284C7', '#10B981', '#F59E0B', '#EF4444',
    '#6366F1', '#06B6D4', '#8B5CF6', '#EC4899'
  ];

  if (state.charts.department) state.charts.department.destroy();

  state.charts.department = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: state.theme === 'dark' ? '#0E1626' : '#FFFFFF'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          titleColor: theme.tooltipText,
          bodyColor: theme.tooltipText,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: function(c) {
              const val = Math.round(c.raw).toLocaleString('fr-FR');
              const total = values.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((c.raw / total) * 100).toFixed(1) : 0;
              return ` ${c.label} : ${val} ${CONFIG.currencySymbols[state.currentCurrency]} (${pct}%)`;
            }
          }
        }
      },
      cutout: '68%'
    }
  });
}

/**
 * Graphique 3 : Balance Âgée & Échéancier
 */
function renderAgingChart(theme) {
  const ctx = document.getElementById('agingChart');
  if (!ctx) return;

  const buckets = {
    '0 - 30 Jours': 0,
    '31 - 60 Jours': 0,
    '61 - 90 Jours': 0,
    '> 90 Jours': 0
  };

  const now = new Date();
  state.filteredInvoices.forEach(inv => {
    if (inv.outstanding <= 0) return;
    const due = inv.dueDate || inv.invoiceDate;
    if (!due) return;
    const diffDays = Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)));

    const val = inv.outstanding * CONFIG.rates[state.currentCurrency];
    if (diffDays <= 30) buckets['0 - 30 Jours'] += val;
    else if (diffDays <= 60) buckets['31 - 60 Jours'] += val;
    else if (diffDays <= 90) buckets['61 - 90 Jours'] += val;
    else buckets['> 90 Jours'] += val;
  });

  if (state.charts.aging) state.charts.aging.destroy();

  state.charts.aging = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        label: 'Encours Restant Dû',
        data: Object.values(buckets),
        backgroundColor: [
          'rgba(16, 185, 129, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(239, 68, 68, 0.8)',
          'rgba(139, 92, 246, 0.8)'
        ],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          titleColor: theme.tooltipText,
          bodyColor: theme.tooltipText,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: function(c) {
              return ` Solde dû : ${Math.round(c.raw).toLocaleString('fr-FR')} ${CONFIG.currencySymbols[state.currentCurrency]}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: theme.gridColor },
          ticks: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
        },
        y: {
          grid: { color: theme.gridColor },
          ticks: {
            color: theme.textColor,
            font: { family: 'JetBrains Mono', size: 10 },
            callback: v => `${(v / 1000000).toFixed(1)}M`
          }
        }
      }
    }
  });
}

/**
 * Graphiques SLA & Délais
 */
function renderSlaCharts(theme) {
  const ctxStages = document.getElementById('slaStagesChart');
  const ctxDept = document.getElementById('slaDeptChart');

  if (ctxStages) {
    const stage1 = calcAvg(state.filteredInvoices.map(i => i.step1Days));
    const stage2 = calcAvg(state.filteredInvoices.map(i => i.step2Days));
    const stage3 = calcAvg(state.filteredInvoices.map(i => i.step3Days));
    const stage4 = calcAvg(state.filteredInvoices.map(i => i.step4Days));

    if (state.charts.slaStages) state.charts.slaStages.destroy();

    state.charts.slaStages = new Chart(ctxStages, {
      type: 'bar',
      data: {
        labels: [
          'Réception → Demande PC',
          'Demande PC → SES/GRN',
          'SES/GRN → Finance',
          'Finance → Paiement'
        ],
        datasets: [{
          label: 'Délai Moyen (Jours)',
          data: [stage1, stage2, stage3, stage4],
          backgroundColor: ['#0284C7', '#06B6D4', '#F59E0B', '#10B981'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              label: c => ` Délai moyen : ${c.raw.toFixed(1)} jours`
            }
          }
        },
        scales: {
          x: { grid: { color: theme.gridColor }, ticks: { color: theme.textColor } },
          y: { grid: { color: theme.gridColor }, ticks: { color: theme.textColor } }
        }
      }
    });
  }

  if (ctxDept) {
    const deptCycleMap = {};
    state.filteredInvoices.forEach(inv => {
      if (inv.cycleDays > 0) {
        if (!deptCycleMap[inv.department]) deptCycleMap[inv.department] = [];
        deptCycleMap[inv.department].push(inv.cycleDays);
      }
    });

    const labels = Object.keys(deptCycleMap);
    const avgs = labels.map(k => calcAvg(deptCycleMap[k]));

    if (state.charts.slaDept) state.charts.slaDept.destroy();

    state.charts.slaDept = new Chart(ctxDept, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Cycle Moyen (Jours)',
          data: avgs,
          backgroundColor: '#6366F1',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              label: c => ` Cycle moyen : ${c.raw.toFixed(1)} jours`
            }
          }
        },
        scales: {
          x: { grid: { color: theme.gridColor }, ticks: { color: theme.textColor } },
          y: { grid: { color: theme.gridColor }, ticks: { color: theme.textColor } }
        }
      }
    });
  }
}

function calcAvg(arr) {
  const valid = arr.filter(n => typeof n === 'number' && !isNaN(n) && n > 0);
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

// ==========================================================================
// RENDU DU GRAND LIVRE FACTURES & PAGINATION
// ==========================================================================

function renderMasterLedgerTable() {
  const tbody = document.getElementById('masterLedgerTbody');
  if (!tbody) return;

  const totalFiltered = state.filteredInvoices.length;
  const { currentPage, pageSize } = state.pagination;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;

  if (currentPage > totalPages) state.pagination.currentPage = 1;

  const startIdx = (state.pagination.currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalFiltered);
  const pagedRecords = state.filteredInvoices.slice(startIdx, endIdx);

  // Mettre à jour les labels de pagination
  const startEl = document.getElementById('pageShowingStart');
  const endEl = document.getElementById('pageShowingEnd');
  const countEl = document.getElementById('pageTotalCount');
  const labelEl = document.getElementById('pageCurrentLabel');
  const btnPrev = document.getElementById('btnPrevPage');
  const btnNext = document.getElementById('btnNextPage');

  if (startEl) startEl.textContent = totalFiltered === 0 ? 0 : startIdx + 1;
  if (endEl) endEl.textContent = endIdx;
  if (countEl) countEl.textContent = totalFiltered;
  if (labelEl) labelEl.textContent = `${state.pagination.currentPage} / ${totalPages}`;
  if (btnPrev) btnPrev.disabled = state.pagination.currentPage <= 1;
  if (btnNext) btnNext.disabled = state.pagination.currentPage >= totalPages;

  if (pagedRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="15" style="text-align: center; padding: 3rem 1rem; color: var(--text-tertiary);">
          Aucune facture ne correspond aux critères de recherche et filtres sélectionnés.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pagedRecords.map(inv => {
    const statusClass = getStatusClass(inv.paymentStatus);
    const approvalClass = getApprovalClass(inv.invoiceStatus);

    return `
      <tr onclick="openInvoiceDrawer('${inv.invoiceNo}')">
        <td class="mono-val" style="color: var(--text-tertiary);">${inv.sn}</td>
        <td style="font-weight: 700; color: var(--text-primary); font-family: var(--font-mono);">
          <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
            <span>${inv.invoiceNo}</span>
            ${inv.overInvoiced ? '<span class="pill-alert" title="Alerte Surfacturation BC">⚠️</span>' : ''}
          </div>
        </td>
        <td class="mono-val">${formatDateFr(inv.invoiceDate)}</td>
        <td style="font-weight: 600;">${escapeHtml(inv.vendorName)}</td>
        <td class="mono-val" style="color: var(--accent-cyan); font-weight: 600;">${inv.poNumber}</td>
        <td><span style="font-weight: 500; color: var(--text-secondary); cursor: pointer;" onclick="event.stopPropagation(); filterBySpecificDept('${escapeHtml(inv.department)}')" title="Filtrer par ce département">${escapeHtml(inv.department || '-')}</span></td>
        <td><span class="mono-val" style="font-size: 0.78rem; color: var(--text-secondary); cursor: pointer;" onclick="event.stopPropagation(); handleGlobalFilterChange('costCenter', '${escapeHtml(inv.costCenter)}')" title="Filtrer par ce centre">${escapeHtml(inv.costCenter || '-')}</span></td>
        <td><span class="mono-val" style="font-size: 0.75rem; color: var(--text-secondary); cursor: pointer;" onclick="event.stopPropagation(); handleGlobalFilterChange('requester', '${escapeHtml(inv.requester)}')" title="Filtrer par ce demandeur">${escapeHtml(inv.requester || '-')}</span></td>
        <td><span style="font-size: 0.75rem; color: var(--text-tertiary); max-width: 140px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(inv.workDesc)}">${escapeHtml(inv.workDesc || '-')}</span></td>
        <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(inv.valTtc)}</td>
        <td style="text-align: right; color: var(--accent-emerald);" class="mono-val">${formatCurrency(inv.paidAmount)}</td>
        <td style="text-align: right; color: ${inv.outstanding > 0 ? 'var(--accent-amber)' : 'var(--text-tertiary)'};" class="mono-val">${formatCurrency(inv.outstanding)}</td>
        <td class="mono-val" style="text-align: center;">${inv.cycleDays ? `${inv.cycleDays} j` : '-'}</td>
        <td><span class="badge-status ${statusClass}">${translateStatus(inv.paymentStatus)}</span></td>
        <td><span class="badge-status ${approvalClass}">${translateStatus(inv.invoiceStatus)}</span></td>
      </tr>
      <tr id="rowExpand-${inv.sn}" class="row-expand-tr" style="display: none;">
        <td colspan="15" style="padding: 0;">
          <div class="row-expand-box">
            <div class="row-expand-grid">
              
              <!-- 1. Identité & Entité Juridique -->
              <div class="expand-group">
                <div class="expand-group-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>
                  <span>1. Entité & Enregistrement</span>
                </div>
                <div class="expand-data-list">
                  <div class="expand-data-item"><span class="expand-data-label">SN / N° Enregistrement :</span><span class="expand-data-val mono-val">${inv.sn}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Société (Company Code) :</span><span class="expand-data-val">${escapeHtml(inv.companyCode || 'BIS')}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Code Fournisseur :</span><span class="expand-data-val mono-val">${inv.vendorCode}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Type Facture :</span><span class="expand-data-val">${escapeHtml(inv.invoiceType || 'Standard')}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Type Commande (PC Type) :</span><span class="expand-data-val">${escapeHtml(inv.pcType || 'Standard')}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">N° SES / GRN :</span><span class="expand-data-val mono-val">${escapeHtml(inv.sesGrnNo || '-')}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Statut SES / GRN :</span><span class="expand-data-val">${escapeHtml(inv.sesGrnStatus || 'Validé')}</span></div>
                </div>
              </div>

              <!-- 2. Imputation Analytique & Prestation -->
              <div class="expand-group">
                <div class="expand-group-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                  <span>2. Imputation & Affectation</span>
                </div>
                <div class="expand-data-list">
                  <div class="expand-data-item"><span class="expand-data-label">Département :</span><span class="expand-data-val">${escapeHtml(inv.department)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Centre de Coût :</span><span class="expand-data-val mono-val">${escapeHtml(inv.costCenter)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Demandeur / Prescripteur :</span><span class="expand-data-val mono-val">${escapeHtml(inv.requester)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Description Prestation :</span><span class="expand-data-val" style="max-width: 170px;">${escapeHtml(inv.workDesc || '-')}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Mode de Règlement :</span><span class="expand-data-val">${escapeHtml(inv.paymentType)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Conditions de Paiement :</span><span class="expand-data-val mono-val">${escapeHtml(inv.paymentTerms)} j</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Réf Paiement :</span><span class="expand-data-val mono-val">${escapeHtml(inv.payRef || '-')}</span></div>
                </div>
              </div>

              <!-- 3. Calendrier & Chronologie SLA -->
              <div class="expand-group">
                <div class="expand-group-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span>3. Calendrier & Délais (Jours)</span>
                </div>
                <div class="expand-data-list">
                  <div class="expand-data-item"><span class="expand-data-label">Réception Facture :</span><span class="expand-data-val mono-val">${formatDateFr(inv.receiptDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Création Bon Commande :</span><span class="expand-data-val mono-val">${formatDateFr(inv.poCreationDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Envoi PC :</span><span class="expand-data-val mono-val">${formatDateFr(inv.pcSentDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Réception SES/GRN :</span><span class="expand-data-val mono-val">${formatDateFr(inv.grnReceivedDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Dépôt Finance :</span><span class="expand-data-val mono-val">${formatDateFr(inv.submitFinanceDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Approbation Facture :</span><span class="expand-data-val mono-val">${formatDateFr(inv.approvalDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Date Paiement Réel :</span><span class="expand-data-val mono-val">${formatDateFr(inv.paymentDate)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Cycle Total SLA :</span><span class="expand-data-val mono-val" style="color: var(--accent-cyan); font-weight: 800;">${inv.cycleDays ? inv.cycleDays + ' jours' : '-'}</span></div>
                </div>
              </div>

              <!-- 4. Budget BC & Contrôle des Risques -->
              <div class="expand-group">
                <div class="expand-group-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                  <span>4. Suivi Budget Bon Commande</span>
                </div>
                <div class="expand-data-list">
                  <div class="expand-data-item"><span class="expand-data-label">Valeur Totale BC :</span><span class="expand-data-val mono-val font-weight: 700;">${formatCurrency(inv.poValue)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Montant Facturé TTC :</span><span class="expand-data-val mono-val" style="color: var(--accent-cyan); font-weight: 800;">${formatCurrency(inv.valTtc)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Cumul Facturé sur le BC :</span><span class="expand-data-val mono-val">${formatCurrency(inv.cumulativeInvoiced)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Solde Disponible sur le BC :</span><span class="expand-data-val mono-val" style="color: ${inv.remainingPo < 0 ? 'var(--accent-coral)' : 'var(--accent-emerald)'}; font-weight: 700;">${formatCurrency(inv.remainingPo)}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Taux d'Utilisation du BC :</span><span class="expand-data-val mono-val font-weight: 800;">${inv.poUtilization || '-'}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Alerte Surfacturation :</span><span class="expand-data-val" style="color: ${inv.overInvoiced ? 'var(--accent-coral)' : 'var(--accent-emerald)'}; font-weight: 800;">${inv.overInvoiced ? 'OUI (Dépassement)' : 'NON (Conforme)'}</span></div>
                  <div class="expand-data-item"><span class="expand-data-label">Motif Litige / Exception :</span><span class="expand-data-val" style="color: var(--accent-amber);">${escapeHtml(inv.exceptionReason || inv.remarks || 'Aucun')}</span></div>
                </div>
              </div>

            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getStatusClass(status) {
  const s = String(status).toLowerCase();
  if (s.includes('paid') && !s.includes('partially')) return 'paid';
  if (s.includes('partially')) return 'partially-paid';
  if (s.includes('overdue')) return 'overdue';
  return 'pending';
}

function getApprovalClass(status) {
  const s = String(status).toLowerCase();
  if (s.includes('approved')) return 'approved';
  if (s.includes('exception')) return 'exception';
  if (s.includes('hold')) return 'on-hold';
  return 'processing';
}

function translateStatus(status) {
  const dict = {
    'Paid': 'Soldé',
    'Partially Paid': 'Partiel',
    'Pending': 'En attente',
    'Approved': 'Approuvé',
    'Exception': 'Exception',
    'On Hold': 'En attente',
    'Processing': 'En cours',
    'Paid Late': 'Soldé (Retard)'
  };
  return dict[status] || status;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================================================
// FILTRES & RECHERCHE
// ==========================================================================

function handleSearch(val) {
  state.filters.search = (val || '').toLowerCase().trim();
  state.pagination.currentPage = 1;
  applyFilters();
}

function applyFilters() {
  const { search, status, approval, vendor, dept, costCenter, requester, paymentType } = state.filters;
  const selectStatus = document.getElementById('filterStatus')?.value || status;
  const selectApproval = document.getElementById('filterApproval')?.value || approval;
  const selectVendor = document.getElementById('filterVendor')?.value || vendor;
  const selectDept = document.getElementById('filterDept')?.value || dept;
  const selectCostCenter = document.getElementById('filterCostCenter')?.value || costCenter;
  const selectRequester = document.getElementById('filterRequester')?.value || requester;
  const selectPaymentType = document.getElementById('filterPaymentType')?.value || paymentType;

  state.filters.status = selectStatus;
  state.filters.approval = selectApproval;
  state.filters.vendor = selectVendor;
  state.filters.dept = selectDept;
  state.filters.costCenter = selectCostCenter;
  state.filters.requester = selectRequester;
  state.filters.paymentType = selectPaymentType;

  state.filteredInvoices = state.invoices.filter(inv => {
    // Recherche globale
    if (search) {
      const match =
        inv.invoiceNo.toLowerCase().includes(search) ||
        inv.vendorName.toLowerCase().includes(search) ||
        inv.poNumber.toLowerCase().includes(search) ||
        inv.department.toLowerCase().includes(search) ||
        inv.workDesc.toLowerCase().includes(search) ||
        inv.requester.toLowerCase().includes(search) ||
        inv.costCenter.toLowerCase().includes(search);
      if (!match) return false;
    }

    // Filtre Statut Paiement
    if (selectStatus !== 'ALL' && inv.paymentStatus !== selectStatus) return false;

    // Filtre Statut Approbation
    if (selectApproval !== 'ALL' && inv.invoiceStatus !== selectApproval) return false;

    // Filtre Fournisseur
    if (selectVendor !== 'ALL' && inv.vendorName !== selectVendor) return false;

    // Filtre Département
    if (selectDept !== 'ALL' && inv.department !== selectDept) return false;

    // Filtre Centre de Coût
    if (selectCostCenter !== 'ALL' && inv.costCenter !== selectCostCenter) return false;

    // Filtre Demandeur
    if (selectRequester !== 'ALL' && inv.requester !== selectRequester) return false;

    // Filtre Mode de Règlement
    if (selectPaymentType !== 'ALL' && inv.paymentType !== selectPaymentType) return false;

    return true;
  });

  // Tri
  sortInvoicesArray(state.filteredInvoices, state.sort.column, state.sort.direction);

  // Mise à jour de l'UI
  renderMasterLedgerTable();
  const metrics = calculateExecutiveMetrics(state.filteredInvoices);
  renderKpiCards(metrics);
  initOrUpdateCharts();
  renderOverviewDeptTable();
  renderFullSheetsTable();
  updateActiveFilterIndicator();
}

function resetLedgerFilters() {
  resetAllGlobalFilters();
}

// ==========================================================================
// BARRE DE FILTRAGE UNIVERSELLE & SYNCHRONISATION MULTI-DIMENSIONS
// ==========================================================================

// ==========================================================================
// CUSTOM EXECUTIVE DROPDOWN SELECT COMPONENTS
// ==========================================================================

function toggleCustomSelect(field, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const idMap = {
    dept: 'csBoxDept',
    costCenter: 'csBoxCostCenter',
    requester: 'csBoxRequester',
    status: 'csBoxStatus',
    approval: 'csBoxApproval'
  };
  const boxId = idMap[field];
  const box = document.getElementById(boxId);
  if (!box) return;

  const isOpen = box.classList.contains('is-open');
  closeAllCustomDropdowns();
  if (!isOpen) {
    box.classList.add('is-open');
  }
}

function closeAllCustomDropdowns() {
  document.querySelectorAll('.custom-select-box').forEach(b => b.classList.remove('is-open'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select-box')) {
    closeAllCustomDropdowns();
  }
});

function selectCustomOption(field, val, label) {
  const lblMap = {
    dept: 'csLabelDept',
    costCenter: 'csLabelCostCenter',
    requester: 'csLabelRequester',
    status: 'csLabelStatus',
    approval: 'csLabelApproval'
  };
  const lbl = document.getElementById(lblMap[field]);
  if (lbl) lbl.textContent = label;

  closeAllCustomDropdowns();
  handleGlobalFilterChange(field, val);
}

function handleGlobalFilterChange(field, val) {
  state.filters[field] = val;

  // Sync specific dropdowns
  if (field === 'dept') {
    const d1 = document.getElementById('globalFilterDept');
    const d2 = document.getElementById('filterDept');
    if (d1) d1.value = val;
    if (d2) d2.value = val;
  } else if (field === 'costCenter') {
    const c1 = document.getElementById('globalFilterCostCenter');
    const c2 = document.getElementById('filterCostCenter');
    if (c1) c1.value = val;
    if (c2) c2.value = val;
  } else if (field === 'requester') {
    const r1 = document.getElementById('globalFilterRequester');
    const r2 = document.getElementById('filterRequester');
    if (r1) r1.value = val;
    if (r2) r2.value = val;
  } else if (field === 'status') {
    const s1 = document.getElementById('globalFilterStatus');
    const s2 = document.getElementById('filterStatus');
    if (s1) s1.value = val;
    if (s2) s2.value = val;
  } else if (field === 'approval') {
    const a1 = document.getElementById('globalFilterApproval');
    const a2 = document.getElementById('filterApproval');
    if (a1) a1.value = val;
    if (a2) a2.value = val;
  }

  updateGlobalFilterDropdowns();
  state.pagination.currentPage = 1;
  applyFilters();
}

function resetAllGlobalFilters() {
  state.filters = {
    search: '',
    status: 'ALL',
    approval: 'ALL',
    vendor: 'ALL',
    dept: 'ALL',
    costCenter: 'ALL',
    requester: 'ALL',
    paymentType: 'ALL'
  };

  ['globalFilterDept', 'globalFilterCostCenter', 'globalFilterRequester', 'globalFilterStatus', 'globalFilterApproval',
   'filterStatus', 'filterApproval', 'filterVendor', 'filterDept', 'filterCostCenter', 'filterRequester', 'filterPaymentType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'ALL';
  });

  const searchInput = document.getElementById('ledgerSearchInput');
  if (searchInput) searchInput.value = '';

  updateGlobalFilterDropdowns();
  state.pagination.currentPage = 1;
  applyFilters();
  showToast('Filtres analytiques réinitialisés', 'success');
}

function updateGlobalFilterDropdowns() {
  const depts = Array.from(new Set(state.invoices.map(i => i.department).filter(Boolean))).sort();
  const ccs = Array.from(new Set(state.invoices.map(i => i.costCenter).filter(Boolean))).sort();
  const reqs = Array.from(new Set(state.invoices.map(i => i.requester).filter(Boolean))).sort();

  // 1. Département Custom Menu & Hidden Select
  const selDept = document.getElementById('globalFilterDept');
  if (selDept) {
    selDept.innerHTML = `<option value="ALL">Tous départements (${depts.length})</option>` +
      depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    selDept.value = state.filters.dept;
  }
  const menuDept = document.getElementById('csMenuDept');
  const lblDept = document.getElementById('csLabelDept');
  if (menuDept) {
    const curDept = state.filters.dept;
    let html = `
      <div class="custom-select-option ${curDept === 'ALL' ? 'is-selected' : ''}" onclick="selectCustomOption('dept', 'ALL', 'Tous départements (${depts.length})')">
        <span>Tous départements (${depts.length})</span>
        ${curDept === 'ALL' ? '<span class="opt-check">✓</span>' : ''}
      </div>
    `;
    depts.forEach(d => {
      const isSel = curDept === d;
      html += `
        <div class="custom-select-option ${isSel ? 'is-selected' : ''}" onclick="selectCustomOption('dept', '${escapeHtml(d)}', '${escapeHtml(d)}')">
          <span>${escapeHtml(d)}</span>
          ${isSel ? '<span class="opt-check">✓</span>' : ''}
        </div>
      `;
    });
    menuDept.innerHTML = html;
    if (lblDept) {
      lblDept.textContent = curDept === 'ALL' ? `Tous départements (${depts.length})` : curDept;
    }
  }

  // 2. Centre de Coût Custom Menu & Hidden Select
  const selCc = document.getElementById('globalFilterCostCenter');
  if (selCc) {
    selCc.innerHTML = `<option value="ALL">Tous centres de coût (${ccs.length})</option>` +
      ccs.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    selCc.value = state.filters.costCenter;
  }
  const menuCc = document.getElementById('csMenuCostCenter');
  const lblCc = document.getElementById('csLabelCostCenter');
  if (menuCc) {
    const curCc = state.filters.costCenter;
    let html = `
      <div class="custom-select-option ${curCc === 'ALL' ? 'is-selected' : ''}" onclick="selectCustomOption('costCenter', 'ALL', 'Tous centres de coût (${ccs.length})')">
        <span>Tous centres de coût (${ccs.length})</span>
        ${curCc === 'ALL' ? '<span class="opt-check">✓</span>' : ''}
      </div>
    `;
    ccs.forEach(c => {
      const isSel = curCc === c;
      html += `
        <div class="custom-select-option ${isSel ? 'is-selected' : ''}" onclick="selectCustomOption('costCenter', '${escapeHtml(c)}', '${escapeHtml(c)}')">
          <span>${escapeHtml(c)}</span>
          ${isSel ? '<span class="opt-check">✓</span>' : ''}
        </div>
      `;
    });
    menuCc.innerHTML = html;
    if (lblCc) {
      lblCc.textContent = curCc === 'ALL' ? `Tous centres de coût (${ccs.length})` : curCc;
    }
  }

  // 3. Demandeur Custom Menu & Hidden Select
  const selReq = document.getElementById('globalFilterRequester');
  if (selReq) {
    selReq.innerHTML = `<option value="ALL">Tous demandeurs (${reqs.length})</option>` +
      reqs.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    selReq.value = state.filters.requester;
  }
  const menuReq = document.getElementById('csMenuRequester');
  const lblReq = document.getElementById('csLabelRequester');
  if (menuReq) {
    const curReq = state.filters.requester;
    let html = `
      <div class="custom-select-option ${curReq === 'ALL' ? 'is-selected' : ''}" onclick="selectCustomOption('requester', 'ALL', 'Tous demandeurs (${reqs.length})')">
        <span>Tous demandeurs (${reqs.length})</span>
        ${curReq === 'ALL' ? '<span class="opt-check">✓</span>' : ''}
      </div>
    `;
    reqs.forEach(r => {
      const isSel = curReq === r;
      html += `
        <div class="custom-select-option ${isSel ? 'is-selected' : ''}" onclick="selectCustomOption('requester', '${escapeHtml(r)}', '${escapeHtml(r)}')">
          <span>${escapeHtml(r)}</span>
          ${isSel ? '<span class="opt-check">✓</span>' : ''}
        </div>
      `;
    });
    menuReq.innerHTML = html;
    if (lblReq) {
      lblReq.textContent = curReq === 'ALL' ? `Tous demandeurs (${reqs.length})` : curReq;
    }
  }

  // 4. Statut Paiement Custom Menu & Hidden Select
  const statusList = [
    { val: 'ALL', label: 'Tous les statuts' },
    { val: 'Paid', label: 'Soldé (Paid)' },
    { val: 'Partially Paid', label: 'Partiellement payé' },
    { val: 'Pending', label: 'En attente (Pending)' }
  ];
  const menuStatus = document.getElementById('csMenuStatus');
  const lblStatus = document.getElementById('csLabelStatus');
  if (menuStatus) {
    const curStatus = state.filters.status;
    menuStatus.innerHTML = statusList.map(s => `
      <div class="custom-select-option ${curStatus === s.val ? 'is-selected' : ''}" onclick="selectCustomOption('status', '${s.val}', '${escapeHtml(s.label)}')">
        <span>${escapeHtml(s.label)}</span>
        ${curStatus === s.val ? '<span class="opt-check">✓</span>' : ''}
      </div>
    `).join('');
    if (lblStatus) {
      const curMatch = statusList.find(s => s.val === curStatus);
      lblStatus.textContent = curMatch ? curMatch.label : 'Tous les statuts';
    }
  }

  // 5. Statut Approbation Custom Menu & Hidden Select
  const approvalList = [
    { val: 'ALL', label: 'Tous statuts' },
    { val: 'Approved', label: 'Approuvé' },
    { val: 'Exception', label: 'Exception / Litige' },
    { val: 'On Hold', label: 'En Retenue' }
  ];
  const menuApproval = document.getElementById('csMenuApproval');
  const lblApproval = document.getElementById('csLabelApproval');
  if (menuApproval) {
    const curAppr = state.filters.approval;
    menuApproval.innerHTML = approvalList.map(a => `
      <div class="custom-select-option ${curAppr === a.val ? 'is-selected' : ''}" onclick="selectCustomOption('approval', '${a.val}', '${escapeHtml(a.label)}')">
        <span>${escapeHtml(a.label)}</span>
        ${curAppr === a.val ? '<span class="opt-check">✓</span>' : ''}
      </div>
    `).join('');
    if (lblApproval) {
      const curMatch = approvalList.find(a => a.val === curAppr);
      lblApproval.textContent = curMatch ? curMatch.label : 'Tous statuts';
    }
  }
}

function updateActiveFilterIndicator() {
  const strip = document.getElementById('activeFilterStrip');
  const tagsContainer = document.getElementById('activeFilterTags');
  const impactContainer = document.getElementById('activeFilterImpact');
  if (!strip || !tagsContainer || !impactContainer) return;

  const activeFilters = [];
  if (state.filters.dept !== 'ALL') activeFilters.push(`🏢 Département : ${state.filters.dept}`);
  if (state.filters.costCenter !== 'ALL') activeFilters.push(`🏷️ Centre : ${state.filters.costCenter}`);
  if (state.filters.requester !== 'ALL') activeFilters.push(`👤 Demandeur : ${state.filters.requester}`);
  if (state.filters.status !== 'ALL') activeFilters.push(`💳 Statut : ${translateStatus(state.filters.status)}`);
  if (state.filters.approval !== 'ALL') activeFilters.push(`📋 Approbation : ${translateStatus(state.filters.approval)}`);
  if (state.filters.vendor !== 'ALL') activeFilters.push(`🤝 Fournisseur : ${state.filters.vendor}`);

  if (activeFilters.length === 0) {
    strip.style.display = 'none';
    return;
  }

  strip.style.display = 'flex';
  tagsContainer.innerHTML = activeFilters.map(t => `<span class="active-filter-tag">${escapeHtml(t)}</span>`).join('');

  const totalTtc = state.filteredInvoices.reduce((s, i) => s + (i.valTtc || 0), 0);
  const totalPaid = state.filteredInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0);
  const totalOutstanding = state.filteredInvoices.reduce((s, i) => s + (i.outstanding || 0), 0);

  impactContainer.innerHTML = `
    <span><strong>${state.filteredInvoices.length}</strong> factures filtrées • Facturé : <strong>${formatCurrency(totalTtc)}</strong> • Réglé : <strong style="color: var(--accent-emerald);">${formatCurrency(totalPaid)}</strong> • Solde Dû : <strong style="color: var(--accent-coral);">${formatCurrency(totalOutstanding)}</strong></span>
  `;
}

function toggleRowExpand(sn) {
  const row = document.getElementById(`rowExpand-${sn}`);
  const btn = document.getElementById(`btnExpand-${sn}`);
  if (!row) return;

  const isVisible = row.style.display !== 'none';
  if (isVisible) {
    row.style.display = 'none';
    if (btn) btn.innerHTML = '▼ 54 Col.';
  } else {
    row.style.display = 'table-row';
    if (btn) btn.innerHTML = '▲ Réduire';
  }
}

function filterBySpecificDept(deptName) {
  if (state.filters.dept === deptName) {
    state.filters.dept = 'ALL';
  } else {
    state.filters.dept = deptName;
  }
  const selGlobal = document.getElementById('globalFilterDept');
  if (selGlobal) selGlobal.value = state.filters.dept;
  const selLedger = document.getElementById('filterDept');
  if (selLedger) selLedger.value = state.filters.dept;
  updateGlobalFilterDropdowns();
  applyFilters();
}

// ==========================================================================
// VUE SYNTHÉTIQUE : TABLEAU DES DÉPENSES PAR DÉPARTEMENT & CENTRE DE COÛT
// ==========================================================================

function renderOverviewDeptTable() {
  const tbody = document.getElementById('overviewDeptsTbody');
  if (!tbody) return;

  const deptMap = {};
  state.invoices.forEach(inv => {
    const d = inv.department || 'Non spécifié';
    if (!deptMap[d]) {
      deptMap[d] = {
        name: d,
        costCenters: new Set(),
        invoicesCount: 0,
        poValue: 0,
        poNumbers: new Set(),
        totalTtc: 0,
        paid: 0,
        outstanding: 0
      };
    }
    if (inv.costCenter) deptMap[d].costCenters.add(inv.costCenter);
    if (inv.poNumber && !deptMap[d].poNumbers.has(inv.poNumber)) {
      deptMap[d].poNumbers.add(inv.poNumber);
      deptMap[d].poValue += (inv.poValue || 0);
    }
    deptMap[d].invoicesCount++;
    deptMap[d].totalTtc += (inv.valTtc || 0);
    deptMap[d].paid += (inv.paidAmount || 0);
    deptMap[d].outstanding += (inv.outstanding || 0);
  });

  const grandTotalTtc = Object.values(deptMap).reduce((s, d) => s + d.totalTtc, 0);
  const sorted = Object.values(deptMap).sort((a, b) => b.totalTtc - a.totalTtc);

  tbody.innerHTML = sorted.map(d => {
    const pctShare = grandTotalTtc > 0 ? (d.totalTtc / grandTotalTtc) * 100 : 0;
    const isFiltered = state.filters.dept === d.name;
    const activeClass = isFiltered ? 'style="background: rgba(2, 132, 199, 0.1); border-left: 3px solid var(--accent-cyan);"' : '';

    return `
      <tr ${activeClass}>
        <td style="font-weight: 700; color: var(--text-primary);">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${escapeHtml(d.name)}</span>
            ${isFiltered ? '<span class="badge-status paid" style="font-size: 0.68rem; padding: 0.15rem 0.4rem;">Actif</span>' : ''}
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            ${Array.from(d.costCenters).slice(0, 3).map(cc => `<span class="mono-val" style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(cc)}</span>`).join(', ')}
            ${d.costCenters.size > 3 ? `<span class="mono-val" style="font-size: 0.75rem; color: var(--text-tertiary);">+${d.costCenters.size - 3}</span>` : ''}
          </div>
        </td>
        <td style="text-align: center;" class="mono-val">${d.invoicesCount}</td>
        <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(d.poValue)}</td>
        <td style="text-align: right; font-weight: 800; color: var(--accent-cyan);" class="mono-val">${formatCurrency(d.totalTtc)}</td>
        <td style="text-align: right; color: var(--accent-emerald); font-weight: 700;" class="mono-val">${formatCurrency(d.paid)}</td>
        <td style="text-align: right; color: ${d.outstanding > 0 ? 'var(--accent-coral)' : 'var(--text-tertiary)'}; font-weight: 700;" class="mono-val">${formatCurrency(d.outstanding)}</td>
        <td style="text-align: center;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span class="mono-val" style="font-weight: 700; font-size: 0.76rem;">${pctShare.toFixed(1)}%</span>
            <div class="progress-bar-wrap mini" style="width: 45px;">
              <div class="progress-bar-fill safe" style="width: ${Math.min(pctShare, 100)}%;"></div>
            </div>
          </div>
        </td>
        <td style="text-align: center;">
          <button class="btn-table-action" onclick="filterBySpecificDept('${escapeHtml(d.name)}')" title="Filtrer tout le tableau de bord pour ce département">
            ${isFiltered ? '✕ Désactiver' : 'Filtrer ce Pôle →'}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// ONGLET 6 : MATRICE INTÉGRALE GOOGLE SHEETS (LES 54 COLONNES)
// ==========================================================================

function renderFullSheetsTable() {
  const tbody = document.getElementById('fullSheetsMasterTbody');
  if (!tbody) return;

  const records = state.filteredInvoices;
  let filtered = records;

  // Filtrage contextuel instantané activé par clic sur une carte KPI
  const preset = state.sheetsTable.activePresetFilter;
  if (preset) {
    if (preset === 'po') {
      filtered = filtered.filter(inv => inv.poNumber && inv.poNumber !== 'PO-NON-DEFINI');
    } else if (preset === 'invoiced') {
      filtered = filtered.filter(inv => inv.receiptDate || inv.valTtc > 0);
    } else if (preset === 'paid') {
      filtered = filtered.filter(inv => inv.paymentStatus === 'Paid' || inv.paidAmount > 0);
    } else if (preset === 'pending') {
      filtered = filtered.filter(inv => inv.outstanding > 0 || inv.paymentStatus !== 'Paid');
    } else if (preset === 'sla') {
      filtered = filtered.filter(inv => inv.cycleDays > 0);
    } else if (preset === 'audit') {
      filtered = filtered.filter(inv => inv.overInvoiced || (inv.exceptionReason && inv.exceptionReason.trim() !== '-' && inv.exceptionReason.trim().length > 0) || inv.invoiceStatus === 'Exception' || inv.invoiceStatus === 'On Hold');
    }
  }

  const q = (state.sheetsTable.search || '').trim().toLowerCase();

  if (q) {
    filtered = filtered.filter(inv => {
      return (
        String(inv.sn).toLowerCase().includes(q) ||
        (inv.companyCode || '').toLowerCase().includes(q) ||
        (inv.vendorName || '').toLowerCase().includes(q) ||
        (inv.vendorCode || '').toLowerCase().includes(q) ||
        (inv.invoiceNo || '').toLowerCase().includes(q) ||
        (inv.invoiceType || '').toLowerCase().includes(q) ||
        (inv.pcType || '').toLowerCase().includes(q) ||
        (inv.poNumber || '').toLowerCase().includes(q) ||
        (inv.department || '').toLowerCase().includes(q) ||
        (inv.costCenter || '').toLowerCase().includes(q) ||
        (inv.requester || '').toLowerCase().includes(q) ||
        (inv.workDesc || '').toLowerCase().includes(q) ||
        (inv.paymentType || '').toLowerCase().includes(q) ||
        (inv.sesGrnNo || '').toLowerCase().includes(q) ||
        (inv.payRef || '').toLowerCase().includes(q) ||
        (inv.paymentStatus || '').toLowerCase().includes(q) ||
        (inv.invoiceStatus || '').toLowerCase().includes(q) ||
        (inv.exceptionReason || '').toLowerCase().includes(q) ||
        (inv.remarks || '').toLowerCase().includes(q)
      );
    });
  }

  // Sort
  const sortCol = state.sheetsTable.sortCol;
  const sortDir = state.sheetsTable.sortDir;
  filtered.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalFiltered = filtered.length;
  const { currentPage, pageSize } = state.sheetsTable;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  state.sheetsTable.currentPage = safePage;

  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalFiltered);
  const paged = filtered.slice(startIdx, endIdx);

  // Update controls
  const badgeEl = document.getElementById('sheetsRowCountBadge');
  const startEl = document.getElementById('sheetsShowingStart');
  const endEl = document.getElementById('sheetsShowingEnd');
  const totalEl = document.getElementById('sheetsTotalCount');
  const labelEl = document.getElementById('sheetsPageCurrentLabel');
  const btnPrev = document.getElementById('btnSheetsPrev');
  const btnNext = document.getElementById('btnSheetsNext');
  const bannerCount = document.getElementById('sheetsFilterBannerCount');

  if (badgeEl) badgeEl.textContent = `${totalFiltered} Lignes • 54 Colonnes`;
  if (bannerCount) bannerCount.textContent = `(${totalFiltered} factures)`;
  if (startEl) startEl.textContent = totalFiltered === 0 ? 0 : startIdx + 1;
  if (endEl) endEl.textContent = endIdx;
  if (totalEl) totalEl.textContent = totalFiltered;
  if (labelEl) labelEl.textContent = `${safePage} / ${totalPages}`;
  if (btnPrev) btnPrev.disabled = safePage <= 1;
  if (btnNext) btnNext.disabled = safePage >= totalPages;

  if (paged.length === 0) {
    tbody.innerHTML = `<tr><td colspan="54" style="text-align: center; padding: 3rem; color: var(--text-tertiary);">Aucune ligne ne correspond aux filtres.</td></tr>`;
    return;
  }

  tbody.innerHTML = paged.map(r => `
    <tr onclick="openInvoiceDrawer('${r.invoiceNo}')">
      <td class="col-sticky col-sticky-sn mono-val" style="color: var(--text-tertiary);">${r.sn}</td>
      <td class="col-sticky col-sticky-inv" style="font-weight: 700; color: var(--accent-cyan); font-family: var(--font-mono);">${r.invoiceNo}</td>
      <td class="col-sticky col-sticky-vendor" style="font-weight: 600;">${escapeHtml(r.vendorName)}</td>
      <td>${escapeHtml(r.companyCode || 'BIS')}</td>
      <td class="mono-val">${formatDateFr(r.receiptDate)}</td>
      <td class="mono-val" style="color: var(--text-secondary);">${r.vendorCode}</td>
      <td><span class="badge-cycle">${escapeHtml(r.invoiceType || 'Standard')}</span></td>
      <td>${escapeHtml(r.pcType || 'Standard')}</td>
      <td class="mono-val" style="color: var(--accent-cyan); font-weight: 700;">${r.poNumber}</td>
      <td class="mono-val">${formatDateFr(r.poCreationDate)}</td>
      <td class="mono-val">${formatDateFr(r.poApprovalDate)}</td>
      <td><span class="badge-status ${r.poStatus === 'Closed' ? 'paid' : 'partially-paid'}">${translateStatus(r.poStatus)}</span></td>
      <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(r.poValue)}</td>
      <td class="mono-val">${r.currency || 'XOF'}</td>
      <td class="mono-val">${formatDateFr(r.invoiceDate)}</td>
      <td style="text-align: right;" class="mono-val">${formatCurrency(r.valHt)}</td>
      <td style="text-align: right;" class="mono-val">${formatCurrency(r.valVat)}</td>
      <td style="text-align: right; font-weight: 800;" class="mono-val">${formatCurrency(r.valTtc)}</td>
      <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.workDesc)}">${escapeHtml(r.workDesc || '-')}</td>
      <td><span style="font-weight: 500; color: var(--text-secondary);">${escapeHtml(r.department || '-')}</span></td>
      <td><span class="mono-val" style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(r.costCenter || '-')}</span></td>
      <td class="mono-val" style="font-size: 0.75rem;">${escapeHtml(r.requester)}</td>
      <td>${escapeHtml(r.paymentType)}</td>
      <td class="mono-val">${escapeHtml(r.paymentTerms)}</td>
      <td class="mono-val">${formatDateFr(r.dueDate)}</td>
      <td class="mono-val">${escapeHtml(r.sesGrnNo || '-')}</td>
      <td><span class="badge-status paid">${escapeHtml(r.sesGrnStatus || 'Validé')}</span></td>
      <td class="mono-val">${formatDateFr(r.pcSentDate)}</td>
      <td class="mono-val">${formatDateFr(r.grnReceivedDate)}</td>
      <td class="mono-val">${formatDateFr(r.submitFinanceDate)}</td>
      <td class="mono-val">${formatDateFr(r.approvalDate)}</td>
      <td class="mono-val">${formatDateFr(r.paymentDate)}</td>
      <td class="mono-val" style="font-size: 0.75rem;">${escapeHtml(r.payRef || '-')}</td>
      <td><span class="badge-status ${getStatusClass(r.paymentStatus)}">${translateStatus(r.paymentStatus)}</span></td>
      <td style="text-align: right; color: var(--accent-emerald); font-weight: 700;" class="mono-val">${formatCurrency(r.paidAmount)}</td>
      <td style="text-align: right; color: ${r.outstanding > 0 ? 'var(--accent-coral)' : 'var(--text-tertiary)'}; font-weight: 700;" class="mono-val">${formatCurrency(r.outstanding)}</td>
      <td style="text-align: right;" class="mono-val">${formatCurrency(r.previousInvoiced)}</td>
      <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(r.cumulativeInvoiced)}</td>
      <td style="text-align: right; font-weight: 700; color: ${r.remainingPo < 0 ? 'var(--accent-coral)' : 'var(--accent-emerald)'};" class="mono-val">${formatCurrency(r.remainingPo)}</td>
      <td style="text-align: center;" class="mono-val font-weight: 700;">${r.poUtilization || '-'}</td>
      <td style="text-align: right; color: ${r.poVariance > 0 ? 'var(--accent-coral)' : 'inherit'};" class="mono-val">${formatCurrency(r.poVariance)}</td>
      <td style="text-align: center;">${r.overInvoiced ? '<span class="pill-alert">OUI</span>' : 'NON'}</td>
      <td style="text-align: right;" class="mono-val">${formatCurrency(r.previousPaid)}</td>
      <td style="text-align: right;" class="mono-val">${formatCurrency(r.cumulativePaid)}</td>
      <td style="text-align: right;" class="mono-val">${formatCurrency(r.poUnpaidBalance)}</td>
      <td style="text-align: center;">${escapeHtml(r.finalInvoiceFlag || 'No')}</td>
      <td style="color: var(--accent-amber);">${escapeHtml(r.exceptionReason || '-')}</td>
      <td><span class="badge-status ${getApprovalClass(r.invoiceStatus)}">${translateStatus(r.invoiceStatus)}</span></td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.remarks)}">${escapeHtml(r.remarks || '-')}</td>
      <td style="text-align: center;" class="mono-val">${r.step1Days !== null ? r.step1Days + ' j' : '-'}</td>
      <td style="text-align: center;" class="mono-val">${r.step2Days !== null ? r.step2Days + ' j' : '-'}</td>
      <td style="text-align: center;" class="mono-val">${r.step3Days !== null ? r.step3Days + ' j' : '-'}</td>
      <td style="text-align: center;" class="mono-val">${r.step4Days !== null ? r.step4Days + ' j' : '-'}</td>
      <td style="text-align: center; font-weight: 800; color: var(--accent-cyan);" class="mono-val">${r.cycleDays ? r.cycleDays + ' j' : '-'}</td>
    </tr>
  `).join('');
}

function handleSheetsSearch(val) {
  state.sheetsTable.search = val.trim();
  state.sheetsTable.currentPage = 1;
  renderFullSheetsTable();
}

function sortSheetsTable(col) {
  if (state.sheetsTable.sortCol === col) {
    state.sheetsTable.sortDir = state.sheetsTable.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sheetsTable.sortCol = col;
    state.sheetsTable.sortDir = (col === 'sn' || col === 'invoiceNo' || col === 'vendorName') ? 'asc' : 'desc';
  }
  renderFullSheetsTable();
}

function changeSheetsPage(delta) {
  state.sheetsTable.currentPage += delta;
  renderFullSheetsTable();
}

function changeSheetsPageSize(size) {
  if (size === 'ALL') {
    state.sheetsTable.pageSize = 9999999;
  } else {
    state.sheetsTable.pageSize = parseInt(size) || 25;
  }
  state.sheetsTable.currentPage = 1;
  renderFullSheetsTable();
}

/**
 * Filtre instantanément la Matrice Intégrale (54 colonnes) suite au clic sur une Carte KPI
 */
function filterSheetsByCard(type) {
  state.sheetsTable.activePresetFilter = type;
  state.sheetsTable.currentPage = 1;

  if (type === 'sla') {
    state.sheetsTable.sortCol = 'cycleDays';
    state.sheetsTable.sortDir = 'desc';
  } else if (type === 'po') {
    state.sheetsTable.sortCol = 'poNumber';
    state.sheetsTable.sortDir = 'asc';
  } else {
    state.sheetsTable.sortCol = 'sn';
    state.sheetsTable.sortDir = 'asc';
  }

  // Basculer sur l'onglet Matrice Intégrale
  switchTab('sheets');
  updateSheetsFilterBanner();
  renderFullSheetsTable();

  const labels = {
    po: 'Matrice Intégrale : Bons de commande engagés',
    invoiced: 'Matrice Intégrale : Factures reçues',
    paid: 'Matrice Intégrale : Règlements effectués (factures soldées)',
    pending: 'Matrice Intégrale : Restes à payer & en attente',
    sla: 'Matrice Intégrale : Suivi des délais et cycles SLA',
    audit: 'Matrice Intégrale : Alertes d’audit, surfacturations & blocages'
  };
  showToast(labels[type] || 'Matrice Intégrale filtrée', 'info');

  const banner = document.getElementById('sheetsActiveFilterBanner');
  if (banner) {
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Réinitialise le filtre de carte KPI sur la Matrice Intégrale
 */
function resetSheetsFilterPreset() {
  state.sheetsTable.activePresetFilter = null;
  state.sheetsTable.currentPage = 1;
  updateSheetsFilterBanner();
  renderFullSheetsTable();
  showToast('Affichage complet des 88 factures restauré', 'info');
}

/**
 * Met à jour le bandeau indicateur de filtre actif dans la Matrice Intégrale
 */
function updateSheetsFilterBanner() {
  const banner = document.getElementById('sheetsActiveFilterBanner');
  const bannerText = document.getElementById('sheetsFilterBannerText');
  if (!banner) return;

  const preset = state.sheetsTable.activePresetFilter;
  if (!preset) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  const configs = {
    po: { label: 'Bons de Commande Engagés', dotColor: 'var(--accent-cyan)' },
    invoiced: { label: 'Factures Reçues & Enregistrées', dotColor: 'var(--accent-blue)' },
    paid: { label: 'Factures Soldées & Réglées', dotColor: 'var(--accent-emerald)' },
    pending: { label: 'Encours & Restes à Payer', dotColor: 'var(--accent-amber)' },
    sla: { label: 'Suivi des Cycles & Délais SLA', dotColor: 'var(--accent-indigo)' },
    audit: { label: 'Alertes d\'Audit & Surfacturations', dotColor: 'var(--accent-coral)' }
  };

  const cfg = configs[preset] || { label: 'Vue filtrée', dotColor: 'var(--accent-blue)' };
  if (bannerText) bannerText.textContent = `Filtre actif : ${cfg.label}`;
  
  const dot = banner.querySelector('.filter-banner-dot');
  if (dot) dot.style.background = cfg.dotColor;
}

function exportFull54ColumnsCsv() {
  let records = state.filteredInvoices;
  const preset = state.sheetsTable.activePresetFilter;
  if (preset) {
    if (preset === 'po') {
      records = records.filter(inv => inv.poNumber && inv.poNumber !== 'PO-NON-DEFINI');
    } else if (preset === 'invoiced') {
      records = records.filter(inv => inv.receiptDate || inv.valTtc > 0);
    } else if (preset === 'paid') {
      records = records.filter(inv => inv.paymentStatus === 'Paid' || inv.paidAmount > 0);
    } else if (preset === 'pending') {
      records = records.filter(inv => inv.outstanding > 0 || inv.paymentStatus !== 'Paid');
    } else if (preset === 'sla') {
      records = records.filter(inv => inv.cycleDays > 0);
    } else if (preset === 'audit') {
      records = records.filter(inv => inv.overInvoiced || (inv.exceptionReason && inv.exceptionReason.trim() !== '-' && inv.exceptionReason.trim().length > 0) || inv.invoiceStatus === 'Exception' || inv.invoiceStatus === 'On Hold');
    }
  }

  if (!records || records.length === 0) {
    showToast('Aucune donnée à exporter', 'warning');
    return;
  }

  const headers = [
    'SN', 'Company Code', 'Invoice Receipt Date', 'Vendor Code', 'Vendor Name',
    'Invoice No.', 'Invoice Type', 'PC Type', 'PO Number', 'PO Creation Date',
    'PO Approval Date', 'PO Status', 'PO Value', 'Currency', 'Invoice Date',
    'Invoice Value HT', 'VAT Amount', 'Invoice Value TTC', 'Work Description',
    'Department', 'Cost Center', 'Requester', 'Type of Payment', 'Payment Terms',
    'Due Date', 'SES/GRN No.', 'SES/GRN Status', 'PC Sent Date', 'GRN/SES Received Date',
    'Submit to Finance Date', 'Invoice Approval Date', 'Payment Date', 'Payment Reference',
    'Payment Status', 'Invoice Paid Amount', 'Invoice Outstanding', 'Previous Invoiced Value',
    'Cumulative Invoiced Value', 'Remaining PO Balance', 'PO Utilization %', 'PO Variance',
    'Over-Invoiced Flag', 'Previous Paid Amount', 'Cumulative Paid Amount', 'PO Unpaid Balance',
    'Final Invoice Flag', 'Exception / Hold Reason', 'Invoice Status', 'Remarks',
    'Invoice Receipt → PC Request Days', 'PC Sent → GRN/SES Days', 'GRN/SES → Finance Days',
    'Finance → Payment Days', 'Invoice Receipt → Payment Days'
  ];

  const rows = records.map(r => [
    r.sn,
    `"${(r.companyCode || '').replace(/"/g, '""')}"`,
    formatDateFr(r.receiptDate),
    `"${(r.vendorCode || '').replace(/"/g, '""')}"`,
    `"${(r.vendorName || '').replace(/"/g, '""')}"`,
    `"${(r.invoiceNo || '').replace(/"/g, '""')}"`,
    `"${(r.invoiceType || '').replace(/"/g, '""')}"`,
    `"${(r.pcType || '').replace(/"/g, '""')}"`,
    `"${(r.poNumber || '').replace(/"/g, '""')}"`,
    formatDateFr(r.poCreationDate),
    formatDateFr(r.poApprovalDate),
    `"${(r.poStatus || '').replace(/"/g, '""')}"`,
    r.poValue || 0,
    r.currency || 'XOF',
    formatDateFr(r.invoiceDate),
    r.valHt || 0,
    r.valVat || 0,
    r.valTtc || 0,
    `"${(r.workDesc || '').replace(/"/g, '""')}"`,
    `"${(r.department || '').replace(/"/g, '""')}"`,
    `"${(r.costCenter || '').replace(/"/g, '""')}"`,
    `"${(r.requester || '').replace(/"/g, '""')}"`,
    `"${(r.paymentType || '').replace(/"/g, '""')}"`,
    `"${(r.paymentTerms || '').replace(/"/g, '""')}"`,
    formatDateFr(r.dueDate),
    `"${(r.sesGrnNo || '').replace(/"/g, '""')}"`,
    `"${(r.sesGrnStatus || '').replace(/"/g, '""')}"`,
    formatDateFr(r.pcSentDate),
    formatDateFr(r.grnReceivedDate),
    formatDateFr(r.submitFinanceDate),
    formatDateFr(r.approvalDate),
    formatDateFr(r.paymentDate),
    `"${(r.payRef || '').replace(/"/g, '""')}"`,
    `"${(r.paymentStatus || '').replace(/"/g, '""')}"`,
    r.paidAmount || 0,
    r.outstanding || 0,
    r.previousInvoiced || 0,
    r.cumulativeInvoiced || 0,
    r.remainingPo || 0,
    `"${(r.poUtilization || '').replace(/"/g, '""')}"`,
    r.poVariance || 0,
    r.overInvoiced ? 'Yes' : 'No',
    r.previousPaid || 0,
    r.cumulativePaid || 0,
    r.poUnpaidBalance || 0,
    `"${(r.finalInvoiceFlag || '').replace(/"/g, '""')}"`,
    `"${(r.exceptionReason || '').replace(/"/g, '""')}"`,
    `"${(r.invoiceStatus || '').replace(/"/g, '""')}"`,
    `"${(r.remarks || '').replace(/"/g, '""')}"`,
    r.step1Days !== null ? r.step1Days : '',
    r.step2Days !== null ? r.step2Days : '',
    r.step3Days !== null ? r.step3Days : '',
    r.step4Days !== null ? r.step4Days : '',
    r.cycleDays || ''
  ]);

  const csvContent = '\uFEFF' + [headers.join(';')].concat(rows.map(row => row.join(';'))).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AIFORCE_GoogleSheets_54_Colonnes_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Intégralité des 54 colonnes exportée en format CSV Excel', 'success');
}

function populateVendorFilter() {
  const sel = document.getElementById('filterVendor');
  if (!sel) return;
  const currentVal = sel.value;
  const vendors = Array.from(new Set(state.invoices.map(i => i.vendorName))).sort();

  sel.innerHTML = '<option value="ALL">Tous les fournisseurs (' + vendors.length + ')</option>' +
    vendors.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

  if (vendors.includes(currentVal)) sel.value = currentVal;
}

function populateDeptFilter() {
  const sel = document.getElementById('filterDept');
  if (!sel) return;
  const currentVal = sel.value;
  const depts = Array.from(new Set(state.invoices.map(i => i.department).filter(Boolean))).sort();

  sel.innerHTML = '<option value="ALL">Tous départements (' + depts.length + ')</option>' +
    depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');

  if (depts.includes(currentVal)) sel.value = currentVal;
}

function populateCostCenterFilter() {
  const sel = document.getElementById('filterCostCenter');
  if (!sel) return;
  const currentVal = sel.value;
  const ccs = Array.from(new Set(state.invoices.map(i => i.costCenter).filter(Boolean))).sort();

  sel.innerHTML = '<option value="ALL">Tous centres de coût (' + ccs.length + ')</option>' +
    ccs.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  if (ccs.includes(currentVal)) sel.value = currentVal;
}

function populateRequesterFilter() {
  const sel = document.getElementById('filterRequester');
  if (!sel) return;
  const currentVal = sel.value;
  const reqs = Array.from(new Set(state.invoices.map(i => i.requester).filter(Boolean))).sort();

  sel.innerHTML = '<option value="ALL">Tous demandeurs (' + reqs.length + ')</option>' +
    reqs.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

  if (reqs.includes(currentVal)) sel.value = currentVal;
}

// ==========================================================================
// TRI DU TABLEAU (MULTI-COLUMN SORTING)
// ==========================================================================

function sortLedger(column) {
  if (state.sort.column === column) {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort.column = column;
    state.sort.direction = 'asc';
  }

  // Update header classes
  const ths = document.querySelectorAll('#masterLedgerTable th');
  ths.forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
  });

  sortInvoicesArray(state.filteredInvoices, state.sort.column, state.sort.direction);
  renderMasterLedgerTable();
}

function sortInvoicesArray(arr, col, dir) {
  arr.sort((a, b) => {
    let vA = a[col];
    let vB = b[col];

    if (col === 'date') {
      vA = a.invoiceDate ? a.invoiceDate.getTime() : 0;
      vB = b.invoiceDate ? b.invoiceDate.getTime() : 0;
    } else if (col === 'valTtc') {
      vA = a.valTtc; vB = b.valTtc;
    } else if (col === 'paid') {
      vA = a.paidAmount; vB = b.paidAmount;
    } else if (col === 'outstanding') {
      vA = a.outstanding; vB = b.outstanding;
    } else if (col === 'cycleDays') {
      vA = a.cycleDays; vB = b.cycleDays;
    } else if (col === 'vendor') {
      vA = (a.vendorName || '').toLowerCase();
      vB = (b.vendorName || '').toLowerCase();
    } else if (col === 'dept') {
      vA = (a.department || '').toLowerCase();
      vB = (b.department || '').toLowerCase();
    } else if (col === 'costCenter') {
      vA = (a.costCenter || '').toLowerCase();
      vB = (b.costCenter || '').toLowerCase();
    } else if (col === 'requester') {
      vA = (a.requester || '').toLowerCase();
      vB = (b.requester || '').toLowerCase();
    } else if (typeof vA === 'string') {
      vA = vA.toLowerCase();
      vB = vB.toLowerCase();
    }

    if (vA < vB) return dir === 'asc' ? -1 : 1;
    if (vA > vB) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function changePage(delta) {
  state.pagination.currentPage += delta;
  renderMasterLedgerTable();
}

function changePageSize(newSize) {
  if (newSize === 'ALL') {
    state.pagination.pageSize = 9999999;
  } else {
    state.pagination.pageSize = parseInt(newSize) || 25;
  }
  state.pagination.currentPage = 1;
  renderMasterLedgerTable();
}

// ==========================================================================
// RENDU DES AUTRES ONGLETS (PO, FOURNISSEURS, AUDIT)
// ==========================================================================

function renderAllViews() {
  renderTopVendorsTable();
  renderPoCards();
  renderVendorCards();
  renderDepartmentViews();
  renderAuditViews();
}

/**
 * Top 5 Fournisseurs dans la Vue Synthétique
 */
function renderTopVendorsTable() {
  const tbody = document.getElementById('topVendorsTbody');
  if (!tbody) return;

  const vendorMap = {};
  state.filteredInvoices.forEach(inv => {
    if (!vendorMap[inv.vendorName]) {
      vendorMap[inv.vendorName] = { name: inv.vendorName, count: 0, ttc: 0, outstanding: 0 };
    }
    vendorMap[inv.vendorName].count++;
    vendorMap[inv.vendorName].ttc += inv.valTtc;
    vendorMap[inv.vendorName].outstanding += inv.outstanding;
  });

  const sorted = Object.values(vendorMap).sort((a, b) => b.ttc - a.ttc).slice(0, 5);

  tbody.innerHTML = sorted.map(v => `
    <tr>
      <td style="font-weight: 600;">${escapeHtml(v.name)}</td>
      <td class="mono-val" style="color: var(--text-secondary);">${v.count}</td>
      <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(v.ttc)}</td>
      <td style="text-align: right; color: ${v.outstanding > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)'};" class="mono-val">${formatCurrency(v.outstanding)}</td>
    </tr>
  `).join('');
}

/**
 * Onglet 3 : Portefeuille des Bons de Commande (Vue Lignes / Tableau Exécutif)
 */
function getPoDataset() {
  const poMap = {};
  state.invoices.forEach(inv => {
    if (!poMap[inv.poNumber]) {
      poMap[inv.poNumber] = {
        poNumber: inv.poNumber,
        poValue: inv.poValue || 0,
        vendorName: inv.vendorName,
        department: inv.department || '',
        costCenter: inv.costCenter || '',
        status: inv.poStatus || 'Partially Invoiced',
        invoicedTtc: 0,
        paid: 0,
        invoicesCount: 0,
        overInvoiced: false
      };
    }
    // Prendre la valeur la plus récente du BC si amendement
    if (inv.poValue > poMap[inv.poNumber].poValue) {
      poMap[inv.poNumber].poValue = inv.poValue;
    }
    if (!poMap[inv.poNumber].department && inv.department) {
      poMap[inv.poNumber].department = inv.department;
    }
    if (!poMap[inv.poNumber].costCenter && inv.costCenter) {
      poMap[inv.poNumber].costCenter = inv.costCenter;
    }
    poMap[inv.poNumber].invoicedTtc += (inv.valTtc || 0);
    poMap[inv.poNumber].paid += (inv.paidAmount || 0);
    poMap[inv.poNumber].invoicesCount++;
    if (inv.overInvoiced || poMap[inv.poNumber].invoicedTtc > poMap[inv.poNumber].poValue) {
      poMap[inv.poNumber].overInvoiced = true;
    }
  });

  return Object.values(poMap).map(p => {
    const rate = p.poValue > 0 ? (p.invoicedTtc / p.poValue) * 100 : 0;
    const remaining = p.poValue - p.invoicedTtc;
    let computedStatus = p.overInvoiced || remaining < 0 ? 'Dépassement' : (p.status || 'Partially Invoiced');
    return {
      ...p,
      rate,
      remaining,
      computedStatus
    };
  });
}

function renderPoCards() {
  const allPos = getPoDataset();
  
  // 1. Mise à jour des cartes KPI Résumé BC
  const totalEngaged = allPos.reduce((sum, p) => sum + p.poValue, 0);
  const totalInvoiced = allPos.reduce((sum, p) => sum + p.invoicedTtc, 0);
  const avgRate = totalEngaged > 0 ? (totalInvoiced / totalEngaged) * 100 : 0;
  const overCount = allPos.filter(p => p.remaining < 0 || p.overInvoiced).length;

  const elEngaged = document.getElementById('poKpiTotalEngaged');
  const elInvoiced = document.getElementById('poKpiTotalInvoiced');
  const elAvgRate = document.getElementById('poKpiAvgRate');
  const elOverCount = document.getElementById('poKpiOverCount');
  const elTitle = document.getElementById('posTitleWithCount');

  if (elEngaged) elEngaged.textContent = formatCurrency(totalEngaged);
  if (elInvoiced) elInvoiced.textContent = formatCurrency(totalInvoiced);
  if (elAvgRate) elAvgRate.textContent = `${avgRate.toFixed(1)}%`;
  if (elOverCount) elOverCount.textContent = `${overCount} BCs`;
  if (elTitle) elTitle.textContent = `Portefeuille des Bons de Commande & Engagements (${allPos.length} BCs)`;

  const navPosBadge = document.getElementById('navPosBadge');
  if (navPosBadge) navPosBadge.textContent = allPos.length;

  // 2. Filtrage
  let filtered = allPos.filter(p => {
    if (state.posTable.search) {
      const q = state.posTable.search.toLowerCase();
      const matchPo = (p.poNumber || '').toLowerCase().includes(q);
      const matchVendor = (p.vendorName || '').toLowerCase().includes(q);
      const matchDept = (p.department || '').toLowerCase().includes(q);
      const matchCC = (p.costCenter || '').toLowerCase().includes(q);
      if (!matchPo && !matchVendor && !matchDept && !matchCC) return false;
    }
    if (state.posTable.status !== 'ALL') {
      if (state.posTable.status === 'Dépassement') {
        if (!p.overInvoiced && p.remaining >= 0) return false;
      } else if (state.posTable.status === 'Closed') {
        if (p.computedStatus !== 'Closed') return false;
      } else if (state.posTable.status === 'Partially Invoiced') {
        if (p.computedStatus !== 'Partially Invoiced') return false;
      }
    }
    return true;
  });

  // 3. Tri
  const sortCol = state.posTable.sortColumn;
  const sortDir = state.posTable.sortDir;
  filtered.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // 4. Badge du nombre affiché
  const elBadge = document.getElementById('poFilteredCountBadge');
  if (elBadge) elBadge.textContent = `${filtered.length} BCs affichés`;

  // 5. Rendu du Tableau
  const tbody = document.getElementById('posTableTbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 2.5rem; color: var(--text-tertiary);">
          Aucun Bon de Commande ne correspond à vos critères de recherche.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const isOver = p.remaining < 0 || p.overInvoiced;
    const progressClass = isOver || p.rate > 100 ? 'danger' : (p.rate >= 80 ? 'warning' : 'safe');
    const badgeClass = isOver ? 'exception' : (p.computedStatus === 'Closed' ? 'paid' : 'partially-paid');
    const badgeLabel = isOver ? 'Dépassement' : (p.computedStatus === 'Closed' ? 'Soldé' : 'En cours');

    return `
      <tr>
        <td>
          <span class="po-link-code" onclick="filterLedgerByPo('${p.poNumber}')" title="Cliquer pour inspecter dans le Grand Livre">${p.poNumber}</span>
        </td>
        <td>
          <span class="vendor-link-name" onclick="filterLedgerByVendor('${escapeHtml(p.vendorName)}')">${escapeHtml(p.vendorName)}</span>
        </td>
        <td>
          <span style="font-weight: 500; color: var(--text-secondary); cursor: pointer;" onclick="filterLedgerByDept('${escapeHtml(p.department)}')" title="Filtrer le Grand Livre par ce département">${escapeHtml(p.department || 'Non spécifié')}</span>
        </td>
        <td>
          <span class="mono-val" style="font-size: 0.78rem; color: var(--text-secondary); cursor: pointer;" onclick="filterLedgerByCostCenter('${escapeHtml(p.costCenter)}')" title="Filtrer le Grand Livre par ce centre">${escapeHtml(p.costCenter || '-')}</span>
        </td>
        <td>
          <span class="badge-status ${badgeClass}">${badgeLabel}</span>
        </td>
        <td style="text-align: right;" class="mono-val" style="font-weight: 700;">
          ${formatCurrency(p.poValue)}
        </td>
        <td style="text-align: right;" class="mono-val" style="color: var(--accent-cyan); font-weight: 700;">
          ${formatCurrency(p.invoicedTtc)}
        </td>
        <td>
          <div class="po-rate-cell">
            <div class="po-rate-header">
              <span class="mono-val" style="font-weight: 800; color: ${isOver ? 'var(--accent-coral)' : (p.rate >= 80 ? 'var(--accent-amber)' : 'var(--accent-emerald)')};">
                ${p.rate.toFixed(1)}%
              </span>
            </div>
            <div class="progress-bar-wrap mini">
              <div class="progress-bar-fill ${progressClass}" style="width: ${Math.min(p.rate, 100)}%;"></div>
            </div>
          </div>
        </td>
        <td style="text-align: right;" class="mono-val" style="font-weight: 800; color: ${p.remaining < 0 ? 'var(--accent-coral)' : (p.remaining === 0 ? 'var(--text-tertiary)' : 'var(--accent-emerald)')};">
          ${p.remaining < 0 ? '-' + formatCurrency(Math.abs(p.remaining)) : formatCurrency(p.remaining)}
        </td>
        <td style="text-align: center;">
          <span class="badge-cycle">${p.invoicesCount} fac.</span>
        </td>
        <td style="text-align: center;">
          <button class="btn-table-action" onclick="filterLedgerByPo('${p.poNumber}')" title="Voir les factures rattachées dans le Grand Livre">
            Inspecter →
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function handlePoSearch(val) {
  state.posTable.search = val.trim();
  renderPoCards();
}

function handlePoStatusFilter(val) {
  state.posTable.status = val;
  renderPoCards();
}

function sortPosTable(col) {
  if (state.posTable.sortColumn === col) {
    state.posTable.sortDir = state.posTable.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.posTable.sortColumn = col;
    state.posTable.sortDir = col === 'poNumber' || col === 'vendorName' ? 'asc' : 'desc';
  }
  renderPoCards();
}

function filterLedgerByPo(poNumber) {
  switchTab('invoices');
  const searchInput = document.getElementById('ledgerSearchInput');
  if (searchInput) searchInput.value = poNumber;
  handleSearch(poNumber);
}

/**
 * Onglet 4 : Répertoire des Fournisseurs (Vue Lignes / Tableau Exécutif)
 */
function getVendorDataset() {
  const vendorMap = {};
  state.invoices.forEach(inv => {
    if (!vendorMap[inv.vendorName]) {
      vendorMap[inv.vendorName] = {
        name: inv.vendorName,
        code: inv.vendorCode || 'FOU-000',
        invoicesCount: 0,
        totalTtc: 0,
        paid: 0,
        outstanding: 0,
        cycles: []
      };
    }
    vendorMap[inv.vendorName].invoicesCount++;
    vendorMap[inv.vendorName].totalTtc += (inv.valTtc || 0);
    vendorMap[inv.vendorName].paid += (inv.paidAmount || 0);
    vendorMap[inv.vendorName].outstanding += (inv.outstanding || 0);
    if (inv.cycleDays > 0) vendorMap[inv.vendorName].cycles.push(inv.cycleDays);
  });

  return Object.values(vendorMap).map(v => {
    const avgCycle = v.cycles.length > 0 ? (v.cycles.reduce((a, b) => a + b, 0) / v.cycles.length).toFixed(1) : '-';
    return {
      ...v,
      avgCycle
    };
  });
}

function renderVendorCards() {
  const allVendors = getVendorDataset();

  // 1. Mise à jour des cartes KPI Résumé Fournisseurs
  const totalVendors = allVendors.length;
  const totalVolume = allVendors.reduce((sum, v) => sum + v.totalTtc, 0);
  const totalPaid = allVendors.reduce((sum, v) => sum + v.paid, 0);
  const totalOutstanding = allVendors.reduce((sum, v) => sum + v.outstanding, 0);

  const elTotal = document.getElementById('vendorKpiTotal');
  const elVolume = document.getElementById('vendorKpiTotalVolume');
  const elPaid = document.getElementById('vendorKpiTotalPaid');
  const elOutstanding = document.getElementById('vendorKpiOutstanding');
  const elTitle = document.getElementById('vendorsTitleWithCount');

  if (elTotal) elTotal.textContent = `${totalVendors} Partenaires`;
  if (elVolume) elVolume.textContent = formatCurrency(totalVolume);
  if (elPaid) elPaid.textContent = formatCurrency(totalPaid);
  if (elOutstanding) elOutstanding.textContent = formatCurrency(totalOutstanding);
  if (elTitle) elTitle.textContent = `Répertoire Stratégique des Fournisseurs Partenaires (${totalVendors} Fournisseurs)`;

  const navVendorsBadge = document.getElementById('navVendorsBadge');
  if (navVendorsBadge) navVendorsBadge.textContent = totalVendors;

  // 2. Filtrage
  let filtered = allVendors.filter(v => {
    if (state.vendorsTable.search) {
      const q = state.vendorsTable.search.toLowerCase();
      const matchName = (v.name || '').toLowerCase().includes(q);
      const matchCode = (v.code || '').toLowerCase().includes(q);
      if (!matchName && !matchCode) return false;
    }
    if (state.vendorsTable.filter === 'WITH_BALANCE') {
      if (v.outstanding <= 0) return false;
    } else if (state.vendorsTable.filter === 'FULLY_PAID') {
      if (v.outstanding > 0) return false;
    }
    return true;
  });

  // 3. Tri
  const sortCol = state.vendorsTable.sortColumn;
  const sortDir = state.vendorsTable.sortDir;
  filtered.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (sortCol === 'avgCycle') {
      va = parseFloat(va) || 0;
      vb = parseFloat(vb) || 0;
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // 4. Badge du nombre affiché
  const elBadge = document.getElementById('vendorFilteredCountBadge');
  if (elBadge) elBadge.textContent = `${filtered.length} Fournisseurs affichés`;

  // 5. Rendu du Tableau
  const tbody = document.getElementById('vendorsTableTbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 2.5rem; color: var(--text-tertiary);">
          Aucun fournisseur partenaire ne correspond à vos critères de recherche.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(v => {
    const isCleared = v.outstanding <= 0;
    const badgeClass = isCleared ? 'paid' : 'partially-paid';
    const badgeLabel = isCleared ? 'Soldé à 100%' : 'Encours Actif';

    return `
      <tr>
        <td>
          <span class="mono-val" style="font-weight: 700; color: var(--text-secondary); font-size: 0.78rem;">${v.code || 'FOU-000'}</span>
        </td>
        <td>
          <span class="vendor-link-name" onclick="filterLedgerByVendor('${escapeHtml(v.name)}')" title="Cliquer pour voir toutes les factures de ce fournisseur">
            ${escapeHtml(v.name)}
          </span>
        </td>
        <td style="text-align: center;">
          <span class="badge-cycle">${v.invoicesCount} fac.</span>
        </td>
        <td style="text-align: right;" class="mono-val" style="font-weight: 800;">
          ${formatCurrency(v.totalTtc)}
        </td>
        <td style="text-align: right;" class="mono-val" style="color: var(--accent-emerald); font-weight: 700;">
          ${formatCurrency(v.paid)}
        </td>
        <td style="text-align: right;" class="mono-val" style="font-weight: 800; color: ${v.outstanding > 0 ? 'var(--accent-amber)' : 'var(--text-tertiary)'};">
          ${formatCurrency(v.outstanding)}
        </td>
        <td style="text-align: center;">
          <span class="badge-cycle" style="color: var(--text-primary); border-color: var(--border-medium);">
            ${v.avgCycle !== '-' ? v.avgCycle + ' j' : '-'}
          </span>
        </td>
        <td style="text-align: center;">
          <span class="badge-status ${badgeClass}">${badgeLabel}</span>
        </td>
        <td style="text-align: center;">
          <button class="btn-table-action" onclick="filterLedgerByVendor('${escapeHtml(v.name)}')" title="Filtrer le Grand Livre sur ce fournisseur">
            Voir Factures →
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleVendorSearch(val) {
  state.vendorsTable.search = val.trim();
  renderVendorCards();
}

function handleVendorFilter(val) {
  state.vendorsTable.filter = val;
  renderVendorCards();
}

function sortVendorsTable(col) {
  if (state.vendorsTable.sortColumn === col) {
    state.vendorsTable.sortDir = state.vendorsTable.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.vendorsTable.sortColumn = col;
    state.vendorsTable.sortDir = col === 'code' || col === 'name' ? 'asc' : 'desc';
  }
  renderVendorCards();
}

function filterLedgerByVendor(vendorName) {
  switchTab('invoices');
  const sel = document.getElementById('filterVendor');
  if (sel) sel.value = vendorName;
  applyFilters();
}

// ==========================================================================
// ONGLET 5 : ANALYSE ANALYTIQUE (DÉPARTEMENTS, CENTRES DE COÛT & DEMANDEURS)
// ==========================================================================

function renderDepartmentViews() {
  const records = state.filteredInvoices;
  
  // Ensembles uniques
  const deptsSet = new Set();
  const ccsSet = new Set();
  const reqsSet = new Set();
  const deptSpending = {};

  records.forEach(r => {
    if (r.department) {
      deptsSet.add(r.department);
      deptSpending[r.department] = (deptSpending[r.department] || 0) + (r.valTtc || 0);
    }
    if (r.costCenter) ccsSet.add(r.costCenter);
    if (r.requester) reqsSet.add(r.requester);
  });

  // Top pôle dépensier
  let topDept = '-';
  let topDeptVal = 0;
  for (const [d, val] of Object.entries(deptSpending)) {
    if (val > topDeptVal) {
      topDeptVal = val;
      topDept = d;
    }
  }

  // Mise à jour de la barre de KPIs analytiques
  const elDepts = document.getElementById('analyticsKpiDepts');
  const elCCs = document.getElementById('analyticsKpiCostCenters');
  const elReqs = document.getElementById('analyticsKpiRequesters');
  const elTopDept = document.getElementById('analyticsKpiTopDept');
  const navBadge = document.getElementById('navDeptsBadge');

  if (elDepts) elDepts.textContent = `${deptsSet.size} Pôles`;
  if (elCCs) elCCs.textContent = `${ccsSet.size} Centres`;
  if (elReqs) elReqs.textContent = `${reqsSet.size} Prescripteurs`;
  if (elTopDept) elTopDept.textContent = topDept;
  if (navBadge) navBadge.textContent = deptsSet.size;

  const btnDept = document.getElementById('btnSubDept');
  const btnCc = document.getElementById('btnSubCostCenter');
  const btnReq = document.getElementById('btnSubRequester');
  if (btnDept) btnDept.innerHTML = `<span>Par Département (${deptsSet.size})</span>`;
  if (btnCc) btnCc.innerHTML = `<span>Par Centre de Coût (${ccsSet.size})</span>`;
  if (btnReq) btnReq.innerHTML = `<span>Par Demandeur (${reqsSet.size})</span>`;

  // Graphiques analytiques
  const theme = getChartThemeColors();
  renderAnalyticsCharts(theme);

  // Rendu de la table analytique active
  renderAnalyticsActiveTable();
}

function renderAnalyticsCharts(theme) {
  const records = state.filteredInvoices;
  const rate = CONFIG.rates[state.currentCurrency];

  // 1. Dépenses par Département
  const deptCanvas = document.getElementById('analyticsDeptChart');
  if (deptCanvas) {
    const deptTotals = {};
    records.forEach(r => {
      const d = r.department || 'Non spécifié';
      deptTotals[d] = (deptTotals[d] || 0) + (r.valTtc * rate);
    });

    const sortedDepts = Object.entries(deptTotals).sort((a, b) => b[1] - a[1]);
    const labels = sortedDepts.map(e => e[0]);
    const data = sortedDepts.map(e => Math.round(e[1]));

    const palette = [
      '#0284C7', '#10B981', '#F59E0B', '#EF4444',
      '#6366F1', '#06B6D4', '#8B5CF6', '#EC4899', '#14B8A6'
    ];

    if (state.charts.analyticsDept) state.charts.analyticsDept.destroy();
    state.charts.analyticsDept = new Chart(deptCanvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: palette.slice(0, labels.length),
          borderWidth: 2,
          borderColor: state.theme === 'dark' ? '#0E1626' : '#FFFFFF'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: theme.textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              label: function(c) {
                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((c.raw / total) * 100).toFixed(1) : 0;
                return ` ${c.label} : ${c.raw.toLocaleString('fr-FR')} ${CONFIG.currencySymbols[state.currentCurrency]} (${pct}%)`;
              }
            }
          }
        },
        cutout: '62%'
      }
    });
  }

  // 2. Ventilation par Centre de Coût
  const ccCanvas = document.getElementById('analyticsCostCenterChart');
  if (ccCanvas) {
    const ccTotals = {};
    records.forEach(r => {
      const cc = r.costCenter || 'N/A';
      ccTotals[cc] = (ccTotals[cc] || 0) + (r.valTtc * rate);
    });

    const sortedCcs = Object.entries(ccTotals).sort((a, b) => b[1] - a[1]);
    const labels = sortedCcs.map(e => e[0]);
    const data = sortedCcs.map(e => Math.round(e[1]));

    if (state.charts.analyticsCc) state.charts.analyticsCc.destroy();
    state.charts.analyticsCc = new Chart(ccCanvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Montant Consommé',
          data: data,
          backgroundColor: 'rgba(2, 132, 199, 0.75)',
          borderColor: '#0284C7',
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              label: function(c) {
                return ` Montant : ${c.raw.toLocaleString('fr-FR')} ${CONFIG.currencySymbols[state.currentCurrency]}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: theme.gridColor },
            ticks: {
              color: theme.textColor,
              font: { family: 'JetBrains Mono', size: 10 },
              callback: val => val >= 1000000 ? (val / 1000000).toFixed(0) + 'M' : (val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val)
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: theme.textColor,
              font: { family: 'JetBrains Mono', size: 11, weight: '600' }
            }
          }
        }
      }
    });
  }
}

function switchAnalyticsSubView(subView) {
  state.analytics.subView = subView;
  
  const btnDept = document.getElementById('btnSubDept');
  const btnCc = document.getElementById('btnSubCostCenter');
  const btnReq = document.getElementById('btnSubRequester');

  if (btnDept) btnDept.classList.toggle('active', subView === 'departments');
  if (btnCc) btnCc.classList.toggle('active', subView === 'costCenters');
  if (btnReq) btnReq.classList.toggle('active', subView === 'requesters');

  const viewDept = document.getElementById('viewAnalyticsDepartments');
  const viewCc = document.getElementById('viewAnalyticsCostCenters');
  const viewReq = document.getElementById('viewAnalyticsRequesters');

  if (viewDept) viewDept.style.display = subView === 'departments' ? 'block' : 'none';
  if (viewCc) viewCc.style.display = subView === 'costCenters' ? 'block' : 'none';
  if (viewReq) viewReq.style.display = subView === 'requesters' ? 'block' : 'none';

  renderAnalyticsActiveTable();
}

function handleAnalyticsSearch(val) {
  state.analytics.search = (val || '').trim().toLowerCase();
  renderAnalyticsActiveTable();
}

function sortAnalyticsTable(view, col) {
  if (!state.analytics.sort[view]) {
    state.analytics.sort[view] = { col: col, dir: 'desc' };
  } else if (state.analytics.sort[view].col === col) {
    state.analytics.sort[view].dir = state.analytics.sort[view].dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.analytics.sort[view].col = col;
    state.analytics.sort[view].dir = (col === 'name' || col === 'code' || col === 'requester' || col === 'department') ? 'asc' : 'desc';
  }
  renderAnalyticsActiveTable();
}

function renderAnalyticsActiveTable() {
  const records = state.filteredInvoices;
  const grandTotalTtc = records.reduce((s, r) => s + (r.valTtc || 0), 0);
  const q = state.analytics.search;

  if (state.analytics.subView === 'departments') {
    const tbody = document.getElementById('analyticsDeptsTbody');
    if (!tbody) return;

    const deptMap = {};
    records.forEach(r => {
      const d = r.department || 'Non spécifié';
      if (!deptMap[d]) {
        deptMap[d] = {
          name: d,
          costCenters: new Set(),
          invoicesCount: 0,
          totalTtc: 0,
          paid: 0,
          outstanding: 0,
          cycles: []
        };
      }
      if (r.costCenter) deptMap[d].costCenters.add(r.costCenter);
      deptMap[d].invoicesCount++;
      deptMap[d].totalTtc += (r.valTtc || 0);
      deptMap[d].paid += (r.paidAmount || 0);
      deptMap[d].outstanding += (r.outstanding || 0);
      if (r.cycleDays > 0) deptMap[d].cycles.push(r.cycleDays);
    });

    let list = Object.values(deptMap).map(d => {
      const avgCycle = d.cycles.length > 0 ? (d.cycles.reduce((a, b) => a + b, 0) / d.cycles.length).toFixed(1) : '-';
      const pctShare = grandTotalTtc > 0 ? (d.totalTtc / grandTotalTtc) * 100 : 0;
      return {
        ...d,
        costCentersList: Array.from(d.costCenters).sort(),
        avgCycle,
        pctShare
      };
    });

    if (q) {
      list = list.filter(d => d.name.toLowerCase().includes(q) || d.costCentersList.some(c => c.toLowerCase().includes(q)));
    }

    const sortConfig = state.analytics.sort.departments;
    list.sort((a, b) => {
      let va = a[sortConfig.col];
      let vb = b[sortConfig.col];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2.5rem; color: var(--text-tertiary);">Aucun département correspondant aux filtres.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(d => `
      <tr>
        <td>
          <span style="font-weight: 700; cursor: pointer; color: var(--accent-cyan);" onclick="filterLedgerByDept('${escapeHtml(d.name)}')" title="Cliquer pour filtrer dans le Grand Livre">${escapeHtml(d.name)}</span>
        </td>
        <td>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            ${d.costCentersList.map(cc => `<span class="mono-val" style="font-size: 0.78rem; color: var(--text-secondary); cursor: pointer;" onclick="filterLedgerByCostCenter('${escapeHtml(cc)}')" title="Filtrer par ${escapeHtml(cc)}">${escapeHtml(cc)}</span>`).join(', ') || '<span style="color: var(--text-tertiary);">-</span>'}
          </div>
        </td>
        <td style="text-align: center;" class="mono-val">${d.invoicesCount}</td>
        <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(d.totalTtc)}</td>
        <td style="text-align: right; color: var(--accent-emerald); font-weight: 700;" class="mono-val">${formatCurrency(d.paid)}</td>
        <td style="text-align: right; color: ${d.outstanding > 0 ? 'var(--accent-coral)' : 'var(--text-tertiary)'}; font-weight: 700;" class="mono-val">${formatCurrency(d.outstanding)}</td>
        <td style="text-align: center;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <span class="mono-val" style="font-weight: 700; min-width: 42px;">${d.pctShare.toFixed(1)}%</span>
            <div class="progress-bar-wrap mini" style="width: 50px;">
              <div class="progress-bar-fill safe" style="width: ${Math.min(d.pctShare, 100)}%;"></div>
            </div>
          </div>
        </td>
        <td style="text-align: center;">
          <span class="badge-cycle">${d.avgCycle !== '-' ? d.avgCycle + ' j' : '-'}</span>
        </td>
        <td style="text-align: center;">
          <button class="btn-table-action" onclick="filterLedgerByDept('${escapeHtml(d.name)}')" title="Voir toutes les factures de ce département">
            Filtrer Grand Livre →
          </button>
        </td>
      </tr>
    `).join('');

  } else if (state.analytics.subView === 'costCenters') {
    const tbody = document.getElementById('analyticsCostCentersTbody');
    if (!tbody) return;

    const ccMap = {};
    records.forEach(r => {
      const cc = r.costCenter || 'Non spécifié';
      if (!ccMap[cc]) {
        ccMap[cc] = {
          code: cc,
          departments: new Set(),
          invoicesCount: 0,
          totalTtc: 0,
          paid: 0,
          outstanding: 0
        };
      }
      if (r.department) ccMap[cc].departments.add(r.department);
      ccMap[cc].invoicesCount++;
      ccMap[cc].totalTtc += (r.valTtc || 0);
      ccMap[cc].paid += (r.paidAmount || 0);
      ccMap[cc].outstanding += (r.outstanding || 0);
    });

    let list = Object.values(ccMap).map(c => ({
      ...c,
      department: Array.from(c.departments).join(', ') || 'N/A'
    }));

    if (q) {
      list = list.filter(c => c.code.toLowerCase().includes(q) || c.department.toLowerCase().includes(q));
    }

    const sortConfig = state.analytics.sort.costCenters;
    list.sort((a, b) => {
      let va = a[sortConfig.col];
      let vb = b[sortConfig.col];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-tertiary);">Aucun centre de coût trouvé.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(c => `
      <tr>
        <td>
          <span class="mono-val" style="font-weight: 700; color: var(--accent-cyan); cursor: pointer;" onclick="filterLedgerByCostCenter('${escapeHtml(c.code)}')" title="Filtrer Grand Livre par ce centre">${escapeHtml(c.code)}</span>
        </td>
        <td>
          <span style="font-weight: 600;">${escapeHtml(c.department)}</span>
        </td>
        <td style="text-align: center;" class="mono-val">${c.invoicesCount}</td>
        <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(c.totalTtc)}</td>
        <td style="text-align: right; color: var(--accent-emerald); font-weight: 700;" class="mono-val">${formatCurrency(c.paid)}</td>
        <td style="text-align: right; color: ${c.outstanding > 0 ? 'var(--accent-coral)' : 'var(--text-tertiary)'}; font-weight: 700;" class="mono-val">${formatCurrency(c.outstanding)}</td>
        <td style="text-align: center;">
          <span class="badge-status ${c.outstanding === 0 ? 'paid' : 'partially-paid'}">
            ${c.outstanding === 0 ? 'Soldé' : 'Solde En Cours'}
          </span>
        </td>
        <td style="text-align: center;">
          <button class="btn-table-action" onclick="filterLedgerByCostCenter('${escapeHtml(c.code)}')" title="Voir toutes les factures de ce centre">
            Filtrer Grand Livre →
          </button>
        </td>
      </tr>
    `).join('');

  } else if (state.analytics.subView === 'requesters') {
    const tbody = document.getElementById('analyticsRequestersTbody');
    if (!tbody) return;

    const reqMap = {};
    records.forEach(r => {
      const req = r.requester || 'Non spécifié';
      if (!reqMap[req]) {
        reqMap[req] = {
          requester: req,
          departments: new Set(),
          costCenters: new Set(),
          invoicesCount: 0,
          totalTtc: 0,
          paid: 0,
          outstanding: 0
        };
      }
      if (r.department) reqMap[req].departments.add(r.department);
      if (r.costCenter) reqMap[req].costCenters.add(r.costCenter);
      reqMap[req].invoicesCount++;
      reqMap[req].totalTtc += (r.valTtc || 0);
      reqMap[req].paid += (r.paidAmount || 0);
      reqMap[req].outstanding += (r.outstanding || 0);
    });

    let list = Object.values(reqMap).map(r => ({
      ...r,
      department: Array.from(r.departments).join(', ') || 'N/A',
      costCenter: Array.from(r.costCenters).join(', ') || '-'
    }));

    if (q) {
      list = list.filter(r => r.requester.toLowerCase().includes(q) || r.department.toLowerCase().includes(q) || r.costCenter.toLowerCase().includes(q));
    }

    const sortConfig = state.analytics.sort.requesters;
    list.sort((a, b) => {
      let va = a[sortConfig.col];
      let vb = b[sortConfig.col];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-tertiary);">Aucun demandeur trouvé.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td>
          <span class="mono-val" style="font-weight: 700; color: var(--accent-cyan); cursor: pointer;" onclick="filterLedgerByRequester('${escapeHtml(r.requester)}')" title="Filtrer Grand Livre par ce demandeur">${escapeHtml(r.requester)}</span>
        </td>
        <td>
          <span style="font-weight: 600;">${escapeHtml(r.department)}</span>
        </td>
        <td>
          <span class="mono-val" style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(r.costCenter || '-')}</span>
        </td>
        <td style="text-align: center;" class="mono-val">${r.invoicesCount}</td>
        <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(r.totalTtc)}</td>
        <td style="text-align: right; color: var(--accent-emerald); font-weight: 700;" class="mono-val">${formatCurrency(r.paid)}</td>
        <td style="text-align: right; color: ${r.outstanding > 0 ? 'var(--accent-coral)' : 'var(--text-tertiary)'}; font-weight: 700;" class="mono-val">${formatCurrency(r.outstanding)}</td>
        <td style="text-align: center;">
          <button class="btn-table-action" onclick="filterLedgerByRequester('${escapeHtml(r.requester)}')" title="Voir toutes les factures de ce demandeur">
            Filtrer Grand Livre →
          </button>
        </td>
      </tr>
    `).join('');
  }
}

function filterLedgerByDept(deptName) {
  switchTab('invoices');
  const sel = document.getElementById('filterDept');
  if (sel) {
    sel.value = deptName;
    state.filters.dept = deptName;
  }
  applyFilters();
}

function filterLedgerByCostCenter(ccCode) {
  switchTab('invoices');
  const sel = document.getElementById('filterCostCenter');
  if (sel) {
    sel.value = ccCode;
    state.filters.costCenter = ccCode;
  }
  applyFilters();
}

function filterLedgerByRequester(reqCode) {
  switchTab('invoices');
  const sel = document.getElementById('filterRequester');
  if (sel) {
    sel.value = reqCode;
    state.filters.requester = reqCode;
  }
  applyFilters();
}

/**
 * Onglet 6 : Radar d'Audit & Risques
 */
function renderAuditViews() {
  const overInvoicedTbody = document.getElementById('auditOverInvoicedTbody');
  const exceptionsTbody = document.getElementById('auditExceptionsTbody');

  const overInvoiced = state.invoices.filter(i => i.overInvoiced);
  const exceptions = state.invoices.filter(i => i.invoiceStatus === 'Exception' || i.invoiceStatus === 'On Hold' || i.exceptionReason);

  if (overInvoicedTbody) {
    if (overInvoiced.length === 0) {
      overInvoicedTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--accent-emerald);">Aucune anomalie de surfacturation détectée.</td></tr>`;
    } else {
      overInvoicedTbody.innerHTML = overInvoiced.map(inv => `
        <tr onclick="openInvoiceDrawer('${inv.invoiceNo}')">
          <td class="mono-val" style="font-weight: 700; color: var(--accent-coral);">${inv.invoiceNo}</td>
          <td class="mono-val">${inv.poNumber}</td>
          <td style="font-weight: 600;">${escapeHtml(inv.vendorName)}</td>
          <td style="text-align: right; font-weight: 800;" class="mono-val">${formatCurrency(inv.valTtc)}</td>
          <td style="text-align: right;" class="mono-val">${formatCurrency(inv.poValue)}</td>
          <td style="text-align: right; color: var(--accent-coral); font-weight: 800;" class="mono-val">${formatCurrency(inv.poVariance)}</td>
          <td style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(inv.remarks || 'Dépassement du plafond autorisé')}</td>
        </tr>
      `).join('');
    }
  }

  if (exceptionsTbody) {
    if (exceptions.length === 0) {
      exceptionsTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--accent-emerald);">Aucune facture en litige ou bloquée.</td></tr>`;
    } else {
      exceptionsTbody.innerHTML = exceptions.map(inv => `
        <tr onclick="openInvoiceDrawer('${inv.invoiceNo}')">
          <td class="mono-val" style="font-weight: 700; color: var(--accent-amber);">${inv.invoiceNo}</td>
          <td class="mono-val">${formatDateFr(inv.invoiceDate)}</td>
          <td style="font-weight: 600;">${escapeHtml(inv.vendorName)}</td>
          <td style="text-align: right; font-weight: 700;" class="mono-val">${formatCurrency(inv.valTtc)}</td>
          <td><span class="badge-status ${getApprovalClass(inv.invoiceStatus)}">${translateStatus(inv.invoiceStatus)}</span></td>
          <td style="color: var(--accent-amber); font-weight: 600;">${escapeHtml(inv.exceptionReason || inv.remarks || 'Motif administratif')}</td>
        </tr>
      `).join('');
    }
  }
}

// ==========================================================================
// TIROIR DE DÉTAIL FACTURE (INVOICE DRAWER MODAL)
// ==========================================================================

function openInvoiceDrawer(invoiceNo) {
  const inv = state.invoices.find(i => i.invoiceNo === invoiceNo);
  if (!inv) return;

  const setT = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setT('drawerInvoiceNo', inv.invoiceNo);
  setT('drawerVendorName', `${inv.vendorName} (${inv.vendorCode})`);
  setT('drawerCompanyCode', inv.companyCode || 'BIS');
  setT('drawerInvoiceType', inv.invoiceType || 'Standard');
  setT('drawerPcType', inv.pcType || 'Standard');
  setT('drawerVendorCode', inv.vendorCode || '-');
  setT('drawerWorkDesc', inv.workDesc || '-');

  setT('drawerDept', inv.department);
  setT('drawerCostCenter', inv.costCenter || 'CC-STANDARD');
  setT('drawerRequester', inv.requester || 'DIRECTION');
  setT('drawerFinalInvoiceFlag', inv.finalInvoiceFlag === 'Yes' ? 'Oui (Dernière Facture)' : 'Non');
  setT('drawerRemarks', inv.remarks || (inv.exceptionReason ? `Motif retenue : ${inv.exceptionReason}` : 'Aucune observation particulière'));

  setT('drawerPoMatch', `${inv.poNumber} — Statut BC : ${inv.poStatus || 'Valide'}`);
  setT('drawerGrnMatch', `${inv.sesGrnNo || 'N/A'} — ${inv.sesGrnStatus || 'Vérifié'}`);
  setT('drawerVarianceMatch', inv.overInvoiced ? `⚠️ Surfacturation (${formatCurrency(inv.poVariance)})` : '✅ Conforme au Bon de Commande');

  const varMatchEl = document.getElementById('drawerVarianceMatch');
  if (varMatchEl) {
    varMatchEl.style.color = inv.overInvoiced ? 'var(--accent-coral)' : 'var(--accent-emerald)';
  }

  setT('drawerPoNumber', inv.poNumber);
  setT('drawerPoStatus', inv.poStatus || '-');
  setT('drawerPoValue', formatCurrency(inv.poValue));
  setT('drawerRemainingPo', formatCurrency(inv.remainingPo));
  setT('drawerPoUtil', inv.poUtilization || (inv.poValue > 0 ? ((inv.valTtc / inv.poValue) * 100).toFixed(1) + '%' : '-'));
  setT('drawerPoVariance', formatCurrency(inv.poVariance));
  setT('drawerPoCreationDate', formatDateFr(inv.poCreationDate));
  setT('drawerPoApprovalDate', formatDateFr(inv.poApprovalDate));

  setT('drawerGrnNo', inv.sesGrnNo || '-');
  setT('drawerGrnStatus', inv.sesGrnStatus || '-');
  setT('drawerPcSentDate', formatDateFr(inv.pcSentDate));
  setT('drawerGrnReceivedDate', formatDateFr(inv.grnReceivedDate));
  setT('drawerSubmitFinanceDate', formatDateFr(inv.submitFinanceDate));
  setT('drawerApprovalDate', formatDateFr(inv.approvalDate));
  setT('drawerInvoiceStatus', translateStatus(inv.invoiceStatus));
  setT('drawerExceptionReason', inv.exceptionReason || 'Aucune exception signalée');

  setT('drawerValHt', formatCurrency(inv.valHt));
  setT('drawerValVat', formatCurrency(inv.valVat));
  setT('drawerValTtc', formatCurrency(inv.valTtc));
  setT('drawerValPaid', formatCurrency(inv.paidAmount));
  setT('drawerValOutstanding', formatCurrency(inv.outstanding));
  setT('drawerPaymentStatus', translateStatus(inv.paymentStatus));
  setT('drawerPrevInvoiced', formatCurrency(inv.previousInvoiced));
  setT('drawerPrevPaid', formatCurrency(inv.previousPaid));
  setT('drawerPoUnpaidBalance', formatCurrency(inv.poUnpaidBalance));
  setT('drawerPayRef', inv.payRef || '-');
  setT('drawerPaymentType', inv.paymentType);
  setT('drawerPaymentTerms', `${inv.paymentTerms || 30} jours`);
  setT('drawerReceiptDate', formatDateFr(inv.receiptDate));
  setT('drawerDueDate', formatDateFr(inv.dueDate));
  setT('drawerPaymentDate', formatDateFr(inv.paymentDate));

  setT('drawerStep1', inv.step1Days !== undefined && inv.step1Days !== null ? `${inv.step1Days} jours` : '-');
  setT('drawerStep2', inv.step2Days !== undefined && inv.step2Days !== null ? `${inv.step2Days} jours` : '-');
  setT('drawerStep3', inv.step3Days !== undefined && inv.step3Days !== null ? `${inv.step3Days} jours` : '-');
  setT('drawerStep4', inv.step4Days !== undefined && inv.step4Days !== null ? `${inv.step4Days} jours` : '-');
  setT('drawerCycleDays', inv.cycleDays ? `${inv.cycleDays} jours` : 'En cours');

  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.classList.add('active');
}

function closeDrawer(event) {
  if (event && event.target && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.classList.remove('active');
}

// ==========================================================================
// MODAL DE DIAGNOSTIC GOOGLE SHEETS
// ==========================================================================

function openDiagnosticModal() {
  const modal = document.getElementById('diagnosticModal');
  if (modal) modal.classList.add('active');
}

function closeDiagnosticModal(event) {
  if (event && event.target && event.target !== event.currentTarget) return;
  const modal = document.getElementById('diagnosticModal');
  if (modal) modal.classList.remove('active');
}

// ==========================================================================
// NAVIGATION PAR ONGLETS & CONTRÔLE DE THÈME
// ==========================================================================

function switchTab(tabId) {
  state.currentTab = tabId;

  // Mettre à jour les boutons
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Mettre à jour les panneaux
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  // Redimensionner les graphiques si nécessaire
  if (tabId === 'overview' || tabId === 'sla' || tabId === 'departments') {
    setTimeout(() => {
      Object.values(state.charts).forEach(c => {
        if (c && typeof c.resize === 'function') c.resize();
      });
    }, 50);
  }

  if (tabId === 'sheets') {
    updateSheetsFilterBanner();
    renderFullSheetsTable();
  }
}

function setChartMode(mode) {
  state.chartMode = mode;
  document.getElementById('btnChartMonthly')?.classList.toggle('active', mode === 'monthly');
  document.getElementById('btnChartCumulative')?.classList.toggle('active', mode === 'cumulative');
  renderTrajectoryChart(getChartThemeColors());
}

function setCurrency(curr) {
  if (!CONFIG.rates[curr]) return;
  state.currentCurrency = curr;

  document.querySelectorAll('.curr-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.curr === curr);
  });

  const metrics = calculateExecutiveMetrics(state.filteredInvoices);
  renderKpiCards(metrics);
  renderMasterLedgerTable();
  initOrUpdateCharts();
  renderOverviewDeptTable();
  renderFullSheetsTable();
  renderAllViews();

  showToast(`Devise active : ${CONFIG.currencySymbols[curr]} (${curr})`, 'success');
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
  localStorage.setItem('aiforce_theme', state.theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconSun = document.getElementById('themeIconSun');
  const iconMoon = document.getElementById('themeIconMoon');
  const logo = document.getElementById('appLogo');

  if (theme === 'dark') {
    if (iconSun) iconSun.style.display = 'none';
    if (iconMoon) iconMoon.style.display = 'block';
    if (logo) logo.src = 'assets/aiforce-logo-dark-mode.png';
  } else {
    if (iconSun) iconSun.style.display = 'block';
    if (iconMoon) iconMoon.style.display = 'none';
    if (logo) logo.src = 'assets/aiforce-logo-transparent.png';
  }

  initOrUpdateCharts();
}

// ==========================================================================
// CONTRÔLE PLEIN ÉCRAN / FULL VIEW IMMERSIF
// ==========================================================================

function isNativeFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function toggleFullscreen() {
  const isFull = isNativeFullscreen();

  if (!isFull) {
    const docEl = document.documentElement;
    const reqFn = docEl.requestFullscreen ||
                  docEl.webkitRequestFullscreen ||
                  docEl.webkitRequestFullScreen ||
                  docEl.mozRequestFullScreen ||
                  docEl.msRequestFullscreen;

    if (reqFn) {
      try {
        const promise = reqFn.call(docEl);
        if (promise && typeof promise.then === 'function') {
          promise.then(() => {
            updateFullscreenUI(true);
          }).catch(err => {
            console.warn('Requête plein écran native rejetée:', err);
            updateFullscreenUI(true);
            showToast('Astuce macOS : Utilisez Cmd + Maj + F pour masquer la barre d\'outils Chrome', 'info');
          });
        } else {
          updateFullscreenUI(true);
        }
      } catch (e) {
        console.error('Erreur appel fullscreen:', e);
        updateFullscreenUI(true);
      }
    } else {
      updateFullscreenUI(true);
    }
  } else {
    const exitFn = document.exitFullscreen ||
                   document.webkitExitFullscreen ||
                   document.webkitCancelFullScreen ||
                   document.mozCancelFullScreen ||
                   document.msExitFullscreen;

    if (exitFn) {
      try {
        const promise = exitFn.call(document);
        if (promise && typeof promise.then === 'function') {
          promise.then(() => {
            updateFullscreenUI(false);
          }).catch(err => {
            console.warn('Erreur sortie fullscreen:', err);
            updateFullscreenUI(false);
          });
        } else {
          updateFullscreenUI(false);
        }
      } catch (e) {
        console.error('Erreur sortie fullscreen:', e);
        updateFullscreenUI(false);
      }
    } else {
      updateFullscreenUI(false);
    }
  }
}

function updateFullscreenUI(isFull) {
  document.body.classList.toggle('is-fullscreen', isFull);
  const iconExpand = document.getElementById('fullscreenIconExpand');
  const iconCompress = document.getElementById('fullscreenIconCompress');
  const btn = document.getElementById('fullscreenToggleBtn');

  if (isFull) {
    if (iconExpand) iconExpand.style.display = 'none';
    if (iconCompress) iconCompress.style.display = 'block';
    if (btn) {
      btn.title = 'Quitter le Plein Écran (Échap)';
      btn.setAttribute('aria-label', 'Quitter le Plein Écran');
    }
    showToast('Mode Plein Écran activé', 'info');
  } else {
    if (iconExpand) iconExpand.style.display = 'block';
    if (iconCompress) iconCompress.style.display = 'none';
    if (btn) {
      btn.title = 'Activer le Plein Écran (Full View)';
      btn.setAttribute('aria-label', 'Activer le Plein Écran');
    }
    showToast('Mode Plein Écran désactivé', 'info');
  }

  // Redimensionner dynamiquement les graphiques pour occuper 100% de la largeur
  setTimeout(() => {
    Object.values(state.charts).forEach(c => {
      if (c && typeof c.resize === 'function') c.resize();
    });
  }, 100);
}

// Écouteurs pour la synchronisation native (Esc, F11, gestes)
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evtName => {
  document.addEventListener(evtName, () => {
    const isNativeFull = isNativeFullscreen();
    updateFullscreenUI(isNativeFull);
  });
});

// Écouteur pour la touche Échap en mode repli Full-View CSS
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('is-fullscreen') && !isNativeFullscreen()) {
    updateFullscreenUI(false);
  }
});

// Export global pour être certain qu'il est accessible par le bouton HTML
window.toggleFullscreen = toggleFullscreen;

// ==========================================================================
// EXPORTATION CSV DU GRAND LIVRE
// ==========================================================================

function exportLedgerCsv() {
  exportFull54ColumnsCsv();
}

// ==========================================================================
// TOAST NOTIFICATIONS HUB
// ==========================================================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${type === 'success' ? '<polyline points="20 6 9 17 4 12"></polyline>' : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================================================
// AI DATA ANALYST — MOTEUR D'INTELLIGENCE ARTIFICIELLE & SÉCURITÉ QWEN
// ==========================================================================

/**
 * 1. Vérification du statut de la clé API Qwen côté serveur (.env)
 */
async function checkAiServerStatus() {
  try {
    const res = await fetch('/api/ai-status');
    if (res.ok) {
      const data = await res.json();
      state.ai.hasServerKey = !!data.hasEnvKey;
      if (data.baseUrl && !localStorage.getItem('aiforce_ai_base_url')) {
        state.ai.baseUrl = data.baseUrl;
      }
      if (data.model) {
        if (!localStorage.getItem('aiforce_ai_model') || localStorage.getItem('aiforce_ai_model') === 'qwen-plus') {
          state.ai.model = data.model;
          localStorage.setItem('aiforce_ai_model', data.model);
        }
      }
      updateAiStatusBadges();
    }
  } catch (e) {
    console.warn('Passerelle locale /api/ai-status non accessible:', e);
  }
}

/**
 * Met à jour les pastilles de statut dans l'interface
 */
function updateAiStatusBadges() {
  const triggerDot = document.getElementById('aiTriggerStatusDot');
  const headerPip = document.getElementById('aiHeaderStatusPip');
  const envStatusBadge = document.getElementById('aiSettingsEnvStatus');
  const modelTag = document.getElementById('aiModelTag');

  const hasKey = state.ai.hasServerKey || !!state.ai.apiKey;

  if (triggerDot) {
    triggerDot.style.background = hasKey ? 'var(--accent-emerald, #10b981)' : 'var(--accent-amber, #f59e0b)';
    triggerDot.style.boxShadow = hasKey ? '0 0 8px #10b981' : '0 0 8px #f59e0b';
    triggerDot.title = hasKey ? 'AI Data Analyst prêt et opérationnel' : 'Clé API Qwen requise';
  }
  if (headerPip) {
    headerPip.style.background = hasKey ? 'var(--accent-emerald, #10b981)' : 'var(--accent-amber, #f59e0b)';
  }
  if (modelTag) {
    modelTag.textContent = state.ai.model.replace('-', ' ').toUpperCase();
  }
  if (envStatusBadge) {
    if (state.ai.hasServerKey) {
      envStatusBadge.className = 'badge-status paid';
      envStatusBadge.textContent = 'Active (.env protégé)';
    } else if (state.ai.apiKey) {
      envStatusBadge.className = 'badge-status partial';
      envStatusBadge.textContent = 'Active (Navigateur UI)';
    } else {
      envStatusBadge.className = 'badge-status rejected';
      envStatusBadge.textContent = 'Non configurée';
    }
  }
}

/**
 * 2. Compilateur de Contexte d'Entreprise en Temps Réel
 * Agrège l'ensemble des 88 factures, bons de commande, fournisseurs,
 * départements et alertes d'audit dans un format dense et précis pour le LLM.
 */
function buildEnterpriseAiContext() {
  const totalInvoices = state.invoices.length;
  if (totalInvoices === 0) return "Aucune donnée de facture chargée.";

  // A. Métriques Globales Réelles
  let totalHt = 0, totalVat = 0, totalTtc = 0, totalPaid = 0, totalOutstanding = 0;
  let overdueCount = 0, overdueAmount = 0;
  let overInvoicedCount = 0;

  state.invoices.forEach(inv => {
    totalHt += (inv.valHt || 0);
    totalVat += (inv.valVat || 0);
    totalTtc += (inv.valTtc || 0);
    totalPaid += (inv.paidAmount || 0);
    totalOutstanding += (inv.outstanding || 0);

    if (inv.dueStatus === 'Échue' && inv.outstanding > 0) {
      overdueCount++;
      overdueAmount += inv.outstanding;
    }
    if (inv.poValue > 0 && inv.valTtc > inv.poValue) {
      overInvoicedCount++;
    }
  });

  const paymentRate = totalTtc > 0 ? ((totalPaid / totalTtc) * 100).toFixed(1) : 0;

  // B. Synthèse des Bons de Commande (POs)
  const poMap = {};
  state.invoices.forEach(inv => {
    const po = inv.poNumber || 'SANS_BC';
    if (!poMap[po]) {
      poMap[po] = {
        poNumber: po,
        vendor: inv.vendorName,
        poValue: inv.poValue || 0,
        invoicedTtc: 0,
        paid: 0,
        status: inv.poStatus || 'Inconnu'
      };
    }
    poMap[po].invoicedTtc += (inv.valTtc || 0);
    poMap[po].paid += (inv.paidAmount || 0);
  });

  const poSummaryLines = Object.values(poMap).map(p => {
    const remaining = p.poValue > 0 ? (p.poValue - p.invoicedTtc) : 0;
    const isOver = p.poValue > 0 && p.invoicedTtc > p.poValue;
    return `- BC ${p.poNumber} | Fournisseur: ${p.vendor} | Valeur BC: ${p.poValue.toLocaleString('fr-FR')} FCFA | Total Facturé: ${p.invoicedTtc.toLocaleString('fr-FR')} FCFA | Solde Dispo: ${remaining.toLocaleString('fr-FR')} FCFA | Statut: ${p.status}${isOver ? ' [ALERTE SURFACTURATION]' : ''}`;
  }).join('\n');

  // C. Synthèse des Fournisseurs
  const vendorMap = {};
  state.invoices.forEach(inv => {
    const v = inv.vendorName || 'Inconnu';
    if (!vendorMap[v]) {
      vendorMap[v] = { name: v, code: inv.vendorCode, count: 0, ttc: 0, paid: 0, outstanding: 0 };
    }
    vendorMap[v].count++;
    vendorMap[v].ttc += (inv.valTtc || 0);
    vendorMap[v].paid += (inv.paidAmount || 0);
    vendorMap[v].outstanding += (inv.outstanding || 0);
  });

  const topVendorsBySpend = Object.values(vendorMap)
    .sort((a, b) => b.ttc - a.ttc)
    .slice(0, 10)
    .map((v, i) => `${i + 1}. ${v.name} (${v.code}) : ${v.ttc.toLocaleString('fr-FR')} FCFA TTC (${v.count} factures, Solde dû: ${v.outstanding.toLocaleString('fr-FR')} FCFA)`)
    .join('\n');

  // D. Synthèse des Départements
  const deptMap = {};
  state.invoices.forEach(inv => {
    const d = inv.department || 'Non spécifié';
    deptMap[d] = (deptMap[d] || 0) + (inv.valTtc || 0);
  });
  const deptSummary = Object.entries(deptMap)
    .map(([d, val]) => `- ${d} : ${val.toLocaleString('fr-FR')} FCFA (${((val / totalTtc) * 100).toFixed(1)}%)`)
    .join('\n');

  // E. Table Intégrale Compacte des Factures
  const invoicesTable = state.invoices.map(inv => {
    const overFlag = (inv.poValue > 0 && inv.valTtc > inv.poValue) ? 'SURFACTURATION' : 'OK';
    return `${inv.id || inv.sn}|${inv.invoiceNumber}|${inv.invoiceDate || '-'}|${inv.vendorName}|${inv.poNumber || '-'}|${inv.valTtc || 0}|${inv.paidAmount || 0}|${inv.outstanding || 0}|${inv.paymentStatus}|${inv.dueDate || '-'}|${inv.dueStatus}|${inv.department || '-'}|${inv.cycleDays || 0}j|${overFlag}`;
  }).join('\n');

  return `
=== RÉSUMÉ EXÉCUTIF DU TABLEAU DE BORD PROCUREMENT 2.0 (AIFORCE AGENCY) ===
- Nombre total de factures : ${totalInvoices}
- Volume Financier Total (TTC) : ${totalTtc.toLocaleString('fr-FR')} FCFA
- Total Hors Taxe (HT) : ${totalHt.toLocaleString('fr-FR')} FCFA
- Total TVA : ${totalVat.toLocaleString('fr-FR')} FCFA
- Montant Total Payé : ${totalPaid.toLocaleString('fr-FR')} FCFA
- Solde Restant Dû (Impayés) : ${totalOutstanding.toLocaleString('fr-FR')} FCFA
- Taux Global de Règlement : ${paymentRate}%
- Factures Échues en Retard : ${overdueCount} (Montant à risque : ${overdueAmount.toLocaleString('fr-FR')} FCFA)
- Nombre de Fournisseurs Référencés : ${Object.keys(vendorMap).length}
- Nombre de Bons de Commande Actifs : ${Object.keys(poMap).length}
- Alertes Surfacturation Audit : ${overInvoicedCount}

=== RÉPARTITION PAR DÉPARTEMENT ===
${deptSummary}

=== TOP 10 FOURNISSEURS PAR VOLUME FINANCIER ===
${topVendorsBySpend}

=== BONS DE COMMANDE (BC / PURCHASE ORDERS) ===
${poSummaryLines}

=== GRAND LIVRE DES ${totalInvoices} FACTURES (Colonnes : ID|Facture|Date|Fournisseur|BC|TTC|Payé|Solde|Statut|Échéance|StatutÉchéance|Département|Délai|Audit) ===
${invoicesTable}
`;
}

/**
 * 3. Parser Markdown Exécutif pour le Chatbot
 */
function renderAiMarkdown(text) {
  if (!text) return '';

  let html = text;

  // 1. Échappement anti-XSS des chevrons non formatés
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 2. Extraire et préserver les blocs de code ```code```
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (match, p1) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="ai-msg-codeblock"><code>${p1.trim()}</code></pre>`);
    return `__CODE_BLOCK_${idx}__`;
  });

  // 3. Extraire et préserver le code inline `code`
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, p1) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${p1}</code>`);
    return `__INLINE_CODE_${idx}__`;
  });

  // 4. Parser les tables Markdown (| col1 | col2 |)
  const lines = html.split('\n');
  let inTable = false;
  let tableHeaders = [];
  let tableRows = [];
  const processedLines = [];

  const flushTable = () => {
    if (!inTable) return;
    let cardHtml = '<div class="ai-table-card">';
    cardHtml += '<div class="ai-table-toolbar">';
    cardHtml += '<div class="ai-table-title">';
    cardHtml += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
    cardHtml += '<span>Tableau des Données</span>';
    cardHtml += '</div>';
    cardHtml += '<button type="button" class="ai-table-copy-btn" onclick="copyAiTableToClipboard(this)" title="Copier le tableau pour Excel (toutes colonnes préservées)">';
    cardHtml += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    cardHtml += '<span>Copier pour Excel</span>';
    cardHtml += '</button>';
    cardHtml += '</div>';
    cardHtml += '<div class="table-wrap"><table class="ai-chat-table">';

    if (tableHeaders.length > 0) {
      cardHtml += '<thead><tr>';
      tableHeaders.forEach(th => {
        let cleanTh = th.trim();
        cleanTh = cleanTh.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        cleanTh = cleanTh.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        cardHtml += `<th>${cleanTh}</th>`;
      });
      cardHtml += '</tr></thead>';
    }

    cardHtml += '<tbody>';
    tableRows.forEach(row => {
      cardHtml += '<tr>';
      row.forEach(td => {
        let cleanTd = td.trim();
        cleanTd = cleanTd.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        cleanTd = cleanTd.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        cardHtml += `<td>${cleanTd}</td>`;
      });
      cardHtml += '</tr>';
    });
    cardHtml += '</tbody></table></div></div>';

    processedLines.push(cardHtml);
    inTable = false;
    tableHeaders = [];
    tableRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (/^\|[-:\s|]+\|$/.test(line)) {
        continue;
      }
      const cells = line.split('|').slice(1, -1);
      if (!inTable) {
        inTable = true;
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
    } else {
      if (inTable) {
        flushTable();
      }
      processedLines.push(lines[i]);
    }
  }
  if (inTable) {
    flushTable();
  }

  html = processedLines.join('\n');

  // 5. Séparateurs horizontaux ---, ***, ___
  html = html.replace(/^(?:---|___|\*\*\*)\s*$/gm, '<hr class="ai-msg-hr">');

  // 6. Titres Markdown (# à ######) - élimination stricte des dièses bruts (###)
  html = html.replace(/^######\s*(.+)$/gm, '<h6 class="ai-msg-h6">$1</h6>');
  html = html.replace(/^#####\s*(.+)$/gm, '<h5 class="ai-msg-h5">$1</h5>');
  html = html.replace(/^####\s*(.+)$/gm, '<h4 class="ai-msg-h4">$1</h4>');
  html = html.replace(/^###\s*(.+)$/gm, '<h3 class="ai-msg-h3">$1</h3>');
  html = html.replace(/^##\s*(.+)$/gm, '<h2 class="ai-msg-h2">$1</h2>');
  html = html.replace(/^#\s*(.+)$/gm, '<h1 class="ai-msg-h1">$1</h1>');

  // Sécurité supplémentaire : attraper d'éventuels ### résiduels au début de paragraphes ou lignes
  html = html.replace(/^#{1,6}\s*(.+)$/gm, '<h3 class="ai-msg-h3">$1</h3>');

  // 7. Gras et Italique
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // 8. Citations > citation
  html = html.replace(/^>\s*(.+)$/gm, '<blockquote class="ai-msg-quote">$1</blockquote>');

  // 9. Listes ordonnées et à puces
  html = html.replace(/^\s*[-*•]\s+(.+)$/gm, '<li class="ai-msg-li">$1</li>');
  html = html.replace(/(<li class="ai-msg-li">[\s\S]*?<\/li>(?:\s*<li class="ai-msg-li">[\s\S]*?<\/li>)*)/g, '<ul class="ai-msg-ul">$1</ul>');

  // 10. Nettoyage et structuration des paragraphes
  const rawParagraphs = html.split(/\n{2,}/);
  html = rawParagraphs.map(p => {
    p = p.trim();
    if (!p) return '';
    if (
      p.startsWith('<div class="ai-table-card"') ||
      p.startsWith('<ul') ||
      p.startsWith('<ol') ||
      p.startsWith('<pre') ||
      p.startsWith('<blockquote') ||
      p.startsWith('<h1') ||
      p.startsWith('<h2') ||
      p.startsWith('<h3') ||
      p.startsWith('<h4') ||
      p.startsWith('<h5') ||
      p.startsWith('<h6') ||
      p.startsWith('<hr')
    ) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  // 11. Réinsertion des blocs de code et inline code préservés
  codeBlocks.forEach((cb, idx) => {
    html = html.replace(`__CODE_BLOCK_${idx}__`, cb);
  });
  inlineCodes.forEach((ic, idx) => {
    html = html.replace(`__INLINE_CODE_${idx}__`, ic);
  });

  return html;
}

/**
 * 4. Gestion de la fenêtre de chat & des raccourcis
 */
function toggleAiChatbot(forceState) {
  const win = document.getElementById('aiChatbotWindow');
  const trigger = document.getElementById('aiChatbotTrigger');
  if (!win) return;

  const willOpen = forceState !== undefined ? forceState : !state.ai.isOpen;
  state.ai.isOpen = willOpen;

  if (willOpen) {
    win.classList.add('is-open');
    win.setAttribute('aria-hidden', 'false');
    if (trigger) trigger.style.transform = 'scale(0.95)';
    // Si les discussions ne sont pas encore initialisées
    if (!state.ai.chats || state.ai.chats.length === 0) {
      initAiChats();
    }
    setTimeout(() => {
      const input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }, 200);
  } else {
    win.classList.remove('is-open');
    win.setAttribute('aria-hidden', 'true');
    if (trigger) trigger.style.transform = '';
  }
}

/**
 * Agrandir / Réduire la fenêtre de discussion IA
 */
function toggleAiChatExpand() {
  const win = document.getElementById('aiChatbotWindow');
  if (!win) return;
  state.ai.isExpanded = !state.ai.isExpanded;
  if (state.ai.isExpanded) {
    win.classList.add('is-expanded');
  } else {
    win.classList.remove('is-expanded');
  }
  const expandIcon = document.querySelector('.ai-expand-icon');
  const compressIcon = document.querySelector('.ai-compress-icon');
  if (expandIcon && compressIcon) {
    expandIcon.style.display = state.ai.isExpanded ? 'none' : 'block';
    compressIcon.style.display = state.ai.isExpanded ? 'block' : 'none';
  }
}

// ==========================================================================
// SYSTÈME MULTI-CHATS — SESSIONS, ONGLETS, RENOMMAGE & SUPPRESSION
// ==========================================================================

/**
 * Initialise le système multi-discussions depuis le stockage local ou avec une discussion par défaut
 */
function initAiChats() {
  try {
    const saved = localStorage.getItem('aiforce_ai_chats');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.ai.chats = parsed.map(c => ({
          id: c.id || ('chat_' + Date.now()),
          title: c.title || 'Discussion',
          createdAt: c.createdAt || Date.now(),
          updatedAt: c.updatedAt || Date.now(),
          messages: Array.isArray(c.messages) ? c.messages : []
        }));
      }
    }
  } catch (e) {
    console.warn('Impossible de charger l\'historique des chats depuis localStorage:', e);
  }

  // Création d'une première discussion si aucune n'existe
  if (!state.ai.chats || state.ai.chats.length === 0) {
    const defaultChat = {
      id: 'chat_' + Date.now(),
      title: 'Discussion 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    state.ai.chats = [defaultChat];
  }

  // Restauration de la discussion active
  const savedActiveId = localStorage.getItem('aiforce_ai_active_chat');
  if (savedActiveId && state.ai.chats.some(c => c.id === savedActiveId)) {
    state.ai.activeChatId = savedActiveId;
  } else {
    state.ai.activeChatId = state.ai.chats[0].id;
  }

  // Synchronisation de l'historique actif
  const active = getActiveAiChat();
  state.ai.history = active ? active.messages : [];

  renderAiChatsTabs();
  renderActiveChatMessages();
}

/**
 * Récupère l'objet de discussion actuellement actif
 */
function getActiveAiChat() {
  if (!state.ai.chats || state.ai.chats.length === 0) return null;
  return state.ai.chats.find(c => c.id === state.ai.activeChatId) || state.ai.chats[0];
}

/**
 * Sauvegarde la liste complète des discussions et la discussion active dans localStorage
 */
function saveAiChatsToStorage() {
  try {
    localStorage.setItem('aiforce_ai_chats', JSON.stringify(state.ai.chats));
    if (state.ai.activeChatId) {
      localStorage.setItem('aiforce_ai_active_chat', state.ai.activeChatId);
    }
    const active = getActiveAiChat();
    state.ai.history = active ? active.messages : [];
  } catch (e) {
    console.warn('Erreur lors de la sauvegarde des discussions:', e);
  }
}

/**
 * Crée une nouvelle discussion indépendante
 */
function createNewAiChat(customTitle) {
  let maxNum = 0;
  state.ai.chats.forEach(c => {
    const m = (c.title || '').match(/^Discussion\s+(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const nextNum = maxNum + 1;
  const title = customTitle || `Discussion ${nextNum}`;

  const newChat = {
    id: 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    title: title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };

  state.ai.chats.push(newChat);
  state.ai.activeChatId = newChat.id;
  state.ai.editingChatId = null;

  saveAiChatsToStorage();
  renderAiChatsTabs();
  renderActiveChatMessages();
  toggleAiChatsDrawer(false);

  showToast(`Nouvelle discussion "${newChat.title}" ouverte`, 'success');

  setTimeout(() => {
    const input = document.getElementById('aiChatInput');
    if (input) input.focus();
  }, 100);
}

/**
 * Bascule vers une discussion spécifique
 */
function switchAiChat(chatId) {
  if (state.ai.activeChatId === chatId) return;
  state.ai.activeChatId = chatId;
  state.ai.editingChatId = null;

  saveAiChatsToStorage();
  renderAiChatsTabs();
  renderActiveChatMessages();
  toggleAiChatsDrawer(false);

  setTimeout(() => {
    const input = document.getElementById('aiChatInput');
    if (input) input.focus();
  }, 50);
}

/**
 * Active le mode édition (renommage) sur un onglet de discussion
 */
function startRenameAiChat(chatId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  state.ai.editingChatId = chatId;
  renderAiChatsTabs();

  setTimeout(() => {
    const inp = document.getElementById(`aiRenameInput_${chatId}`);
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 50);
}

/**
 * Enregistre le nouveau nom de la discussion
 */
function saveRenameAiChat(chatId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (state.ai.editingChatId !== chatId) return;

  const inp = document.getElementById(`aiRenameInput_${chatId}`);
  const chat = state.ai.chats.find(c => c.id === chatId);
  if (inp && chat) {
    const val = inp.value.trim();
    if (val && val !== chat.title) {
      chat.title = val;
      chat.updatedAt = Date.now();
      saveAiChatsToStorage();
      showToast(`Discussion renommée en "${val}"`, 'success');
    }
  }

  state.ai.editingChatId = null;
  renderAiChatsTabs();
  renderAiChatsDrawer();
}

/**
 * Annule l'édition du nom de discussion
 */
function cancelRenameAiChat(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  state.ai.editingChatId = null;
  renderAiChatsTabs();
}

/**
 * Gestion des touches clavier lors du renommage
 */
function handleRenameKeydown(chatId, event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveRenameAiChat(chatId, event);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelRenameAiChat(event);
  }
}

/**
 * Supprime une discussion via son icône corbeille
 */
function deleteAiChat(chatId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const chat = state.ai.chats.find(c => c.id === chatId);
  if (!chat) return;

  if (chat.messages && chat.messages.length > 0) {
    const ok = confirm(`Êtes-vous sûr de vouloir supprimer la discussion "${chat.title}" (${chat.messages.length} messages) ?`);
    if (!ok) return;
  }

  const chatIndex = state.ai.chats.findIndex(c => c.id === chatId);
  if (chatIndex !== -1) {
    state.ai.chats.splice(chatIndex, 1);
  }

  // Si toutes les discussions ont été supprimées, on recrée une discussion propre
  if (state.ai.chats.length === 0) {
    const freshChat = {
      id: 'chat_' + Date.now(),
      title: 'Discussion 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    state.ai.chats = [freshChat];
    state.ai.activeChatId = freshChat.id;
  } else if (state.ai.activeChatId === chatId) {
    // Si c'était la discussion active, on active la précédente ou la suivante
    const newIndex = Math.max(0, chatIndex - 1);
    state.ai.activeChatId = state.ai.chats[newIndex].id;
  }

  state.ai.editingChatId = null;
  saveAiChatsToStorage();
  renderAiChatsTabs();
  renderActiveChatMessages();
  renderAiChatsDrawer();

  showToast(`Discussion "${chat.title}" supprimée`, 'info');
}

/**
 * Affiche ou masque le tiroir récapitulatif de toutes les discussions
 */
function toggleAiChatsDrawer(forceState) {
  const drawer = document.getElementById('aiChatsDrawer');
  if (!drawer) return;

  const willOpen = forceState !== undefined ? forceState : drawer.style.display === 'none';
  drawer.style.display = willOpen ? 'flex' : 'none';

  if (willOpen) {
    renderAiChatsDrawer();
  }
}

/**
 * Rendu visuel du tiroir des discussions
 */
function renderAiChatsDrawer() {
  const list = document.getElementById('aiDrawerList');
  if (!list) return;

  const countEl = document.getElementById('aiDrawerCount');
  if (countEl) countEl.textContent = state.ai.chats.length;

  list.innerHTML = state.ai.chats.map(chat => {
    const isActive = chat.id === state.ai.activeChatId;
    const msgCount = chat.messages.length;
    const dateStr = chat.updatedAt ? new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    return `
      <div class="ai-drawer-item ${isActive ? 'active' : ''}" onclick="switchAiChat('${chat.id}')">
        <div class="ai-drawer-item-left">
          <span class="ai-drawer-item-pip"></span>
          <div class="ai-drawer-item-info">
            <span class="ai-drawer-item-title">${escapeHtml(chat.title)}</span>
            <span class="ai-drawer-item-meta">${msgCount} message${msgCount > 1 ? 's' : ''} • ${dateStr ? 'Dernière act. ' + dateStr : 'Nouveau'}</span>
          </div>
        </div>
        <div class="ai-drawer-item-actions" onclick="event.stopPropagation()">
          <button type="button" class="ai-drawer-action-btn btn-rename" onclick="startRenameAiChat('${chat.id}', event)" title="Modifier le nom">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button type="button" class="ai-drawer-action-btn btn-delete" onclick="deleteAiChat('${chat.id}', event)" title="Supprimer cette discussion">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Rendu visuel de la barre horizontale des onglets de discussion
 */
function renderAiChatsTabs() {
  const container = document.getElementById('aiChatTabsScroll');
  if (!container) return;

  const activeChat = getActiveAiChat();
  if (!activeChat) return;

  // Compteur d'onglets
  const countBadge = document.getElementById('aiChatsCountBadge');
  if (countBadge) {
    countBadge.textContent = state.ai.chats.length;
  }
  const drawerCount = document.getElementById('aiDrawerCount');
  if (drawerCount) {
    drawerCount.textContent = state.ai.chats.length;
  }

  container.innerHTML = state.ai.chats.map(chat => {
    const isActive = chat.id === state.ai.activeChatId;
    const isEditing = state.ai.editingChatId === chat.id;

    if (isEditing) {
      return `
        <div class="ai-chat-tab active editing" id="aiTab_${chat.id}">
          <form class="ai-tab-rename-form" onsubmit="saveRenameAiChat('${chat.id}', event)" onclick="event.stopPropagation()">
            <input type="text" 
                   class="ai-tab-rename-input" 
                   id="aiRenameInput_${chat.id}" 
                   value="${escapeHtml(chat.title)}" 
                   maxlength="30" 
                   autocomplete="off" 
                   onkeydown="handleRenameKeydown('${chat.id}', event)" 
                   onblur="saveRenameAiChat('${chat.id}', event)">
            <button type="submit" class="ai-tab-btn btn-save" title="Enregistrer le nom" onmousedown="event.preventDefault()">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </button>
            <button type="button" class="ai-tab-btn btn-cancel" onclick="cancelRenameAiChat(event)" title="Annuler" onmousedown="event.preventDefault()">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </form>
        </div>
      `;
    }

    return `
      <div class="ai-chat-tab ${isActive ? 'active' : ''}" 
           id="aiTab_${chat.id}" 
           onclick="switchAiChat('${chat.id}')" 
           title="${escapeHtml(chat.title)}${chat.messages.length > 0 ? ' (' + chat.messages.length + ' messages)' : ''}">
        <div class="ai-tab-main">
          <svg class="ai-tab-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="ai-tab-title">${escapeHtml(chat.title)}</span>
        </div>
        <div class="ai-tab-actions" onclick="event.stopPropagation()">
          <button type="button" 
                  class="ai-tab-btn btn-rename" 
                  onclick="startRenameAiChat('${chat.id}', event)" 
                  title="Modifier le nom de cette discussion">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button type="button" 
                  class="ai-tab-btn btn-delete" 
                  onclick="deleteAiChat('${chat.id}', event)" 
                  title="Supprimer cette discussion">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Défilement automatique pour garder l'onglet actif visible
  const activeEl = container.querySelector('.ai-chat-tab.active');
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

/**
 * Affiche tous les messages de la discussion actuellement active
 */
function renderActiveChatMessages() {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;

  const activeChat = getActiveAiChat();
  container.innerHTML = '';

  if (!activeChat || activeChat.messages.length === 0) {
    container.innerHTML = `
      <div class="ai-message ai-message-assistant">
        <div class="ai-message-avatar">
          <img src="assets/ai-logo.png" alt="Logo IA" class="ai-msg-avatar-img">
        </div>
        <div class="ai-message-content">
          <div class="ai-message-header">
            <div class="ai-msg-author-info">
              <span class="ai-msg-name">AI Data Analyst</span>
              <span class="ai-msg-time">Assistant Exécutif</span>
            </div>
          </div>
          <div class="ai-msg-rendered-body">
            <p>Bonjour ! Je suis votre <strong>AI Data Analyst</strong>.</p>
            <p>Comment puis-je vous aider aujourd'hui dans l'analyse de vos approvisionnements et finances ?</p>
          </div>
        </div>
      </div>
    `;
  } else {
    activeChat.messages.forEach(msg => {
      appendAiMessage(msg.role, msg.content, msg.timestamp);
    });
  }

  container.scrollTop = container.scrollHeight;
}

/**
 * Réinitialise l'historique de la discussion active
 */
function clearAiChat() {
  const activeChat = getActiveAiChat();
  if (!activeChat) return;

  activeChat.messages = [];
  activeChat.updatedAt = Date.now();
  saveAiChatsToStorage();

  renderActiveChatMessages();
  renderAiChatsTabs();
  renderAiChatsDrawer();

  showToast(`Historique de "${activeChat.title}" réinitialisé`, 'info');
}

function handleAiPromptClick(buttonEl) {
  if (!buttonEl) return;
  const promptText = buttonEl.textContent.replace(/^[^\w\sÀ-ÿ]+/, '').trim();
  const input = document.getElementById('aiChatInput');
  if (input) {
    input.value = promptText;
    input.focus();
  }
  handleAiChatSubmit();
}

function handleAiInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAiChatSubmit();
  }
}

function appendAiMessage(role, rawContent, timestamp) {
  const container = document.getElementById('aiChatMessages');
  if (!container) return null;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ai-message ai-message-${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'ai-message-avatar';
  if (role === 'assistant') {
    avatar.innerHTML = `<img src="assets/ai-logo.png" alt="Logo IA" class="ai-msg-avatar-img">`;
  } else {
    avatar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'ai-message-content';

  const timeFormatted = timestamp 
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (role === 'assistant') {
    // 1. En-tête de message IA avec bouton de copie directe supérieure
    const headerDiv = document.createElement('div');
    headerDiv.className = 'ai-message-header';
    headerDiv.innerHTML = `
      <div class="ai-msg-author-info">
        <span class="ai-msg-name">AI Data Analyst</span>
        <span class="ai-msg-time">${timeFormatted}</span>
      </div>
      <button type="button" class="ai-msg-top-copy-btn" title="Copier l'intégralité de cette analyse">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        <span>Copier la réponse</span>
      </button>
    `;
    const topCopyBtn = headerDiv.querySelector('.ai-msg-top-copy-btn');
    if (topCopyBtn) {
      topCopyBtn.onclick = () => copyAiTextToClipboard(rawContent, topCopyBtn, msgDiv);
    }
    contentDiv.appendChild(headerDiv);

    // 2. Corps du message rendu en Markdown
    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'ai-msg-rendered-body';
    bodyDiv.innerHTML = renderAiMarkdown(rawContent);
    contentDiv.appendChild(bodyDiv);

    // 3. Barre d'actions sous la réponse de l'analyste
    const footerDiv = document.createElement('div');
    footerDiv.className = 'ai-message-footer';

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'ai-msg-actions';

    // Bouton de copie complète
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ai-action-btn ai-action-btn-copy';
    copyBtn.title = 'Copier toute l\'analyse dans le presse-papier';
    copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span>Copier toute la réponse</span>
    `;
    copyBtn.onclick = () => copyAiTextToClipboard(rawContent, copyBtn, msgDiv);

    // Bouton d'expédition par email
    const emailBtn = document.createElement('button');
    emailBtn.type = 'button';
    emailBtn.className = 'ai-action-btn';
    emailBtn.title = 'Expédier ce rapport d\'analyse par email';
    emailBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
      <span>Envoyer par mail</span>
    `;
    emailBtn.onclick = () => promptSendAnalysisEmail(rawContent, msgDiv);

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(emailBtn);
    footerDiv.appendChild(actionsDiv);

    contentDiv.appendChild(footerDiv);
  } else {
    contentDiv.innerHTML = `<p>${escapeHtml(rawContent).replace(/\n/g, '<br>')}</p>`;
  }

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(contentDiv);
  container.appendChild(msgDiv);

  container.scrollTop = container.scrollHeight;
  return msgDiv;
}

/**
 * 5. Soumission et Appel Sécurisé à l'IA Qwen avec Détection d'Envoi d'Email
 */
async function handleAiChatSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (state.ai.isThinking) return;

  const input = document.getElementById('aiChatInput');
  if (!input) return;
  const userText = input.value.trim();
  if (!userText) return;

  const activeChat = getActiveAiChat();
  if (!activeChat) return;
  const currentChatId = activeChat.id;

  // Affichage du message utilisateur dans l'interface
  appendAiMessage('user', userText);
  input.value = '';
  input.style.height = 'auto';

  // Enregistrement immédiat dans la discussion courante
  activeChat.messages.push({ role: 'user', content: userText, timestamp: Date.now() });
  activeChat.updatedAt = Date.now();
  saveAiChatsToStorage();
  renderAiChatsTabs();

  // Préparation du statut thinking
  state.ai.isThinking = true;
  const sendBtn = document.getElementById('aiSendBtn');
  const indicator = document.getElementById('aiTypingIndicator');
  if (sendBtn) sendBtn.disabled = true;
  if (indicator) indicator.style.display = 'flex';

  // Activation des animations de rotation et pulsation sur les logos IA
  document.getElementById('aiChatbotWindow')?.classList.add('is-thinking');
  document.getElementById('headerAiBtn')?.classList.add('is-thinking');
  document.getElementById('aiChatbotTrigger')?.classList.add('is-thinking');

  const container = document.getElementById('aiChatMessages');
  if (container) container.scrollTop = container.scrollHeight;

  // Construction du Contexte et du Prompt Système avec Garde-Fou Strict
  const enterpriseContext = buildEnterpriseAiContext();

  const systemPrompt = `Tu es l'AI Data Analyst officiel et exclusif de la plateforme d'Approvisionnements et Comptabilité Fournisseurs de l'entreprise (AIFORCE AGENCY V2).
Tu t'exprimes avec l'autorité d'un expert financier, une grande clarté exécutive et une précision mathématique rigoureuse.

=== RÈGLE CARDINALE DE PÉRIMÈTRE & REFUS STRICT ===
Ton champ d'intervention est STRICTEMENT et EXCLUSIVEMENT limité aux données de l'entreprise fournies dans ce contexte (achats, factures, bons de commande, comptabilité fournisseurs, approbations, centres de coûts, règlements, audits et indicateurs de performance SLA).
Si l'utilisateur te pose une question portant sur un sujet externe (par exemple de la politique, des personnalités comme Donald Trump, de l'actualité mondiale, du divertissement, de la programmation générale, de la culture générale, etc.), tu DOIS STRICTEMENT REFUSER de répondre en formulant poliment mais fermement la réponse suivante :
"Je ne réponds pas à de telles questions. En tant qu'AI Data Analyst de la plateforme d'Approvisionnements & Comptabilité Fournisseurs, mon rôle est strictement limité à l'analyse des données financières, des bons de commande, des factures et des audits de l'entreprise. Comment puis-je vous aider sur vos données d'achats ?"
Ne déroge jamais à cette consigne, sous aucun prétexte.

=== CAPACITÉ D'EXPÉDITION D'ANALYSES ET DE RAPPORTS PAR EMAIL ===
Tu disposes d'un outil officiel et automatisé d'expédition de courriels d'audit relié à la passerelle Gmail SMTP de l'entreprise (expéditeur certifié : calebwils900@gmail.com).
Si l'utilisateur te demande d'envoyer, de transmettre ou d'expédier son analyse, un rapport, une synthèse ou un audit par email/mail (par exemple : "envoie-moi ça par mail", "envoie le rapport d'audit à procure.test.ai@gmail.com", "transmets cette analyse par courriel") :
1. Rédige ton analyse exécutive complète, détaillée, chiffrée et rigoureuse comme d'habitude.
2. Identifie l'adresse de réception : utilise l'adresse explicitement mentionnée par l'utilisateur, ou à défaut l'adresse officielle de test "procure.test.ai@gmail.com".
3. À la toute fin de ta réponse, insère la balise d'action d'expédition suivante sur sa propre ligne :
[ACTION_SEND_EMAIL: {"to": "procure.test.ai@gmail.com", "subject": "📊 [AIFORCE AGENCY] Rapport Exécutif d'Analyse Financière", "title": "Rapport d'Analyse Financière"}]
Le système frontal prendra immédiatement en charge l'expédition automatique du courriel complet vers cette adresse.

=== DIRECTIVES D'ANALYSE & DE CALCUL ===
1. Exactitude Mathématique : Effectue les calculs avec rigueur (sommes, moyennes, pourcentages, écarts budgétaires, délais). Base-toi strictement sur les données ci-dessous.
2. Traçabilité Complète : Mentionne toujours les références exactes (ex: N° de Facture FAC-2026-..., N° de BC PO-2026-..., Fournisseur, Centre de coût).
3. Structuration Exécutive : Utilise le format Markdown avec des puces soignées, des montants en gras avec séparateur de milliers et devise FCFA, et des tableaux Markdown complets lorsque pertinent.
4. Langue : Réponds directement dans la langue employée par l'utilisateur (français ou anglais selon la question posée), avec un style exécutif, direct, précis et professionnel.

=== DONNÉES EN TEMPS RÉEL DU SYSTÈME D'INFORMATION ===
${enterpriseContext}`;

  // Messages pour l'API
  const apiMessages = [
    { role: 'system', content: systemPrompt }
  ];

  // Historique récent propre à cette discussion spécifique (derniers 6 tours sans doubler le dernier message)
  const recentHistory = activeChat.messages.slice(0, -1).slice(-6);
  recentHistory.forEach(h => {
    apiMessages.push({ role: h.role, content: h.content });
  });

  apiMessages.push({ role: 'user', content: userText });

  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (state.ai.apiKey) {
      headers['x-api-key'] = state.ai.apiKey;
    }
    if (state.ai.baseUrl) {
      headers['x-base-url'] = state.ai.baseUrl;
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: state.ai.model || 'qwen-flash',
        messages: apiMessages,
        temperature: 0.2
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error === 'MISSING_API_KEY') {
        appendAiMessage('assistant', `⚠️ **Clé API Qwen requise**\n\nAucune clé API n'est configurée pour le moment.\n\n👉 **Action requise :**\n1. Cliquez sur l'icône ⚙️ **Paramètres** en haut à droite de ce chat pour renseigner votre clé,\n2. Ou inscrivez votre clé dans le fichier local \`.env\` sur votre machine (\`QWEN_API_KEY=sk-...\`).\n\n*Conformément à vos consignes de sécurité, votre clé reste 100% protégée et ne sera jamais envoyée sur GitHub.*`);
        openAiSettingsModal();
      } else {
        const errMsg = data.details?.message || data.message || 'Erreur de communication avec le serveur IA.';
        appendAiMessage('assistant', `❌ **Erreur d'analyse IA** : ${errMsg}\n\nVeuillez vérifier la configuration dans les paramètres.`);
      }
      return;
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "Désolé, aucune réponse générée.";

    // Détection de l'action d'envoi d'email
    let cleanReply = reply;
    let emailAction = null;
    const emailMatch = reply.match(/\[ACTION_SEND_EMAIL:\s*(\{.*?\})\s*\]/s);

    if (emailMatch) {
      try {
        emailAction = JSON.parse(emailMatch[1]);
        cleanReply = reply.replace(emailMatch[0], '').trim();
      } catch (e) {
        console.warn('Erreur lors du décodage de ACTION_SEND_EMAIL:', e);
      }
    }

    // Détection de secours : si l'utilisateur demandait explicitement un email et que l'IA a oublié le tag
    if (!emailAction && (/\b(mail|email|courriel)\b/i.test(userText) && /\b(envoi|envoyer|transmets|transmettre|envoie)\b/i.test(userText))) {
      const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
      const foundEmail = userText.match(emailRegex);
      emailAction = {
        to: foundEmail ? foundEmail[1] : 'procure.test.ai@gmail.com',
        subject: "📊 [AIFORCE AGENCY] Rapport Exécutif d'Analyse Financière",
        title: "Rapport d'Analyse Exécutive"
      };
    }

    // Enregistrement dans la discussion qui a initié la requête
    const targetChat = state.ai.chats.find(c => c.id === currentChatId);
    if (targetChat) {
      targetChat.messages.push({ role: 'assistant', content: cleanReply, timestamp: Date.now() });
      targetChat.updatedAt = Date.now();
      saveAiChatsToStorage();
      renderAiChatsTabs();
    }

    // Affichage dans l'UI si l'utilisateur est toujours sur cette même discussion
    if (state.ai.activeChatId === currentChatId) {
      const msgElement = appendAiMessage('assistant', cleanReply);

      // Déclenchement automatique de l'envoi d'email si demandé
      if (emailAction && msgElement) {
        executeAiEmailSend(emailAction, cleanReply, msgElement);
      }
    } else {
      showToast(`Nouvelle analyse prête dans "${targetChat?.title || 'votre discussion'}"`, 'info');
    }

  } catch (err) {
    console.error('Erreur chat AI:', err);
    appendAiMessage('assistant', `❌ **Erreur de connexion** : Impossible de contacter la passerelle IA locale (\`${err.message}\`). Vérifiez que le serveur local est bien démarré sur le port 8080.`);
  } finally {
    state.ai.isThinking = false;
    if (sendBtn) sendBtn.disabled = false;
    if (indicator) indicator.style.display = 'none';

    // Désactivation des animations de rotation
    document.getElementById('aiChatbotWindow')?.classList.remove('is-thinking');
    document.getElementById('headerAiBtn')?.classList.remove('is-thinking');
    document.getElementById('aiChatbotTrigger')?.classList.remove('is-thinking');
  }
}

/**
 * 5.1 Fonctions d'Expédition d'Email et Utilitaires
 */
async function executeAiEmailSend(actionData, analysisText, msgElement) {
  const recipient = (actionData.to || '').trim() || localStorage.getItem('aiforce_recipient_email') || 'procure.test.ai@gmail.com';
  const subject = actionData.subject || "📊 [AIFORCE AGENCY] Rapport d'Audit & Analyse Financière";
  const title = actionData.title || "Rapport d'Analyse Financière";

  const footer = msgElement?.querySelector('.ai-message-footer');
  let statusPill = null;
  if (footer) {
    statusPill = document.createElement('div');
    statusPill.className = 'ai-email-status-pill sending';
    statusPill.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ai-spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
      <span>Expédition email en cours vers ${escapeHtml(recipient)}...</span>
    `;
    footer.appendChild(statusPill);
  }

  showToast(`Expédition du rapport d'analyse vers ${recipient}...`, 'info');

  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipient,
        subject: subject,
        title: title,
        textContent: analysisText,
        htmlContent: renderAiMarkdown(analysisText)
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (statusPill) {
        statusPill.className = 'ai-email-status-pill success';
        statusPill.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Expédié avec succès par email à <strong>${escapeHtml(data.recipient)}</strong></span>
        `;
      }
      showToast(`✉️ Rapport d'analyse transmis avec succès à ${data.recipient} !`, 'success');
    } else {
      throw new Error(data.message || 'Erreur lors de l\'envoi');
    }
  } catch (err) {
    console.error('Échec expédition email:', err);
    if (statusPill) {
      statusPill.className = 'ai-email-status-pill error';
      statusPill.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
        <span>Échec expédition email (${escapeHtml(err.message)})</span>
      `;
    }
    showToast(`Erreur d'envoi par email : ${err.message}`, 'error');
  }
}

async function promptSendAnalysisEmail(analysisText, msgElement) {
  const currentDefault = localStorage.getItem('aiforce_recipient_email') || 'procure.test.ai@gmail.com';
  const recipient = prompt("À quelle adresse email souhaitez-vous expédier cette analyse ?", currentDefault);
  if (!recipient || !recipient.trim()) return;

  const cleanRecipient = recipient.trim();
  localStorage.setItem('aiforce_recipient_email', cleanRecipient);

  await executeAiEmailSend({
    to: cleanRecipient,
    subject: "📊 [AIFORCE AGENCY] Analyse Exécutive des Approvisionnements",
    title: "Analyse Approvisionnements & Comptabilité Fournisseurs"
  }, analysisText, msgElement);
}

/**
 * Copie un tableau Markdown/HTML au format TSV & HTML pour Excel / Google Sheets
 * Garantit l'intégralité et l'alignement parfait de toutes les colonnes
 */
async function copyAiTableToClipboard(btnEl) {
  if (!btnEl) return;
  const tableCard = btnEl.closest('.ai-table-card');
  if (!tableCard) return;
  const table = tableCard.querySelector('table');
  if (!table) return;

  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return;

  // 1. Génération TSV (Tab-Separated Values) : standard universel de collage multi-colonnes Excel
  const tsvLines = [];
  rows.forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('th, td')).map(cell => {
      let text = cell.innerText || cell.textContent || '';
      text = text.replace(/[\r\n]+/g, ' ').trim();
      if (text.includes('\t') || text.includes('"')) {
        text = `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    tsvLines.push(cells.join('\t'));
  });
  const tsvContent = tsvLines.join('\r\n');

  // 2. Génération HTML table pour Excel desktop/web & Google Sheets
  const htmlContent = `
    <meta charset="utf-8">
    <table border="1" style="border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11pt;">
      ${table.innerHTML}
    </table>
  `;

  let copied = false;
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const textBlob = new Blob([tsvContent], { type: 'text/plain' });
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob
        })
      ]);
      copied = true;
    } catch (err) {
      console.warn('ClipboardItem write failed, fallback:', err);
    }
  }

  if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(tsvContent);
      copied = true;
    } catch (err) {
      console.warn('writeText failed:', err);
    }
  }

  if (!copied) {
    const ta = document.createElement('textarea');
    ta.value = tsvContent;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copied = true;
  }

  showToast('Tableau copié au format Excel (toutes colonnes préservées) !', 'success');

  const origHtml = btnEl.innerHTML;
  btnEl.classList.add('is-copied');
  btnEl.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <span style="color:#10b981; font-weight:700;">Copié pour Excel ✓</span>
  `;
  setTimeout(() => {
    btnEl.classList.remove('is-copied');
    btnEl.innerHTML = origHtml;
  }, 2200);
}

/**
 * Copie intégrale de la réponse de l'IA (en un seul clic)
 */
async function copyAiTextToClipboard(text, btnEl, msgElement) {
  let plainText = text || '';
  plainText = plainText.replace(/\[ACTION_SEND_EMAIL:\s*\{.*?\}\s*\]/gs, '').trim();

  // Extraction d'un HTML propre si l'élément de message est fourni
  let cleanHtml = '';
  if (msgElement) {
    const content = msgElement.querySelector('.ai-message-content');
    if (content) {
      const clone = content.cloneNode(true);
      clone.querySelectorAll('.ai-message-header, .ai-message-footer, .ai-table-toolbar, .ai-email-status-pill').forEach(el => el.remove());
      cleanHtml = clone.innerHTML;
    }
  }

  let copied = false;
  if (navigator.clipboard && window.ClipboardItem && cleanHtml) {
    try {
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      const htmlBlob = new Blob([cleanHtml], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob
        })
      ]);
      copied = true;
    } catch (e) {
      console.warn('ClipboardItem error, fallback:', e);
    }
  }

  if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(plainText);
      copied = true;
    } catch (e) {
      console.warn('writeText error:', e);
    }
  }

  if (!copied) {
    const ta = document.createElement('textarea');
    ta.value = plainText;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copied = true;
  }

  showToast('Réponse complète de l\'IA copiée dans le presse-papier !', 'success');

  const updateBtn = (btn) => {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span style="color:#10b981; font-weight:700;">Copié ✓</span>
    `;
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  };

  if (msgElement) {
    msgElement.querySelectorAll('.ai-msg-top-copy-btn, .ai-action-btn-copy').forEach(updateBtn);
  } else if (btnEl) {
    updateBtn(btnEl);
  }
}

/**
 * Initialisation de la fenêtre de discussion extensible & redimensionnable
 */
function initAiChatResizable() {
  const win = document.getElementById('aiChatbotWindow');
  const leftHandle = document.getElementById('aiResizeHandleLeft');
  const topHandle = document.getElementById('aiResizeHandleTop');
  const cornerHandle = document.getElementById('aiResizeHandleCorner');
  if (!win) return;

  // Restaurer les dimensions personnalisées si sauvegardées
  const savedWidth = localStorage.getItem('aiforce_ai_chat_width');
  const savedHeight = localStorage.getItem('aiforce_ai_chat_height');
  if (savedWidth && window.innerWidth > 640) {
    win.style.width = savedWidth;
  }
  if (savedHeight && window.innerWidth > 640) {
    win.style.height = savedHeight;
  }

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let resizeMode = ''; // 'left', 'top', 'corner'

  const startResize = (e, mode) => {
    if (window.innerWidth <= 640) return;
    if (e.button !== undefined && e.button !== 0) return; // Uniquement clic gauche
    e.preventDefault();
    isResizing = true;
    resizeMode = mode;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;

    const rect = win.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;

    win.classList.remove('is-expanded');
    win.classList.add('is-resizing');
    document.body.classList.add('ai-is-resizing');

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', stopResize);
  };

  const onMove = (e) => {
    if (!isResizing) return;
    if (e.preventDefault) e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    if (resizeMode === 'left' || resizeMode === 'corner') {
      const deltaX = startX - clientX;
      const minW = 380;
      const maxW = Math.min(1100, window.innerWidth - 32);
      const newWidth = Math.max(minW, Math.min(maxW, startWidth + deltaX));
      win.style.width = `${newWidth}px`;
    }

    if (resizeMode === 'top' || resizeMode === 'corner') {
      const deltaY = startY - clientY;
      const minH = 420;
      const maxH = window.innerHeight - 95;
      const newHeight = Math.max(minH, Math.min(maxH, startHeight + deltaY));
      win.style.height = `${newHeight}px`;
    }
  };

  const stopResize = () => {
    if (!isResizing) return;
    isResizing = false;
    win.classList.remove('is-resizing');
    document.body.classList.remove('ai-is-resizing');

    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopResize);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', stopResize);

    if (win.style.width) localStorage.setItem('aiforce_ai_chat_width', win.style.width);
    if (win.style.height) localStorage.setItem('aiforce_ai_chat_height', win.style.height);
  };

  if (leftHandle) {
    leftHandle.addEventListener('mousedown', (e) => startResize(e, 'left'));
    leftHandle.addEventListener('touchstart', (e) => startResize(e, 'left'), { passive: false });
    // Double-clic pour basculer facilement entre 460px et 850px
    leftHandle.addEventListener('dblclick', () => {
      const currentW = win.getBoundingClientRect().width;
      if (currentW > 600) {
        win.style.width = '460px';
        localStorage.setItem('aiforce_ai_chat_width', '460px');
      } else {
        const targetW = `${Math.min(850, window.innerWidth - 32)}px`;
        win.style.width = targetW;
        localStorage.setItem('aiforce_ai_chat_width', targetW);
      }
    });
  }

  if (topHandle) {
    topHandle.addEventListener('mousedown', (e) => startResize(e, 'top'));
    topHandle.addEventListener('touchstart', (e) => startResize(e, 'top'), { passive: false });
  }

  if (cornerHandle) {
    cornerHandle.addEventListener('mousedown', (e) => startResize(e, 'corner'));
    cornerHandle.addEventListener('touchstart', (e) => startResize(e, 'corner'), { passive: false });
  }
}

/**
 * Bouton d'agrandissement / réduction de la fenêtre de chat
 */
function toggleAiChatExpand() {
  const win = document.getElementById('aiChatbotWindow');
  const btn = document.getElementById('aiExpandBtn');
  if (!win) return;

  const isExpanded = win.classList.contains('is-expanded');
  const expandIcon = btn?.querySelector('.ai-expand-icon');
  const compressIcon = btn?.querySelector('.ai-compress-icon');

  if (isExpanded) {
    win.classList.remove('is-expanded');
    if (expandIcon) expandIcon.style.display = 'block';
    if (compressIcon) compressIcon.style.display = 'none';
    if (btn) btn.title = 'Agrandir la fenêtre de discussion';
    const savedW = localStorage.getItem('aiforce_ai_chat_width') || '460px';
    const savedH = localStorage.getItem('aiforce_ai_chat_height') || '640px';
    win.style.width = savedW;
    win.style.height = savedH;
  } else {
    if (win.style.width) localStorage.setItem('aiforce_ai_chat_width', win.style.width);
    if (win.style.height) localStorage.setItem('aiforce_ai_chat_height', win.style.height);

    win.classList.add('is-expanded');
    if (expandIcon) expandIcon.style.display = 'none';
    if (compressIcon) compressIcon.style.display = 'block';
    if (btn) btn.title = 'Réduire la fenêtre de discussion';
  }
}

async function testAiEmailSend() {
  const input = document.getElementById('aiSettingsRecipientEmail');
  const recipient = (input ? input.value.trim() : '') || 'procure.test.ai@gmail.com';

  showToast(`Expédition d'un rapport de test à ${recipient}...`, 'info');

  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipient,
        subject: "📊 [AIFORCE AGENCY] Test de Connectivité Email — AI Data Analyst",
        title: "Test de Connectivité Réussie",
        textContent: "Félicitations ! La passerelle Gmail SMTP de votre AI Data Analyst est 100% opérationnelle.\n\nVous pouvez désormais demander à l'IA d'expédier directement ses rapports d'audit et analyses par email."
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✅ Email de test envoyé avec succès à ${data.recipient} !`, 'success');
    } else {
      showToast(`❌ Échec d'envoi : ${data.message || 'Erreur inconnue'}`, 'error');
    }
  } catch (err) {
    showToast(`❌ Erreur réseau : ${err.message}`, 'error');
  }
}

/**
 * 6. Modale de Paramètres & Sécurité
 */
function openAiSettingsModal() {
  const modal = document.getElementById('aiSettingsModal');
  const inputKey = document.getElementById('aiSettingsApiKey');
  const inputUrl = document.getElementById('aiSettingsBaseUrl');
  const selectModel = document.getElementById('aiSettingsModel');

  if (inputKey) inputKey.value = state.ai.apiKey || '';
  if (inputUrl) inputUrl.value = state.ai.baseUrl || 'https://ws-hrpprn3nx2citb4c.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
  if (selectModel) selectModel.value = state.ai.model || 'qwen-flash';

  const inputEmail = document.getElementById('aiSettingsRecipientEmail');
  if (inputEmail) inputEmail.value = localStorage.getItem('aiforce_recipient_email') || 'procure.test.ai@gmail.com';

  checkAiServerStatus();

  if (modal) modal.classList.add('active');
}

function closeAiSettingsModal(e) {
  if (e && e.target && e.target.id !== 'aiSettingsModal') return;
  const modal = document.getElementById('aiSettingsModal');
  if (modal) modal.classList.remove('active');
}

function toggleApiKeyVisibility() {
  const inputKey = document.getElementById('aiSettingsApiKey');
  if (!inputKey) return;
  inputKey.type = inputKey.type === 'password' ? 'text' : 'password';
}

function saveAiSettings() {
  const inputKey = document.getElementById('aiSettingsApiKey');
  const inputUrl = document.getElementById('aiSettingsBaseUrl');
  const selectModel = document.getElementById('aiSettingsModel');
  const inputEmail = document.getElementById('aiSettingsRecipientEmail');

  if (inputKey) {
    const val = inputKey.value.trim();
    state.ai.apiKey = val;
    if (val) {
      localStorage.setItem('aiforce_ai_key', val);
    } else {
      localStorage.removeItem('aiforce_ai_key');
    }
  }

  if (inputUrl) {
    const val = inputUrl.value.trim();
    state.ai.baseUrl = val || 'https://ws-hrpprn3nx2citb4c.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
    localStorage.setItem('aiforce_ai_base_url', state.ai.baseUrl);
  }

  if (selectModel) {
    state.ai.model = selectModel.value;
    localStorage.setItem('aiforce_ai_model', state.ai.model);
  }

  if (inputEmail && inputEmail.value.trim()) {
    localStorage.setItem('aiforce_recipient_email', inputEmail.value.trim());
  }

  updateAiStatusBadges();
  showToast('Paramètres de l\'AI Data Analyst enregistrés avec succès', 'success');
  closeAiSettingsModal();
}

async function testAiConnection() {
  showToast('Test de communication avec l\'API Qwen en cours...', 'info');

  const headers = { 'Content-Type': 'application/json' };
  const inputKey = document.getElementById('aiSettingsApiKey');
  const inputUrl = document.getElementById('aiSettingsBaseUrl');
  const selectModel = document.getElementById('aiSettingsModel');

  const testKey = inputKey ? inputKey.value.trim() : state.ai.apiKey;
  const testUrl = inputUrl ? inputUrl.value.trim() : state.ai.baseUrl;
  const testModel = selectModel ? selectModel.value : state.ai.model;

  if (testKey) headers['x-api-key'] = testKey;
  if (testUrl) headers['x-base-url'] = testUrl;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'Réponds par: "OK: Connexion Qwen Opérationnelle"' }],
        max_tokens: 20
      })
    });

    const data = await res.json();
    if (res.ok) {
      const reply = data.choices?.[0]?.message?.content || 'Connexion validée !';
      showToast(`Succès : ${reply}`, 'success');
    } else {
      const err = data.details?.message || data.message || 'Erreur d\'authentification';
      showToast(`Échec du test : ${err}`, 'error');
    }
  } catch (err) {
    showToast(`Erreur réseau : ${err.message}`, 'error');
  }
}

// Exportation globale pour les gestionnaires d'événements HTML
window.toggleAiChatbot = toggleAiChatbot;
window.toggleAiChatExpand = toggleAiChatExpand;
window.copyAiTableToClipboard = copyAiTableToClipboard;
window.copyAiTextToClipboard = copyAiTextToClipboard;
window.initAiChatResizable = initAiChatResizable;
window.openAiSettingsModal = openAiSettingsModal;
window.closeAiSettingsModal = closeAiSettingsModal;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.saveAiSettings = saveAiSettings;
window.testAiConnection = testAiConnection;
window.clearAiChat = clearAiChat;
window.handleAiPromptClick = handleAiPromptClick;
window.handleAiChatSubmit = handleAiChatSubmit;
window.handleAiInputKeydown = handleAiInputKeydown;
window.initAiChats = initAiChats;
window.createNewAiChat = createNewAiChat;
window.switchAiChat = switchAiChat;
window.startRenameAiChat = startRenameAiChat;
window.saveRenameAiChat = saveRenameAiChat;
window.cancelRenameAiChat = cancelRenameAiChat;
window.handleRenameKeydown = handleRenameKeydown;
window.deleteAiChat = deleteAiChat;
window.toggleAiChatsDrawer = toggleAiChatsDrawer;
window.renderAiChatsDrawer = renderAiChatsDrawer;
window.renderAiChatsTabs = renderAiChatsTabs;
window.renderActiveChatMessages = renderActiveChatMessages;

// ==========================================================================
// INITIALISATION AU CHARGEMENT DE LA PAGE
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(state.theme);
  
  // 1. Chargement immédiat des données
  loadGoogleSheetData(false);

  // 2. Lancement de la boucle de synchronisation temps réel
  startAutoSyncLoop();

  // 3. Initialisation du statut IA et sécurité Qwen
  checkAiServerStatus();

  // 4. Initialisation du système multi-chats & onglets de discussion
  initAiChats();

  // 5. Initialisation du redimensionnement interactif du chat
  initAiChatResizable();

  // Écoute de la touche Échap pour fermer les modales et le chat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeDiagnosticModal();
      closeAiSettingsModal();
      toggleAiChatsDrawer(false);
      if (state.ai.isOpen) {
        toggleAiChatbot(false);
      }
    }
  });
});

