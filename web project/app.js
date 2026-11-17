(() => {
  const STORAGE_KEY = "sppg_suhu_monitoring_v1";

  const ROOM_FORMS = [
    {
      id: "gudang-kering",
      title: "Pemantauan Suhu Ruangan Bahan Makanan Kering",
      room: "Gudang Kering",
      maxTemp: 30,
      minTemp: 10,
      targetMin: 20,
      targetMax: 25,
      showNip: false,
      showSource: false,
    },
    {
      id: "pemorsian",
      title: "Pemantauan Suhu Ruangan Pemorsian",
      room: "Pemorsian",
      maxTemp: 35,
      minTemp: 15,
      targetMin: 22,
      targetMax: 30,
      showNip: true,
      showSource: false,
    },
    {
      id: "pengolahan",
      title: "Pemantauan Suhu Ruangan Pengolahan/Dapur",
      room: "Pengolahan",
      maxTemp: 35,
      minTemp: 15,
      targetMin: 22,
      targetMax: 30,
      showNip: false,
      showSource: true,
    },
  ];

  const DEFAULT_SETTINGS = {
    unitName: "Satuan Pelayanan Pemenuhan Gizi (SPPG) Pandeglang Patia Ciawi",
    inspectorRole: "Pengawas Gizi Satuan Pelayanan Pemenuhan Gizi",
    inspectorName: "Eki Nafrizal Al-Hafid, S.K.M",
    leadRole: "Kepala Satuan Pelayanan Pemenuhan Gizi",
    leadName: "Berlin Purnawan Harefa, S.H",
    leadNip: "",
  };

  const MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  // State
  let activeTab = "gudang-kering";
  let state = loadState();

  function getDefaultMonthName() {
    const now = new Date();
    return MONTHS[now.getMonth()] || "November";
  }

  function createEmptyPeriodData() {
    const basahRows = [];
    for (let i = 1; i <= 10; i++) {
      basahRows.push({
        tanggal: String(i),
        waktu: "Pagi",
        chillerSayur: "",
        freezerDaging: "",
        chillerSampel: "",
        freezerIkan: "",
        paraf: "",
      });
    }
    return {
      "gudang-kering": { readings: {}, notes: {} },
      pemorsian: { readings: {}, notes: {} },
      pengolahan: { readings: {}, notes: {} },
      "gudang-basah": { rows: basahRows },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          month: parsed.month || getDefaultMonthName(),
          year: parsed.year || 2026,
          gasUrl: parsed.gasUrl || "",
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
          periods: parsed.periods || {},
        };
      }
    } catch (err) {
      console.warn("Gagal membaca localStorage:", err);
    }
    return {
      month: getDefaultMonthName(),
      year: 2026,
      gasUrl: "",
      settings: { ...DEFAULT_SETTINGS },
      periods: {},
    };
  }

  let cloudSaveTimer = null;
  function saveState(skipCloud = false) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Gagal menyimpan localStorage:", err);
    }
    if (!skipCloud && state.gasUrl) {
      scheduleCloudSave();
    }
  }

  function getPeriodKey() {
    return `${state.year}-${state.month}`;
  }

  function getPeriodData() {
    const key = getPeriodKey();
    if (!state.periods[key]) {
      state.periods[key] = createEmptyPeriodData();
    }
    return state.periods[key];
  }

  // DOM Elements
  const globalMonthEl = document.getElementById("globalMonth");
  const globalYearEl = document.getElementById("globalYear");
  const quickInputPanelEl = document.getElementById("quickInputPanel");
  const sheetsContainerEl = document.getElementById("sheetsContainer");
  const settingsModalEl = document.getElementById("settingsModal");
  const toastEl = document.getElementById("toast");

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Initialize Period Controls
  globalMonthEl.value = state.month;
  globalYearEl.value = state.year;

  globalMonthEl.addEventListener("change", () => {
    state.month = globalMonthEl.value;
    saveState(true);
    renderAll();
    if (state.gasUrl) syncFromCloud();
  });

  globalYearEl.addEventListener("change", () => {
    const val = parseInt(globalYearEl.value, 10);
    state.year = Number.isFinite(val) ? val : 2026;
    globalYearEl.value = state.year;
    saveState(true);
    renderAll();
    if (state.gasUrl) syncFromCloud();
  });

  // Tab Switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      renderAll();
    });
  });

  // Quick Input Panel
  function renderQuickPanel() {
    if (activeTab === "all") {
      quickInputPanelEl.classList.add("hidden");
      quickInputPanelEl.innerHTML = "";
      return;
    }
    quickInputPanelEl.classList.remove("hidden");

    const roomForm = ROOM_FORMS.find((f) => f.id === activeTab);
    if (roomForm) {
      let dayOptions = "";
      for (let d = 1; d <= 31; d++) {
        dayOptions += `<option value="${d}">Tanggal ${d}</option>`;
      }

      quickInputPanelEl.innerHTML = `
        <div class="quick-panel-header">
          <div class="quick-panel-title">Input Cepat — ${escapeHtml(roomForm.room)}</div>
          <div class="quick-panel-hint">Klik langsung sel pada grafik tabel di bawah, atau gunakan form cepat di sini.</div>
        </div>
        <form id="quickRoomForm" class="quick-form">
          <label class="q-field">
            <span>Tanggal</span>
            <select id="qDay">${dayOptions}</select>
          </label>
          <label class="q-field">
            <span>Waktu</span>
            <select id="qShift">
              <option value="P">P (Pagi)</option>
              <option value="S">S (Siang)</option>
            </select>
          </label>
          <label class="q-field">
            <span>Suhu (℃)</span>
            <input type="number" id="qTemp" min="${roomForm.minTemp}" max="${roomForm.maxTemp}" value="${roomForm.targetMax}" required />
          </label>
          <label class="q-field q-field-wide">
            <span>Keterangan (Opsional)</span>
            <input type="text" id="qNote" placeholder="Contoh: Normal / AC mati" />
          </label>
          <button type="submit" class="btn btn-primary btn-sm">💾 Simpan Titik</button>
          <button type="button" id="qDeletePoint" class="btn btn-secondary btn-sm">Hapus Titik</button>
        </form>
      `;

      const formEl = document.getElementById("quickRoomForm");
      formEl.addEventListener("submit", (e) => {
        e.preventDefault();
        const day = document.getElementById("qDay").value;
        const shift = document.getElementById("qShift").value;
        const temp = parseInt(document.getElementById("qTemp").value, 10);
        const note = document.getElementById("qNote").value.trim();

        if (temp < roomForm.minTemp || temp > roomForm.maxTemp) {
          showToast(`Suhu harus antara ${roomForm.minTemp}℃ dan ${roomForm.maxTemp}℃`);
          return;
        }

        const pData = getPeriodData()[roomForm.id];
        pData.readings[`${day}-${shift}`] = temp;
        if (note) {
          pData.notes[`${day}-${shift}`] = note;
        } else {
          delete pData.notes[`${day}-${shift}`];
        }
        saveState();
        renderSheets();
        showToast(`Tersimpan: Tgl ${day} (${shift}) = ${temp}℃`);
      });

      document.getElementById("qDeletePoint").addEventListener("click", () => {
        const day = document.getElementById("qDay").value;
        const shift = document.getElementById("qShift").value;
        const pData = getPeriodData()[roomForm.id];
        delete pData.readings[`${day}-${shift}`];
        delete pData.notes[`${day}-${shift}`];
        saveState();
        renderSheets();
        showToast(`Data Tgl ${day} (${shift}) dihapus`);
      });
    } else if (activeTab === "gudang-basah") {
      quickInputPanelEl.innerHTML = `
        <div class="quick-panel-header">
          <div class="quick-panel-title">Input Data — Gudang Basah (Chiller &amp; Freezer)</div>
          <div class="quick-panel-hint">Anda dapat mengetik langsung di dalam tabel atau menambahkan baris baru di bawah.</div>
        </div>
        <form id="quickBasahForm" class="quick-form">
          <label class="q-field">
            <span>Tanggal</span>
            <input type="text" id="bTanggal" placeholder="1" style="width:70px" required />
          </label>
          <label class="q-field">
            <span>Waktu</span>
            <input type="text" id="bWaktu" placeholder="Pagi / 07:00" style="width:110px" required />
          </label>
          <label class="q-field">
            <span>Chiller Sayur &amp; Bumbu</span>
            <input type="text" id="bChillerSayur" placeholder="4℃" style="width:110px" />
          </label>
          <label class="q-field">
            <span>Freezer Daging</span>
            <input type="text" id="bFreezerDaging" placeholder="-18℃" style="width:110px" />
          </label>
          <label class="q-field">
            <span>Chiller Sampel</span>
            <input type="text" id="bChillerSampel" placeholder="4℃" style="width:110px" />
          </label>
          <label class="q-field">
            <span>Freezer Ikan</span>
            <input type="text" id="bFreezerIkan" placeholder="-18℃" style="width:110px" />
          </label>
          <label class="q-field">
            <span>Paraf</span>
            <input type="text" id="bParaf" placeholder="Petugas" style="width:90px" />
          </label>
          <button type="submit" class="btn btn-primary btn-sm">+ Tambah Baris</button>
          <button type="button" id="btnGen31" class="btn btn-secondary btn-sm">Generate Tgl 1–31</button>
        </form>
      `;

      document.getElementById("quickBasahForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const rows = getPeriodData()["gudang-basah"].rows;
        rows.push({
          tanggal: document.getElementById("bTanggal").value.trim(),
          waktu: document.getElementById("bWaktu").value.trim(),
          chillerSayur: document.getElementById("bChillerSayur").value.trim(),
          freezerDaging: document.getElementById("bFreezerDaging").value.trim(),
          chillerSampel: document.getElementById("bChillerSampel").value.trim(),
          freezerIkan: document.getElementById("bFreezerIkan").value.trim(),
          paraf: document.getElementById("bParaf").value.trim(),
        });
        saveState();
        renderSheets();
        e.target.reset();
        showToast("Baris Gudang Basah ditambahkan");
      });

      document.getElementById("btnGen31").addEventListener("click", () => {
        const rows = [];
        for (let d = 1; d <= 31; d++) {
          rows.push({
            tanggal: String(d),
            waktu: "Pagi",
            chillerSayur: "",
            freezerDaging: "",
            chillerSampel: "",
            freezerIkan: "",
            paraf: "",
          });
        }
        getPeriodData()["gudang-basah"].rows = rows;
        saveState();
        renderSheets();
        showToast("Tabel 1–31 hari berhasil dibuat");
      });
    }
  }

  // Render Room Template Sheet (Forms 1, 2, 3)
  function buildRoomSheetHtml(form) {
    const pData = getPeriodData()[form.id];
    const s = state.settings;

    let dateHeaders = "";
    let psHeaders = "";
    for (let d = 1; d <= 31; d++) {
      dateHeaders += `<th colspan="2">${d}</th>`;
      psHeaders += `<th class="col-ps">P</th><th class="col-ps">S</th>`;
    }

    let bodyRows = "";
    const targetMid = Math.round((form.targetMin + form.targetMax) / 2);
    for (let t = form.maxTemp; t >= form.minTemp; t--) {
      const inTarget = t >= form.targetMin && t <= form.targetMax;
      const isTop = t === form.targetMax;
      const isBottom = t === form.targetMin;
      const rowClasses = [
        inTarget ? "target-range-row" : "",
        isTop ? "target-range-top" : "",
        isBottom ? "target-range-bottom" : "",
      ]
        .filter(Boolean)
        .join(" ");

      let cells = "";
      for (let d = 1; d <= 31; d++) {
        ["P", "S"].forEach((shift) => {
          const key = `${d}-${shift}`;
          const val = pData.readings[key];
          const isActive = val === t;
          const isOut = isActive && (val < form.targetMin || val > form.targetMax);
          const note = pData.notes[key] ? ` (${pData.notes[key]})` : "";
          const title = `Tgl ${d} ${shift === "P" ? "Pagi" : "Siang"} — ${t}℃${isActive ? " [Aktif]" : ""}${note}`;
          cells += `
            <td class="grid-cell ${isActive ? "active-point" : ""} ${isOut ? "over-target" : ""}"
                data-form="${form.id}" data-day="${d}" data-shift="${shift}" data-temp="${t}"
                title="${escapeHtml(title)}">
              ${isActive ? '<span class="check-marker">✓</span>' : ""}
            </td>
          `;
        });
      }

      bodyRows += `
        <tr class="${rowClasses}">
          <td class="col-suhu">${t}</td>
          ${cells}
          <td class="col-ket">${t === targetMid ? `Suhu yang ditetapkan (${form.targetMin}–${form.targetMax}℃)` : ""}</td>
        </tr>
      `;
    }

    // Collect notes summary if any
    const noteEntries = Object.entries(pData.notes || {});
    const noteSummaryHtml = noteEntries.length
      ? `<div class="ket-inline-list"><strong>Catatan Ket:</strong> ${noteEntries
          .map(([k, v]) => `Tgl ${k.replace("-", " ")}: ${escapeHtml(v)}`)
          .join(" • ")}</div>`
      : "";

    return `
      <article class="template-sheet" data-sheet-id="${form.id}">
        <div class="sheet-title-block">
          <h2>${escapeHtml(form.title)}</h2>
          <p class="subtitle">${escapeHtml(s.unitName)}</p>
        </div>

        <div class="sheet-meta">
          <span>Bulan : <strong>${escapeHtml(state.month)}</strong></span>
          <span>Tahun : <strong>${escapeHtml(state.year)}</strong></span>
          <span>Ruangan : <strong>${escapeHtml(form.room)}</strong></span>
        </div>

        <div class="grid-wrapper" data-grid-form="${form.id}">
          <svg class="chart-overlay" aria-hidden="true"></svg>
          <table class="temp-table">
            <thead>
              <tr>
                <th class="col-suhu">Tanggal</th>
                ${dateHeaders}
                <th class="col-ket" rowspan="2">Ket</th>
              </tr>
              <tr>
                <th class="col-suhu">Suhu (℃)</th>
                ${psHeaders}
              </tr>
            </thead>
            <tbody>
              ${bodyRows}
            </tbody>
          </table>
        </div>

        <div class="sheet-notes">
          <p><strong>Ket :</strong></p>
          <p>*P : Pagi &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; S : Siang</p>
          ${noteSummaryHtml}
        </div>

        <div class="signature-row">
          <div class="sig-box">
            <p class="sig-role">Diperiksa Oleh,</p>
            <p class="sig-role">${escapeHtml(s.inspectorRole)}</p>
            <div class="sig-space"></div>
            <p class="sig-name">${escapeHtml(s.inspectorName)}</p>
          </div>
          <div class="sig-box">
            <p class="sig-role">Penanggung Jawab,</p>
            <p class="sig-role">${escapeHtml(s.leadRole)}</p>
            <div class="sig-space"></div>
            <p class="sig-name">${escapeHtml(s.leadName)}</p>
            ${form.showNip ? `<p class="sig-nip">NIP. ${escapeHtml(s.leadNip)}</p>` : ""}
          </div>
        </div>

        ${form.showSource ? `<div class="source-footer">sumber : permenkes no 7 tahun 2019</div>` : ""}
      </article>
    `;
  }

  // Render Form 4: Gudang Basah
  function buildGudangBasahHtml() {
    const rows = getPeriodData()["gudang-basah"].rows;

    const rowsHtml = rows
      .map(
        (r, idx) => `
      <tr data-row-idx="${idx}">
        <td><input type="text" data-field="tanggal" value="${escapeHtml(r.tanggal)}" /></td>
        <td><input type="text" data-field="waktu" value="${escapeHtml(r.waktu)}" /></td>
        <td><input type="text" data-field="chillerSayur" value="${escapeHtml(r.chillerSayur)}" /></td>
        <td><input type="text" data-field="freezerDaging" value="${escapeHtml(r.freezerDaging)}" /></td>
        <td><input type="text" data-field="chillerSampel" value="${escapeHtml(r.chillerSampel)}" /></td>
        <td><input type="text" data-field="freezerIkan" value="${escapeHtml(r.freezerIkan)}" /></td>
        <td><input type="text" data-field="paraf" value="${escapeHtml(r.paraf)}" /></td>
        <td class="no-print" style="width:36px;">
          <button type="button" class="row-del-btn" data-del-idx="${idx}" title="Hapus baris">✕</button>
        </td>
      </tr>
    `
      )
      .join("");

    return `
      <article class="template-sheet" data-sheet-id="gudang-basah">
        <div class="sheet-title-block">
          <h2>FORM PEMANTAUAN SUHU PENYIMPANAN BAHAN MAKANAN DI GUDANG BASAH</h2>
        </div>

        <div class="sheet-meta" style="justify-content: flex-start; gap: 48px;">
          <span>BULAN : <strong>${escapeHtml(state.month.toUpperCase())}</strong></span>
          <span>TAHUN : <strong>${escapeHtml(state.year)}</strong></span>
        </div>

        <table class="basah-table">
          <thead>
            <tr>
              <th rowspan="2" style="width: 80px;">Tanggal</th>
              <th rowspan="2" style="width: 110px;">Waktu</th>
              <th colspan="2">Ruang pendingin</th>
              <th colspan="2">Suhu Freezer</th>
              <th rowspan="2" style="width: 100px;">Paraf</th>
              <th rowspan="2" class="no-print" style="width: 36px;">Aksi</th>
            </tr>
            <tr>
              <th>Chiller Sayur dan bumbu</th>
              <th>Freezer Daging</th>
              <th>Chiller Sampel</th>
              <th>Freezer ikan</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </article>
    `;
  }

  // Draw SVG Polylines on Grid Overlays (disabled in checkmark mode)
  function drawAllChartLines() {
    document.querySelectorAll(".chart-overlay").forEach((svg) => {
      svg.innerHTML = "";
    });
  }

  function renderSheets() {
    let html = "";
    if (activeTab === "all") {
      ROOM_FORMS.forEach((f) => {
        html += buildRoomSheetHtml(f);
      });
      html += buildGudangBasahHtml();
    } else if (activeTab === "gudang-basah") {
      html = buildGudangBasahHtml();
    } else {
      const form = ROOM_FORMS.find((f) => f.id === activeTab);
      if (form) html = buildRoomSheetHtml(form);
    }

    sheetsContainerEl.innerHTML = html;
    attachSheetListeners();
    requestAnimationFrame(drawAllChartLines);
  }

  function attachSheetListeners() {
    // Grid cell click to toggle/set temperature
    sheetsContainerEl.querySelectorAll(".grid-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        const formId = cell.dataset.form;
        const day = cell.dataset.day;
        const shift = cell.dataset.shift;
        const temp = parseInt(cell.dataset.temp, 10);
        const key = `${day}-${shift}`;

        const pData = getPeriodData()[formId];
        if (pData.readings[key] === temp) {
          delete pData.readings[key];
        } else {
          pData.readings[key] = temp;
        }
        saveState();
        renderSheets();
      });
    });

    // Gudang Basah inline input edits
    sheetsContainerEl.querySelectorAll(".basah-table tbody input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const tr = inp.closest("tr");
        const idx = parseInt(tr.dataset.rowIdx, 10);
        const field = inp.dataset.field;
        const rows = getPeriodData()["gudang-basah"].rows;
        if (rows[idx]) {
          rows[idx][field] = inp.value;
          saveState();
        }
      });
    });

    // Gudang Basah delete row
    sheetsContainerEl.querySelectorAll(".row-del-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.delIdx, 10);
        const rows = getPeriodData()["gudang-basah"].rows;
        rows.splice(idx, 1);
        saveState();
        renderSheets();
      });
    });
  }

  function renderAll() {
    renderQuickPanel();
    renderSheets();
  }

  // Redraw SVG lines on resize or before print
  window.addEventListener("resize", () => requestAnimationFrame(drawAllChartLines));
  window.addEventListener("beforeprint", drawAllChartLines);

  // Print Button
  document.getElementById("btnPrint").addEventListener("click", () => {
    drawAllChartLines();
    window.print();
  });

  // Sample Data Button
  document.getElementById("btnSample").addEventListener("click", () => {
    const pData = getPeriodData();

    const fillRoom = (id, base, min, max) => {
      const readings = {};
      for (let d = 1; d <= 31; d++) {
        const pOffset = Math.round(Math.sin(d * 0.5) * 2) - 1;
        const sOffset = Math.round(Math.cos(d * 0.4) * 2);
        readings[`${d}-P`] = Math.max(min, Math.min(max, base + pOffset));
        readings[`${d}-S`] = Math.max(min, Math.min(max, base + sOffset));
      }
      pData[id].readings = readings;
    };

    fillRoom("gudang-kering", 24, 10, 30);
    fillRoom("pemorsian", 28, 15, 35);
    fillRoom("pengolahan", 29, 15, 35);

    const basahRows = [];
    for (let d = 1; d <= 15; d++) {
      basahRows.push({
        tanggal: String(d),
        waktu: "07:30",
        chillerSayur: `${3 + (d % 3)}℃`,
        freezerDaging: `${-19 + (d % 3)}℃`,
        chillerSampel: `${4 + (d % 2)}℃`,
        freezerIkan: `${-18 - (d % 2)}℃`,
        paraf: "Petugas",
      });
    }
    pData["gudang-basah"].rows = basahRows;

    saveState();
    renderAll();
    showToast("Contoh data berhasil diisi");
  });

  // Reset Data Button
  document.getElementById("btnClear").addEventListener("click", () => {
    if (!confirm(`Kosongkan semua data pemantauan untuk ${state.month} ${state.year}?`)) return;
    state.periods[getPeriodKey()] = createEmptyPeriodData();
    saveState();
    renderAll();
    showToast("Data bulan ini dikosongkan");
  });

  // Settings Modal
  const openSettings = () => {
    const s = state.settings;
    document.getElementById("setUnitName").value = s.unitName;
    document.getElementById("setInspectorRole").value = s.inspectorRole;
    document.getElementById("setInspectorName").value = s.inspectorName;
    document.getElementById("setLeadRole").value = s.leadRole;
    document.getElementById("setLeadName").value = s.leadName;
    document.getElementById("setLeadNip").value = s.leadNip || "";
    settingsModalEl.classList.remove("hidden");
  };

  const closeSettings = () => settingsModalEl.classList.add("hidden");

  document.getElementById("btnSettings").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("cancelSettings").addEventListener("click", closeSettings);
  settingsModalEl.querySelector(".modal-backdrop").addEventListener("click", closeSettings);

  document.getElementById("settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.settings = {
      unitName: document.getElementById("setUnitName").value.trim(),
      inspectorRole: document.getElementById("setInspectorRole").value.trim(),
      inspectorName: document.getElementById("setInspectorName").value.trim(),
      leadRole: document.getElementById("setLeadRole").value.trim(),
      leadName: document.getElementById("setLeadName").value.trim(),
      leadNip: document.getElementById("setLeadNip").value.trim(),
    };
    saveState();
    closeSettings();
    renderSheets();
    showToast("Pengaturan pejabat diperbarui");
  });

  // Export CSV (Matching exact 65-column template structure)
  function csvCell(val) {
    const str = String(val ?? "");
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function makeRow(len = 65) {
    return new Array(len).fill("");
  }

  document.getElementById("btnExportCsv").addEventListener("click", () => {
    if (activeTab === "all") {
      showToast("Pilih tab ruangan terlebih dahulu untuk export per ruangan");
      return;
    }

    const lines = [];
    const pData = getPeriodData();
    const s = state.settings;
    let roomLabel = "";

    const roomForm = ROOM_FORMS.find((f) => f.id === activeTab);
    if (roomForm) {
      roomLabel = roomForm.room.replace(/[\s/]+/g, "_");
      lines.push(makeRow());
      const titleRow = makeRow();
      titleRow[1] = `${roomForm.title}\n${s.unitName}`;
      lines.push(titleRow);
      lines.push(makeRow());

      const metaRow = makeRow();
      metaRow[1] = `Bulan : ${state.month}`;
      metaRow[7] = `Tahun : ${state.year}`;
      metaRow[16] = `Ruangan : ${roomForm.room}`;
      lines.push(metaRow);

      const tglRow = makeRow();
      tglRow[1] = "Tanggal";
      for (let d = 1; d <= 31; d++) {
        tglRow[2 + (d - 1) * 2] = String(d);
      }
      tglRow[64] = "Ket";
      lines.push(tglRow);

      const psRow = makeRow();
      psRow[1] = "Suhu (℃)";
      for (let d = 1; d <= 31; d++) {
        psRow[2 + (d - 1) * 2] = "P";
        psRow[3 + (d - 1) * 2] = "S";
      }
      lines.push(psRow);

      const readings = pData[roomForm.id].readings;
      for (let t = roomForm.maxTemp; t >= roomForm.minTemp; t--) {
        const r = makeRow();
        r[1] = String(t);
        for (let d = 1; d <= 31; d++) {
          if (readings[`${d}-P`] === t) r[2 + (d - 1) * 2] = "✓";
          if (readings[`${d}-S`] === t) r[3 + (d - 1) * 2] = "✓";
        }
        if (t === roomForm.targetMax) r[64] = `Suhu yang ditetapkan (${roomForm.targetMin}-${roomForm.targetMax}℃)`;
        lines.push(r);
      }

      const ket1 = makeRow();
      ket1[2] = "Ket : ";
      lines.push(ket1);

      const ket2 = makeRow();
      ket2[2] = "*P : Pagi ";
      ket2[11] = "S : Siang ";
      lines.push(ket2);
      lines.push(makeRow());

      const sig1 = makeRow();
      sig1[2] = "Diperiksa Oleh,";
      sig1[39] = "Penanggung Jawab,";
      lines.push(sig1);

      const sig2 = makeRow();
      sig2[2] = s.inspectorRole;
      sig2[39] = s.leadRole;
      lines.push(sig2);

      for (let i = 0; i < 4; i++) lines.push(makeRow());

      const sigName = makeRow();
      sigName[2] = s.inspectorName;
      sigName[39] = s.leadName;
      lines.push(sigName);

      if (roomForm.showNip) {
        const nipRow = makeRow();
        nipRow[39] = `NIP. ${s.leadNip || ""}`;
        lines.push(nipRow);
      }

      if (roomForm.showSource) {
        lines.push(makeRow());
        const srcRow = makeRow();
        srcRow[2] = "sumber : permenkes no 7 tahun 2019";
        lines.push(srcRow);
      }
    } else if (activeTab === "gudang-basah") {
      roomLabel = "Gudang_Basah";
      const bTitle = makeRow(7);
      bTitle[0] = "FORM PEMANTAUAN SUHU PENYIMPANAN BAHAN MAKANAN DI GUDANG BASAH";
      lines.push(bTitle);
      lines.push(makeRow(7));

      const bMeta = makeRow(7);
      bMeta[0] = `BULAN : ${state.month}`;
      bMeta[4] = `TAHUN : ${state.year}`;
      lines.push(bMeta);
      lines.push(makeRow(7));

      lines.push(["Tanggal", "Waktu", "Ruang pendingin", "", "Suhu Freezer", "", "Paraf"]);
      lines.push(["", "", "Chiller Sayur dan bumbu", "Freezer Daging", "Chiller Sampel", "Freezer ikan", ""]);

      pData["gudang-basah"].rows.forEach((r) => {
        lines.push([
          r.tanggal,
          r.waktu,
          r.chillerSayur,
          r.freezerDaging,
          r.chillerSampel,
          r.freezerIkan,
          r.paraf,
        ]);
      });
    }

    const csvContent = "\uFEFF" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(
      csvContent,
      `Pemantauan_Suhu_${roomLabel}_${state.month}_${state.year}.csv`,
      "text/csv;charset=utf-8;"
    );
    showToast(`CSV ${roomLabel.replace(/_/g, " ")} berhasil diunduh`);
  });

  // Export Excel (.xlsx asli via OOXML, per ruangan & ukuran kolom seragam)
  document.getElementById("btnExportExcel").addEventListener("click", () => {
    if (activeTab === "all") {
      showToast("Pilih tab ruangan terlebih dahulu untuk export per ruangan");
      return;
    }

    const pData = getPeriodData();
    const s = state.settings;
    const { exportSingleSheet, colLetter } = window.XlsxExporter;

    const roomForm = ROOM_FORMS.find((f) => f.id === activeTab);
    if (roomForm) {
      const roomLabel = roomForm.room.replace(/[\s/]+/g, "_");
      const cols = [
        { min: 1, max: 1, width: 9 },
        { min: 2, max: 63, width: 3.1 },
        { min: 64, max: 64, width: 28 },
      ];

      const rows = [];
      const merges = [];

      // Row 1: Title
      rows.push({ num: 1, height: 22, cells: [{ col: 1, value: roomForm.title, style: 1 }] });
      merges.push("A1:BL1");

      // Row 2: Unit Name
      rows.push({ num: 2, height: 18, cells: [{ col: 1, value: s.unitName, style: 2 }] });
      merges.push("A2:BL2");

      // Row 3: Spacer
      rows.push({ num: 3, height: 8, cells: [] });

      // Row 4: Meta
      rows.push({
        num: 4,
        height: 18,
        cells: [
          { col: 1, value: `Bulan : ${state.month}`, style: 3 },
          { col: 14, value: `Tahun : ${state.year}`, style: 3 },
          { col: 30, value: `Ruangan : ${roomForm.room}`, style: 3 },
        ],
      });
      merges.push("A4:M4", "N4:AC4", "AD4:BL4");

      // Row 5: Tanggal 1..31 + Ket
      const row5Cells = [{ col: 1, value: "Tanggal", style: 4 }];
      for (let d = 1; d <= 31; d++) {
        const c1 = 2 + (d - 1) * 2;
        const c2 = c1 + 1;
        row5Cells.push({ col: c1, value: d, style: 4 });
        row5Cells.push({ col: c2, value: "", style: 4 });
        merges.push(`${colLetter(c1)}5:${colLetter(c2)}5`);
      }
      row5Cells.push({ col: 64, value: "Ket", style: 4 });
      rows.push({ num: 5, height: 18, cells: row5Cells });
      merges.push("BL5:BL6");

      // Row 6: Suhu (℃) + P / S
      const row6Cells = [{ col: 1, value: "Suhu (℃)", style: 4 }];
      for (let d = 1; d <= 31; d++) {
        const c1 = 2 + (d - 1) * 2;
        row6Cells.push({ col: c1, value: "P", style: 4 });
        row6Cells.push({ col: c1 + 1, value: "S", style: 4 });
      }
      row6Cells.push({ col: 64, value: "", style: 4 });
      rows.push({ num: 6, height: 16, cells: row6Cells });

      // Temperature grid rows
      let rNum = 7;
      const readings = pData[roomForm.id].readings;
      const targetMid = Math.round((roomForm.targetMin + roomForm.targetMax) / 2);
      for (let t = roomForm.maxTemp; t >= roomForm.minTemp; t--) {
        const isTarget = t >= roomForm.targetMin && t <= roomForm.targetMax;
        const cellStyle = isTarget ? 7 : 6;
        const ketStyle = isTarget ? 9 : 8;
        const cells = [{ col: 1, value: t, style: 5 }];
        for (let d = 1; d <= 31; d++) {
          const c1 = 2 + (d - 1) * 2;
          cells.push({ col: c1, value: readings[`${d}-P`] === t ? "✓" : "", style: cellStyle });
          cells.push({ col: c1 + 1, value: readings[`${d}-S`] === t ? "✓" : "", style: cellStyle });
        }
        cells.push({
          col: 64,
          value: t === targetMid ? `Suhu yang ditetapkan (${roomForm.targetMin}–${roomForm.targetMax}℃)` : "",
          style: ketStyle,
        });
        rows.push({ num: rNum, height: 15, cells });
        rNum++;
      }

      // Ket footer
      rows.push({ num: rNum, height: 16, cells: [{ col: 1, value: "Ket :   *P : Pagi     S : Siang", style: 3 }] });
      merges.push(`A${rNum}:BL${rNum}`);
      rNum += 2;

      // Signature block
      const leftSig = `Diperiksa Oleh,\n${s.inspectorRole}\n\n\n\n${s.inspectorName}`;
      const rightSig = `Penanggung Jawab,\n${s.leadRole}\n\n\n\n${s.leadName}${roomForm.showNip ? `\nNIP. ${s.leadNip || ""}` : ""}`;
      rows.push({
        num: rNum,
        height: 95,
        cells: [
          { col: 2, value: leftSig, style: 10 },
          { col: 38, value: rightSig, style: 10 },
        ],
      });
      merges.push(`B${rNum}:AA${rNum}`, `AL${rNum}:BL${rNum}`);
      rNum++;

      if (roomForm.showSource) {
        rows.push({
          num: rNum,
          height: 16,
          cells: [{ col: 1, value: "sumber : permenkes no 7 tahun 2019", style: 11 }],
        });
        merges.push(`A${rNum}:BL${rNum}`);
      }

      exportSingleSheet({
        sheetName: roomForm.room,
        cols,
        rows,
        merges,
        filename: `Pemantauan_Suhu_${roomLabel}_${state.month}_${state.year}.xlsx`,
        landscape: true,
      });
      showToast(`Excel ${roomForm.room} (.xlsx) berhasil diunduh`);
    } else if (activeTab === "gudang-basah") {
      const cols = [
        { min: 1, max: 1, width: 12 },
        { min: 2, max: 2, width: 14 },
        { min: 3, max: 3, width: 24 },
        { min: 4, max: 4, width: 18 },
        { min: 5, max: 5, width: 18 },
        { min: 6, max: 6, width: 18 },
        { min: 7, max: 7, width: 14 },
      ];

      const rows = [
        {
          num: 1,
          height: 22,
          cells: [{ col: 1, value: "FORM PEMANTAUAN SUHU PENYIMPANAN BAHAN MAKANAN DI GUDANG BASAH", style: 1 }],
        },
        { num: 2, height: 8, cells: [] },
        {
          num: 3,
          height: 18,
          cells: [
            { col: 1, value: `BULAN : ${state.month}`, style: 3 },
            { col: 5, value: `TAHUN : ${state.year}`, style: 3 },
          ],
        },
        {
          num: 4,
          height: 20,
          cells: [
            { col: 1, value: "Tanggal", style: 4 },
            { col: 2, value: "Waktu", style: 4 },
            { col: 3, value: "Ruang pendingin", style: 4 },
            { col: 4, value: "", style: 4 },
            { col: 5, value: "Suhu Freezer", style: 4 },
            { col: 6, value: "", style: 4 },
            { col: 7, value: "Paraf", style: 4 },
          ],
        },
        {
          num: 5,
          height: 20,
          cells: [
            { col: 1, value: "", style: 4 },
            { col: 2, value: "", style: 4 },
            { col: 3, value: "Chiller Sayur dan bumbu", style: 4 },
            { col: 4, value: "Freezer Daging", style: 4 },
            { col: 5, value: "Chiller Sampel", style: 4 },
            { col: 6, value: "Freezer ikan", style: 4 },
            { col: 7, value: "", style: 4 },
          ],
        },
      ];

      const merges = ["A1:G1", "A3:C3", "E3:G3", "A4:A5", "B4:B5", "C4:D4", "E4:F4", "G4:G5"];

      let rNum = 6;
      pData["gudang-basah"].rows.forEach((r) => {
        rows.push({
          num: rNum,
          height: 18,
          cells: [
            { col: 1, value: r.tanggal, style: 6 },
            { col: 2, value: r.waktu, style: 6 },
            { col: 3, value: r.chillerSayur, style: 6 },
            { col: 4, value: r.freezerDaging, style: 6 },
            { col: 5, value: r.chillerSampel, style: 6 },
            { col: 6, value: r.freezerIkan, style: 6 },
            { col: 7, value: r.paraf, style: 6 },
          ],
        });
        rNum++;
      });

      exportSingleSheet({
        sheetName: "Gudang Basah",
        cols,
        rows,
        merges,
        filename: `Pemantauan_Suhu_Gudang_Basah_${state.month}_${state.year}.xlsx`,
        landscape: false,
      });
      showToast("Excel Gudang Basah (.xlsx) berhasil diunduh");
    }
  });

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Google Sheets Sync (Apps Script) ---
  const cloudModalEl = document.getElementById("cloudModal");
  const cloudStatusDotEl = document.getElementById("cloudStatusDot");
  const cloudStatusTextEl = document.getElementById("cloudStatusText");
  const cloudUrlInputEl = document.getElementById("cloudUrlInput");
  const cloudTestResultEl = document.getElementById("cloudTestResult");

  function setCloudStatus(mode, text) {
    cloudStatusDotEl.className = `status-dot ${mode}`;
    cloudStatusTextEl.textContent = text;
  }

  function safeParseGasResponse(text) {
    const trimmed = String(text || "").trim();
    if (trimmed.startsWith("<")) {
      throw new Error("Respon berupa HTML. Pastikan akses Web App di Apps Script disetel ke 'Anyone'.");
    }
    return JSON.parse(trimmed);
  }

  async function syncFromCloud(showSuccessToast = false) {
    if (!state.gasUrl) {
      setCloudStatus("offline", "Google Sheet");
      return;
    }
    setCloudStatus("syncing", "Memuat...");
    try {
      const period = getPeriodKey();
      const url = `${state.gasUrl}?action=load&period=${encodeURIComponent(period)}&t=${Date.now()}`;
      const res = await fetch(url, { redirect: "follow" });
      const json = safeParseGasResponse(await res.text());
      if (json.status !== "ok") throw new Error(json.message || "Gagal memuat data");

      if (json.settings) {
        state.settings = { ...DEFAULT_SETTINGS, ...json.settings };
      }
      if (json.periodData) {
        state.periods[period] = json.periodData;
      }
      saveState(true);
      renderAll();
      setCloudStatus("online", "Tersinkron");
      if (showSuccessToast) showToast("Data berhasil dimuat dari Google Sheet");
    } catch (err) {
      console.error("Cloud load error:", err);
      setCloudStatus("error", "Gagal Sync");
      if (showSuccessToast) showToast(`Gagal memuat: ${err.message}`);
    }
  }

  async function pushToCloud() {
    if (!state.gasUrl) return;
    setCloudStatus("syncing", "Menyimpan...");
    try {
      const res = await fetch(state.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow",
        body: JSON.stringify({
          action: "savePeriod",
          period: getPeriodKey(),
          periodData: getPeriodData(),
          settings: state.settings,
        }),
      });
      const json = safeParseGasResponse(await res.text());
      if (json.status !== "ok") throw new Error(json.message || "Gagal menyimpan");
      setCloudStatus("online", "Tersimpan");
    } catch (err) {
      console.error("Cloud save error:", err);
      setCloudStatus("error", "Gagal Sync");
    }
  }

  function scheduleCloudSave() {
    setCloudStatus("syncing", "Menyimpan...");
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(pushToCloud, 800);
  }

  const openCloudModal = () => {
    cloudUrlInputEl.value = state.gasUrl || "";
    cloudTestResultEl.classList.add("hidden");
    cloudModalEl.classList.remove("hidden");
  };
  const closeCloudModal = () => cloudModalEl.classList.add("hidden");

  document.getElementById("btnCloudSync").addEventListener("click", openCloudModal);
  document.getElementById("closeCloud").addEventListener("click", closeCloudModal);
  cloudModalEl.querySelector(".modal-backdrop").addEventListener("click", closeCloudModal);

  document.getElementById("btnDisconnectCloud").addEventListener("click", () => {
    state.gasUrl = "";
    cloudUrlInputEl.value = "";
    saveState(true);
    setCloudStatus("offline", "Google Sheet");
    closeCloudModal();
    showToast("Koneksi Google Sheet diputuskan");
  });

  document.getElementById("btnPullCloud").addEventListener("click", async () => {
    const url = cloudUrlInputEl.value.trim();
    if (!url) {
      showToast("Masukkan Web App URL terlebih dahulu");
      return;
    }
    state.gasUrl = url;
    saveState(true);
    await syncFromCloud(true);
  });

  document.getElementById("cloudForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = cloudUrlInputEl.value.trim();
    if (!url) return;

    cloudTestResultEl.className = "cloud-test-result";
    cloudTestResultEl.textContent = "Menguji koneksi ke Google Apps Script...";
    cloudTestResultEl.classList.remove("hidden");

    try {
      const res = await fetch(`${url}?action=ping&t=${Date.now()}`, { redirect: "follow" });
      const json = safeParseGasResponse(await res.text());
      if (json.status !== "ok") throw new Error(json.message || "Ping gagal");

      state.gasUrl = url;
      saveState(true);
      cloudTestResultEl.className = "cloud-test-result ok";
      cloudTestResultEl.textContent = "✅ Terhubung! Menyinkronkan data bulan ini...";
      await pushToCloud();
      setCloudStatus("online", "Tersinkron");
      setTimeout(closeCloudModal, 800);
      showToast("Google Sheet berhasil dihubungkan");
    } catch (err) {
      cloudTestResultEl.className = "cloud-test-result err";
      cloudTestResultEl.textContent = `❌ Gagal terhubung: ${err.message}`;
      setCloudStatus("error", "Gagal Sync");
    }
  });

  // Initial Render
  renderAll();
  if (state.gasUrl) {
    syncFromCloud();
  } else {
    setCloudStatus("offline", "Google Sheet");
  }
})();
