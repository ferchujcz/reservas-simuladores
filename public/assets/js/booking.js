/* ==========================================================================
   VICTORY SIMULATOR — Lógica de Reservas Públicas
   ========================================================================== */

(() => {
  const MAX_DAYS_AHEAD = 90;
  const FULL_DAY_NAMES = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

  const state = {
    settings: {
      currency: 'ARS',
      basePricePerHour: 15000,
      extraPlayerPricePerHour: 4000,
      groupDiscountThreshold: 3,
      groupDiscountPercent: 15,
      multiHourDiscountPercent: 10,
      resetBufferMinutes: 0,
      zonePrices: {},
      schedule: {
        0: { open: true, start: 12, end: 23 },
        1: { open: true, start: 14, end: 23 },
        2: { open: true, start: 14, end: 23 },
        3: { open: true, start: 14, end: 23 },
        4: { open: true, start: 14, end: 23 },
        5: { open: true, start: 12, end: 24 },
        6: { open: true, start: 10, end: 24 },
      },
    },
    zones: [],
    selectedZone: null,
    selectedDate: '',
    durationMinutes: 120,
    selectedSlot: null, // { startIso, endIso, label }
    occupiedRanges: [],
    availAbortCtrl: null,
  };

  // Referencias al DOM
  const els = {
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    globalAlert: document.getElementById('globalAlert'),
    zonesContainer: document.getElementById('zonesContainer'),
    refreshZonesBtn: document.getElementById('refreshZonesBtn'),
    dateStrip: document.getElementById('dateStrip'),
    bookingDate: document.getElementById('bookingDate'),
    durationPills: document.getElementById('durationPills'),
    slotsContainer: document.getElementById('slotsContainer'),
    step1: document.getElementById('stepIndicator1'),
    step2: document.getElementById('stepIndicator2'),
    step3: document.getElementById('stepIndicator3'),
    sumZone: document.getElementById('sumZone'),
    sumCap: document.getElementById('sumCap'),
    sumDate: document.getElementById('sumDate'),
    sumTime: document.getElementById('sumTime'),
    formFeedback: document.getElementById('formFeedback'),
    reservationForm: document.getElementById('reservationForm'),
    clientName: document.getElementById('clientName'),
    clientContact: document.getElementById('clientContact'),
    clientPlayers: document.getElementById('clientPlayers'),
    clientPayment: document.getElementById('clientPayment'),
    playersDecBtn: document.getElementById('playersDecBtn'),
    playersIncBtn: document.getElementById('playersIncBtn'),
    priceTotal: document.getElementById('priceTotal'),
    pricePerPilot: document.getElementById('pricePerPilot'),
    priceBadges: document.getElementById('priceBadges'),
    clientNotes: document.getElementById('clientNotes'),
    submitBtn: document.getElementById('submitBtn'),
    confirmationContainer: document.getElementById('confirmationContainer'),
    toastContainer: document.getElementById('toastContainer'),
    statusLookupForm: document.getElementById('statusLookupForm'),
    lookupCodeInput: document.getElementById('lookupCodeInput'),
    lookupSubmitBtn: document.getElementById('lookupSubmitBtn'),
    lookupResult: document.getElementById('lookupResult'),
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateYMD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatHumanDate(ymd) {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  function setAlert(container, message, type = 'error') {
    if (!message) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<div class="alert alert-${type}" role="alert"><span>${escapeHtml(message)}</span></div>`;
  }

  function updateStepper() {
    const hasZone = Boolean(state.selectedZone);
    const hasSlot = Boolean(state.selectedSlot);

    els.step1.className = `step-item ${hasZone ? 'done' : 'active'}`;
    els.step2.className = `step-item ${hasSlot ? 'done' : hasZone ? 'active' : ''}`;
    els.step3.className = `step-item ${hasSlot ? 'active' : ''}`;
  }

  function calculateLivePrice() {
    const s = state.settings;
    const hours = Math.max(0.5, state.durationMinutes / 60);
    const players = Math.max(1, parseInt(els.clientPlayers.value, 10) || 1);
    const zoneId = state.selectedZone?.id;
    const customZonePrice = zoneId ? s.zonePrices?.[String(zoneId)] : undefined;
    const hourlyBase =
      customZonePrice !== undefined && Number.isFinite(Number(customZonePrice))
        ? Number(customZonePrice)
        : Number(s.basePricePerHour || 0);

    const extraPlayers = Math.max(0, players - 1);
    let baseSubtotal = 0;
    if (s.pricingMode === 'per_player') {
      baseSubtotal = Math.round(hourlyBase * players * hours);
    } else if (s.pricingMode === 'flat') {
      baseSubtotal = Math.round(hourlyBase * hours);
    } else {
      baseSubtotal = Math.round((hourlyBase + extraPlayers * Number(s.extraPlayerPricePerHour || 0)) * hours);
    }

    let discountPercent = 0;
    const badges = [];
    if (players >= s.groupDiscountThreshold && s.groupDiscountPercent > 0) {
      discountPercent += s.groupDiscountPercent;
      badges.push(`${s.groupDiscountPercent}% OFF Grupo`);
    }
    if (hours >= 2 && s.multiHourDiscountPercent > 0) {
      discountPercent += s.multiHourDiscountPercent;
      badges.push(`${s.multiHourDiscountPercent}% OFF +2h`);
    }
    discountPercent = Math.min(80, discountPercent);
    const total = Math.max(0, baseSubtotal - Math.round((baseSubtotal * discountPercent) / 100));
    const perPlayer = Math.round(total / players);

    return { total, perPlayer, players, currency: s.currency || 'ARS', badges };
  }

  function updateSummary() {
    els.sumZone.textContent = state.selectedZone ? state.selectedZone.nombre : 'Sin seleccionar';
    els.sumCap.textContent = state.selectedZone ? `Hasta ${state.selectedZone.capacidad} jugadores` : '—';
    els.sumDate.textContent = state.selectedDate ? formatHumanDate(state.selectedDate) : '—';
    els.sumTime.textContent = state.selectedSlot
      ? `${state.selectedSlot.label} (${state.durationMinutes / 60} h)`
      : 'Elegí un horario';

    const priceBox = document.getElementById('priceBox');
    if (priceBox) {
      priceBox.classList.toggle('is-hidden', state.settings.showPrices === false);
    }

    const price = calculateLivePrice();
    els.priceTotal.textContent = `$${price.total.toLocaleString('es-AR')} ${price.currency}`;
    els.pricePerPilot.textContent =
      price.players > 1
        ? `$${price.perPlayer.toLocaleString('es-AR')} c/u (${price.players} jugadores)`
        : 'Tarifa individual';
    els.priceBadges.innerHTML = price.badges
      .map((b) => `<span class="discount-chip">${escapeHtml(b)}</span>`)
      .join('');

    els.submitBtn.disabled = !(state.selectedZone && state.selectedSlot);
    updateStepper();
  }

  function renderDateStrip() {
    const today = new Date();
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    els.dateStrip.innerHTML = '';

    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const ymd = formatDateYMD(d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `date-chip ${state.selectedDate === ymd ? 'selected' : ''}`;
      btn.dataset.date = ymd;

      const labelTop = i === 0 ? 'Hoy' : i === 1 ? 'Mañ' : dayNames[d.getDay()];
      btn.innerHTML = `
        <span class="date-chip-day">${labelTop}</span>
        <span class="date-chip-num">${String(d.getDate()).padStart(2, '0')}</span>
      `;
      btn.addEventListener('click', () => {
        state.selectedDate = ymd;
        els.bookingDate.value = ymd;
        state.selectedSlot = null;
        renderDateStrip();
        updateSummary();
        loadDayAvailability();
      });
      els.dateStrip.appendChild(btn);
    }
  }

  function initScheduleControls() {
    const today = new Date();
    const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_DAYS_AHEAD);
    const todayYmd = formatDateYMD(today);

    els.bookingDate.min = todayYmd;
    els.bookingDate.max = formatDateYMD(maxDate);
    els.bookingDate.value = todayYmd;
    state.selectedDate = todayYmd;

    renderDateStrip();

    els.bookingDate.addEventListener('change', () => {
      if (!els.bookingDate.value) return;
      state.selectedDate = els.bookingDate.value;
      state.selectedSlot = null;
      renderDateStrip();
      updateSummary();
      loadDayAvailability();
    });

    const durBtns = els.durationPills.querySelectorAll('.duration-btn');
    durBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.minutes, 10);
        if (!mins) return;
        state.durationMinutes = mins;
        state.selectedSlot = null;
        durBtns.forEach((b) => b.classList.toggle('selected', b === btn));
        updateSummary();
        renderSlots();
      });
    });
  }

  async function checkHealth() {
    try {
      const res = await fetch('/health');
      const data = await res.json();
      if (res.ok && data.status === 'healthy') {
        els.statusDot.className = 'status-dot online';
        els.statusText.textContent = `PISTA EN LÍNEA · ${data.timezone || 'Local'}`;
      } else {
        els.statusDot.className = 'status-dot offline';
        els.statusText.textContent = 'BASE DE DATOS DESCONECTADA';
      }
    } catch {
      els.statusDot.className = 'status-dot offline';
      els.statusText.textContent = 'SERVIDOR SIN CONEXIÓN';
    }
  }

  function renderZonesSkeleton() {
    els.zonesContainer.innerHTML = `
      <div class="skeleton-box"></div>
      <div class="skeleton-box"></div>
      <div class="skeleton-box"></div>
    `;
  }

  async function loadZones() {
    setAlert(els.globalAlert, '');
    renderZonesSkeleton();

    try {
      const res = await fetch('/api/reservations/zones');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudieron consultar los simuladores disponibles.');
      }
      const data = await res.json();
      state.zones = data.zones || [];

      if (state.zones.length === 0) {
        els.zonesContainer.innerHTML =
          '<div class="empty-state">No hay simuladores habilitados en este momento. Volvé a intentar más tarde.</div>';
        state.selectedZone = null;
        updateSummary();
        return;
      }

      if (!state.selectedZone || !state.zones.some((z) => z.id === state.selectedZone.id)) {
        state.selectedZone = state.zones[0];
      }

      els.clientPlayers.max = String(state.selectedZone.capacidad);
      renderZones();
      updateSummary();
      await loadDayAvailability();
    } catch (err) {
      els.zonesContainer.innerHTML =
        '<div class="empty-state">No pudimos conectar con el servidor de Victory Simulator. Verificá tu conexión e intentá nuevamente.</div>';
      setAlert(els.globalAlert, err.message || 'Error de conexión con el servidor.', 'error');
    }
  }

  function renderZones() {
    els.zonesContainer.innerHTML = '';

    state.zones.forEach((zone) => {
      const isSelected = state.selectedZone && state.selectedZone.id === zone.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `zone-card ${isSelected ? 'selected' : ''}`;
      card.setAttribute('aria-pressed', String(isSelected));
      card.innerHTML = `
        <div>
          <div class="zone-card-top">
            <span class="zone-name">${escapeHtml(zone.nombre)}</span>
            <span class="zone-tag">${isSelected ? 'ACTIVO' : `SIM #${zone.id}`}</span>
          </div>
          <p class="zone-desc">${escapeHtml(zone.descripcion || 'Simulador profesional con telemetría en tiempo real')}</p>
        </div>
        <div class="zone-footer">
          <span class="text-muted">Disponible hoy</span>
          <span class="capacity-pill">Máx. ${zone.capacidad} jug.</span>
        </div>
      `;

      card.addEventListener('click', () => {
        state.selectedZone = zone;
        state.selectedSlot = null;
        els.clientPlayers.max = String(zone.capacidad);
        if (parseInt(els.clientPlayers.value, 10) > zone.capacidad) {
          els.clientPlayers.value = String(zone.capacidad);
        }
        setAlert(els.formFeedback, '');
        renderZones();
        updateSummary();
        loadDayAvailability();
      });

      els.zonesContainer.appendChild(card);
    });
  }

  async function loadDayAvailability() {
    if (!state.selectedZone || !state.selectedDate) {
      els.slotsContainer.innerHTML =
        '<div class="empty-state">Seleccioná un simulador y una fecha para ver los horarios disponibles.</div>';
      return;
    }

    if (state.availAbortCtrl) {
      state.availAbortCtrl.abort();
    }
    state.availAbortCtrl = new AbortController();

    els.slotsContainer.innerHTML =
      '<div class="empty-state">Consultando disponibilidad en tiempo real...</div>';

    const [year, month, day] = state.selectedDate.split('-').map(Number);
    const dayStart = new Date(year, month - 1, day, 0, 0, 0);
    const dayEnd = new Date(year, month - 1, day, 23, 59, 59);

    try {
      const url = `/api/reservations/availability/${state.selectedZone.id}?start=${encodeURIComponent(
        dayStart.toISOString()
      )}&end=${encodeURIComponent(dayEnd.toISOString())}`;

      const res = await fetch(url, { signal: state.availAbortCtrl.signal });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al consultar la disponibilidad.');
      }

      state.occupiedRanges = (data.conflicts || []).map((c) => ({
        id: c.id,
        start: new Date(c.inicio).getTime(),
        end: new Date(c.fin).getTime(),
        estado: c.estado,
      }));

      renderSlots();
    } catch (err) {
      if (err.name === 'AbortError') return;
      els.slotsContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(
        err.message || 'No se pudo cargar la disponibilidad.'
      )}</div>`;
    }
  }

  function renderSlots() {
    if (!state.selectedZone || !state.selectedDate) return;

    const [year, month, day] = state.selectedDate.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const dayCfg = state.settings.schedule?.[dayOfWeek] || { open: true, start: 10, end: 23 };

    if (!dayCfg.open) {
      els.slotsContainer.innerHTML = `<div class="empty-state">Victory Simulator permanece cerrado los ${FULL_DAY_NAMES[dayOfWeek]}. Elegí otra fecha en la barra superior.</div>`;
      return;
    }

    const nowMs = Date.now();
    const durationMs = state.durationMinutes * 60 * 1000;
    const durationHours = state.durationMinutes / 60;
    const bufferMs = (Number(state.settings.resetBufferMinutes) || 0) * 60 * 1000;

    const grid = document.createElement('div');
    grid.className = 'slots-grid';
    let availableCount = 0;

    for (let hour = dayCfg.start; hour <= dayCfg.end - durationHours; hour++) {
      const slotStart = new Date(year, month - 1, day, hour, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      const startMs = slotStart.getTime();
      const endMs = slotEnd.getTime();

      const isPast = startMs <= nowMs;
      const conflict = state.occupiedRanges.find(
        (r) => startMs < r.end + bufferMs && endMs + bufferMs > r.start
      );

      const startStr = `${String(hour).padStart(2, '0')}:00`;
      const endHour = slotEnd.getHours() === 0 ? 24 : slotEnd.getHours();
      const endStr = `${String(endHour).padStart(2, '0')}:00`;
      const label = `${startStr} – ${endStr}`;

      const btn = document.createElement('button');
      btn.type = 'button';

      const isSelected =
        state.selectedSlot && state.selectedSlot.startIso === slotStart.toISOString();

      if (conflict) {
        btn.disabled = true;
        btn.className = `slot-btn ${conflict.estado === 'pendiente' ? 'pending' : 'occupied'}`;
        btn.innerHTML = `<span>${label}</span><small>${
          conflict.estado === 'pendiente' ? 'Pendiente' : 'Ocupado'
        }</small>`;
      } else if (isPast) {
        btn.disabled = true;
        btn.className = 'slot-btn past';
        btn.innerHTML = `<span>${label}</span><small>Pasado</small>`;
      } else {
        availableCount += 1;
        btn.className = `slot-btn ${isSelected ? 'selected' : ''}`;
        btn.innerHTML = `<span>${label}</span><small>${isSelected ? 'Seleccionado' : 'Disponible'}</small>`;
        btn.addEventListener('click', () => {
          state.selectedSlot = {
            startIso: slotStart.toISOString(),
            endIso: slotEnd.toISOString(),
            label,
          };
          setAlert(els.formFeedback, '');
          renderSlots();
          updateSummary();
        });
      }

      grid.appendChild(btn);
    }

    els.slotsContainer.innerHTML = '';
    els.slotsContainer.appendChild(grid);

    if (availableCount === 0) {
      const notice = document.createElement('div');
      notice.className = 'alert alert-warning';
      notice.textContent =
        'No quedan turnos disponibles para esta fecha y duración. Probá seleccionar otra fecha o reducir la duración.';
      els.slotsContainer.prepend(notice);
    }
  }

  function renderBoardingPass(reservation, meta) {
    const code = `VS-${String(reservation.id).padStart(4, '0')}`;
    els.confirmationContainer.innerHTML = `
      <div class="boarding-pass" role="status">
        <div class="boarding-pass-header">
          <div class="boarding-pass-title">Turno Solicitado</div>
          <span class="boarding-code">${escapeHtml(code)}</span>
        </div>
        <p class="boarding-desc">
          Tu bloque quedó reservado en estado pendiente de confirmación por el equipo de Victory Simulator.
        </p>
        <div class="summary-row">
          <span class="summary-label">Estado</span>
          <span class="badge badge-pendiente">${escapeHtml(reservation.estado)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Simulador</span>
          <span class="summary-value">${escapeHtml(meta.zoneName)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Fecha y Bloque</span>
          <span class="summary-value mono">${escapeHtml(meta.dateLabel)} · ${escapeHtml(meta.slotLabel)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Piloto</span>
          <span class="summary-value">${escapeHtml(meta.nombre)} (${meta.jugadores} pil.)</span>
        </div>
        <div class="boarding-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="copyCodeBtn">Copiar código ${escapeHtml(code)}</button>
          <button type="button" class="btn btn-emerald btn-sm" id="copyTrackLinkBtn">Copiar link de seguimiento</button>
        </div>
      </div>
    `;

    const copyBtn = document.getElementById('copyCodeBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          showToast(`Código ${code} copiado al portapapeles.`);
        } catch {
          showToast(`Tu código de reserva es ${code}`, 'warning');
        }
      });
    }

    const copyLinkBtn = document.getElementById('copyTrackLinkBtn');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', async () => {
        const trackUrl = `${window.location.origin}/?turno=${encodeURIComponent(code)}`;
        try {
          await navigator.clipboard.writeText(trackUrl);
          showToast('Link de seguimiento copiado. Guardalo para ver cuando se confirme.');
        } catch {
          showToast(`Link: ${trackUrl}`, 'warning');
        }
      });
    }
  }

  els.reservationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert(els.formFeedback, '');
    els.confirmationContainer.innerHTML = '';

    if (!state.selectedZone || !state.selectedSlot) {
      setAlert(els.formFeedback, 'Seleccioná un simulador y un horario disponible antes de enviar.', 'warning');
      return;
    }

    const nombre = els.clientName.value.trim();
    const contacto = els.clientContact.value.trim();
    const jugadores = parseInt(els.clientPlayers.value, 10);
    const metodoPago = els.clientPayment ? els.clientPayment.value : 'Efectivo en el local';
    const notas = els.clientNotes.value.trim();

    if (nombre.length < 2) {
      setAlert(els.formFeedback, 'Ingresá tu nombre y apellido (mínimo 2 caracteres).', 'error');
      els.clientName.focus();
      return;
    }
    if (contacto.length < 4) {
      setAlert(els.formFeedback, 'Ingresá un teléfono o email de contacto válido.', 'error');
      els.clientContact.focus();
      return;
    }
    if (!Number.isInteger(jugadores) || jugadores < 1 || jugadores > state.selectedZone.capacidad) {
      setAlert(
        els.formFeedback,
        `La cantidad de pilotos debe estar entre 1 y ${state.selectedZone.capacidad}.`,
        'error'
      );
      els.clientPlayers.focus();
      return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = 'Confirmando disponibilidad...';

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zoneId: state.selectedZone.id,
          start: state.selectedSlot.startIso,
          end: state.selectedSlot.endIso,
          nombre,
          contacto,
          jugadores,
          metodoPago,
          notas,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setAlert(
          els.formFeedback,
          data.error || 'Ese horario acaba de ocuparse. Actualizamos la grilla para que elijas otro.',
          'warning'
        );
        state.selectedSlot = null;
        updateSummary();
        await loadDayAvailability();
        return;
      }

      if (res.status === 429) {
        setAlert(els.formFeedback, data.error || 'Demasiadas solicitudes. Esperá unos minutos.', 'warning');
        return;
      }

      if (!res.ok) {
        setAlert(els.formFeedback, data.error || 'No se pudo procesar tu solicitud.', 'error');
        return;
      }

      const meta = {
        zoneName: data.reservation?.zona_nombre || state.selectedZone.nombre,
        dateLabel: formatHumanDate(state.selectedDate),
        slotLabel: state.selectedSlot.label,
        nombre,
        jugadores,
      };

      state.selectedSlot = null;
      els.reservationForm.reset();
      els.clientPlayers.value = '1';

      renderBoardingPass(data.reservation, meta);
      showToast('¡Solicitud enviada con éxito!');
      updateSummary();
      await loadDayAvailability();
    } catch {
      setAlert(els.formFeedback, 'Error de red al enviar la solicitud. Intentá nuevamente.', 'error');
    } finally {
      els.submitBtn.textContent = 'Solicitar Reserva Ahora';
      updateSummary();
    }
  });

  if (els.refreshZonesBtn) {
    els.refreshZonesBtn.addEventListener('click', () => {
      loadZones();
      showToast('Simuladores actualizados.', 'success');
    });
  }

  function applyDynamicSettingsToUI() {
    const s = state.settings;
    // Mostrar/ocultar sección de cumpleaños y actualizar link de WhatsApp
    const eventsSec = document.getElementById('cumpleanos');
    if (eventsSec) {
      eventsSec.classList.toggle('is-hidden', s.showBirthdaysSection === false);
      const waLink = eventsSec.querySelector('.btn-whatsapp');
      if (waLink && s.whatsappNumber) {
        const msg = encodeURIComponent(s.whatsappBirthdayText || `Hola ${s.brandName || 'Victory Simulator'}! Quiero consultar por un cumpleaños.`);
        waLink.href = `https://wa.me/${s.whatsappNumber}?text=${msg}`;
      }
    }

    // Regenerar botones de duración según allowedDurations
    if (Array.isArray(s.allowedDurations) && s.allowedDurations.length > 0 && els.durationPills) {
      if (!s.allowedDurations.includes(state.durationMinutes)) {
        state.durationMinutes = s.allowedDurations[0];
      }
      els.durationPills.innerHTML = '';
      s.allowedDurations.forEach((mins) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `duration-btn ${state.durationMinutes === mins ? 'selected' : ''}`;
        btn.dataset.minutes = String(mins);
        btn.textContent = mins >= 60 ? `${mins / 60} h` : `${mins} m`;
        btn.addEventListener('click', () => {
          state.durationMinutes = mins;
          state.selectedSlot = null;
          els.durationPills.querySelectorAll('.duration-btn').forEach((b) =>
            b.classList.toggle('selected', b === btn)
          );
          updateSummary();
          renderSlots();
        });
        els.durationPills.appendChild(btn);
      });
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/reservations/settings');
      if (!res.ok) return;
      const data = await res.json();
      if (data.settings) {
        state.settings = data.settings;
        applyDynamicSettingsToUI();
      }
    } catch {
      // Usar valores por defecto si falla
    }
  }

  function initPlayersStepper() {
    const sync = (delta) => {
      const maxCap = state.selectedZone?.capacidad || 20;
      const curr = parseInt(els.clientPlayers.value, 10) || 1;
      const next = Math.min(maxCap, Math.max(1, curr + delta));
      els.clientPlayers.value = String(next);
      updateSummary();
    };
    els.playersDecBtn.addEventListener('click', () => sync(-1));
    els.playersIncBtn.addEventListener('click', () => sync(1));
    els.clientPlayers.addEventListener('input', updateSummary);
  }

  async function lookupStatus(codeValue) {
    const code = String(codeValue || '').trim();
    if (!code) {
      setAlert(els.lookupResult, 'Ingresá tu código de reserva (ej. VS-0001).', 'warning');
      return;
    }

    els.lookupSubmitBtn.disabled = true;
    els.lookupSubmitBtn.textContent = 'Buscando...';
    els.lookupResult.innerHTML = '';

    try {
      const res = await fetch(`/api/reservations/status/${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAlert(els.lookupResult, data.error || 'No se encontró el turno.', 'error');
        return;
      }

      const r = data.reservation;
      const statusMessages = {
        pendiente: 'Tu solicitud está pendiente de confirmación por el equipo de Victory Simulator.',
        confirmada: '¡Tu turno está CONFIRMADO! Te esperamos en Victory Simulator.',
        rechazada: 'Esta solicitud fue rechazada. Podés elegir otro horario disponible arriba.',
        cancelada: 'Este turno fue cancelado y el horario quedó liberado.',
        expirada: 'Esta solicitud venció antes de ser confirmada.',
      };

      const startFmt = new Date(r.inicio).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const endFmt = new Date(r.fin).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      els.lookupResult.innerHTML = `
        <div class="lookup-result-box" role="status">
          <p class="lookup-status-msg">${escapeHtml(statusMessages[r.estado] || r.estado)}</p>
          <div class="summary-row">
            <span class="summary-label">Código</span>
            <span class="summary-value mono">${escapeHtml(r.code)}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Estado</span>
            <span class="badge badge-${escapeHtml(r.estado)}">${escapeHtml(r.estado)}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Simulador</span>
            <span class="summary-value">${escapeHtml(r.zona_nombre || 'Simulador')}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Horario</span>
            <span class="summary-value mono">${escapeHtml(startFmt)} – ${escapeHtml(endFmt)}</span>
          </div>
        </div>
      `;
    } catch {
      setAlert(els.lookupResult, 'Error de conexión al consultar el turno.', 'error');
    } finally {
      els.lookupSubmitBtn.disabled = false;
      els.lookupSubmitBtn.textContent = 'Consultar Estado';
    }
  }

  if (els.statusLookupForm) {
    els.statusLookupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      lookupStatus(els.lookupCodeInput.value);
    });
  }

  // Inicialización
  initScheduleControls();
  initPlayersStepper();
  checkHealth();
  loadSettings().then(() => loadZones());

  // Si el usuario abrió un link de seguimiento (?turno=VS-0001), consultar automáticamente
  const urlTurno = new URLSearchParams(window.location.search).get('turno');
  if (urlTurno && els.lookupCodeInput) {
    els.lookupCodeInput.value = urlTurno;
    lookupStatus(urlTurno);
  }
})();
