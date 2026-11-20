/* ==========================================================================
   VICTORY SIMULATOR — Command Center (Lógica Administrativa)
   ========================================================================== */

(() => {
  let csrfToken = '';
  let zonesCache = [];
  let reservationsCache = [];
  let settingsCache = null;
  let pendingModalAction = null;

  const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  const els = {
    adminUserChip: document.getElementById('adminUserChip'),
    logoutBtn: document.getElementById('logoutBtn'),
    loginSection: document.getElementById('loginSection'),
    dashboardSection: document.getElementById('dashboardSection'),
    loginForm: document.getElementById('loginForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginSubmitBtn: document.getElementById('loginSubmitBtn'),
    loginFeedback: document.getElementById('loginFeedback'),
    kpiPending: document.getElementById('kpiPending'),
    kpiConfirmed: document.getElementById('kpiConfirmed'),
    kpiCancelled: document.getElementById('kpiCancelled'),
    kpiExpired: document.getElementById('kpiExpired'),
    kpiZones: document.getElementById('kpiZones'),
    refreshAllBtn: document.getElementById('refreshAllBtn'),
    filterDate: document.getElementById('filterDate'),
    filterZone: document.getElementById('filterZone'),
    filterStatus: document.getElementById('filterStatus'),
    filterSearch: document.getElementById('filterSearch'),
    applyFiltersBtn: document.getElementById('applyFiltersBtn'),
    clearFiltersBtn: document.getElementById('clearFiltersBtn'),
    reservationsTbody: document.getElementById('reservationsTbody'),
    zoneForm: document.getElementById('zoneForm'),
    zoneFormTitle: document.getElementById('zoneFormTitle'),
    editZoneId: document.getElementById('editZoneId'),
    zoneName: document.getElementById('zoneName'),
    zoneDesc: document.getElementById('zoneDesc'),
    zoneCap: document.getElementById('zoneCap'),
    zoneSaveBtn: document.getElementById('zoneSaveBtn'),
    zoneCancelEditBtn: document.getElementById('zoneCancelEditBtn'),
    zonesTbody: document.getElementById('zonesTbody'),
    confirmModal: document.getElementById('confirmModal'),
    confirmModalTitle: document.getElementById('confirmModalTitle'),
    confirmModalBody: document.getElementById('confirmModalBody'),
    confirmModalCancel: document.getElementById('confirmModalCancel'),
    confirmModalOk: document.getElementById('confirmModalOk'),
    toastContainer: document.getElementById('toastContainer'),
    manualResForm: document.getElementById('manualResForm'),
    manualZone: document.getElementById('manualZone'),
    manualDate: document.getElementById('manualDate'),
    manualStartTime: document.getElementById('manualStartTime'),
    manualDuration: document.getElementById('manualDuration'),
    manualStatus: document.getElementById('manualStatus'),
    manualName: document.getElementById('manualName'),
    manualContact: document.getElementById('manualContact'),
    manualPlayers: document.getElementById('manualPlayers'),
    manualNotes: document.getElementById('manualNotes'),
    manualResSubmitBtn: document.getElementById('manualResSubmitBtn'),
    manualMaintCheck: document.getElementById('manualMaintCheck'),
    timelineDate: document.getElementById('timelineDate'),
    timelineRefreshBtn: document.getElementById('timelineRefreshBtn'),
    timelineContainer: document.getElementById('timelineContainer'),
    settingsForm: document.getElementById('settingsForm'),
    setBasePrice: document.getElementById('setBasePrice'),
    setExtraPlayer: document.getElementById('setExtraPlayer'),
    setGroupThreshold: document.getElementById('setGroupThreshold'),
    setGroupDiscount: document.getElementById('setGroupDiscount'),
    setMultiHourDiscount: document.getElementById('setMultiHourDiscount'),
    setBuffer: document.getElementById('setBuffer'),
    scheduleGrid: document.getElementById('scheduleGrid'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    rescheduleModal: document.getElementById('rescheduleModal'),
    rescheduleForm: document.getElementById('rescheduleForm'),
    reschedId: document.getElementById('reschedId'),
    reschedZone: document.getElementById('reschedZone'),
    reschedDate: document.getElementById('reschedDate'),
    reschedTime: document.getElementById('reschedTime'),
    reschedDuration: document.getElementById('reschedDuration'),
    reschedCancelBtn: document.getElementById('reschedCancelBtn'),
    reschedSaveBtn: document.getElementById('reschedSaveBtn'),
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('es-AR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function getAuthHeaders(includeJson = true) {
    const headers = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    return headers;
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function setLoginFeedback(msg, type = 'error') {
    if (!msg) {
      els.loginFeedback.innerHTML = '';
      return;
    }
    els.loginFeedback.innerHTML = `<div class="alert alert-${type}" role="alert"><span>${escapeHtml(msg)}</span></div>`;
  }

  function openConfirmModal(title, body, onConfirm) {
    els.confirmModalTitle.textContent = title;
    els.confirmModalBody.textContent = body;
    pendingModalAction = onConfirm;
    els.confirmModal.classList.remove('is-hidden');
  }

  function closeConfirmModal() {
    els.confirmModal.classList.add('is-hidden');
    pendingModalAction = null;
  }

  els.confirmModalCancel.addEventListener('click', closeConfirmModal);
  els.confirmModalOk.addEventListener('click', async () => {
    const action = pendingModalAction;
    closeConfirmModal();
    if (typeof action === 'function') {
      await action();
    }
  });

  function showLoginView(errorMsg = '') {
    els.loginSection.classList.remove('is-hidden');
    els.dashboardSection.classList.add('is-hidden');
    els.logoutBtn.classList.add('is-hidden');
    els.adminUserChip.classList.add('is-hidden');
    setLoginFeedback(errorMsg, errorMsg ? 'error' : '');
  }

  function showDashboardView(user) {
    els.loginSection.classList.add('is-hidden');
    els.dashboardSection.classList.remove('is-hidden');
    els.logoutBtn.classList.remove('is-hidden');
    els.adminUserChip.textContent = `${user.nombre} · ${user.email}`;
    els.adminUserChip.classList.remove('is-hidden');
    refreshAll();
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        showLoginView();
        return;
      }
      const data = await res.json();
      if (!data.user || data.user.rol !== 'admin') {
        showLoginView('La cuenta actual no posee permisos de administrador.');
        return;
      }
      csrfToken = data.csrfToken || '';
      showDashboardView(data.user);
    } catch {
      showLoginView('No se pudo conectar con el servidor.');
    }
  }

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoginFeedback('');

    const email = els.loginEmail.value.trim();
    const password = els.loginPassword.value;

    if (!email || !password) {
      setLoginFeedback('Ingresá tu correo electrónico y contraseña.');
      return;
    }

    els.loginSubmitBtn.disabled = true;
    els.loginSubmitBtn.textContent = 'Verificando credenciales...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLoginFeedback(data.error || 'No se pudo iniciar sesión.');
        return;
      }

      csrfToken = data.csrfToken || '';
      els.loginPassword.value = '';
      showToast(`Bienvenido, ${data.user.nombre}`);
      showDashboardView(data.user);
    } catch {
      setLoginFeedback('Error de red al intentar iniciar sesión.');
    } finally {
      els.loginSubmitBtn.disabled = false;
      els.loginSubmitBtn.textContent = 'Ingresar al Command Center';
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } finally {
      csrfToken = '';
      showToast('Sesión cerrada correctamente.');
      showLoginView();
    }
  });

  async function refreshAll() {
    await Promise.all([loadSummary(), loadZones(), loadReservations(), loadSettings()]);
    await loadTimeline();
  }

  async function loadSummary() {
    try {
      const res = await fetch('/api/admin/summary');
      if (res.status === 401) return showLoginView('Tu sesión expiró. Ingresá nuevamente.');
      if (!res.ok) return;
      const data = await res.json();
      els.kpiPending.textContent = String(data.byStatus?.pendiente ?? 0);
      els.kpiConfirmed.textContent = String(data.byStatus?.confirmada ?? 0);
      els.kpiCancelled.textContent = String((data.byStatus?.cancelada ?? 0) + (data.byStatus?.rechazada ?? 0));
      els.kpiExpired.textContent = String(data.byStatus?.expirada ?? 0);
      els.kpiZones.textContent = `${data.zonas?.activas ?? 0} / ${data.zonas?.total ?? 0}`;
    } catch {
      // Silencioso en resumen
    }
  }

  async function loadZones() {
    try {
      const res = await fetch('/api/admin/zones');
      if (res.status === 401) return showLoginView('Tu sesión expiró. Ingresá nuevamente.');
      const data = await res.json();
      zonesCache = data.zones || [];

      const currentFilterVal = els.filterZone.value;
      const currentManualVal = els.manualZone.value;
      els.filterZone.innerHTML = '<option value="">Todos los simuladores</option>';
      els.manualZone.innerHTML = '<option value="">Seleccionar simulador...</option>';
      zonesCache.forEach((z) => {
        const opt = document.createElement('option');
        opt.value = String(z.id);
        opt.textContent = `${z.nombre} (#${z.id})`;
        els.filterZone.appendChild(opt);

        if (z.active) {
          const optManual = document.createElement('option');
          optManual.value = String(z.id);
          optManual.textContent = `${z.nombre} (máx. ${z.capacidad} pil.)`;
          els.manualZone.appendChild(optManual);
        }
      });
      els.filterZone.value = currentFilterVal;
      if (currentManualVal) els.manualZone.value = currentManualVal;

      if (zonesCache.length === 0) {
        els.zonesTbody.innerHTML =
          '<tr><td colspan="6" class="empty-cell">No hay simuladores registrados todavía.</td></tr>';
        return;
      }

      els.zonesTbody.innerHTML = '';
      zonesCache.forEach((z) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">#${z.id}</td>
          <td><strong>${escapeHtml(z.nombre)}</strong></td>
          <td class="text-secondary">${escapeHtml(z.descripcion || '—')}</td>
          <td class="mono">${z.capacidad} pil.</td>
          <td>
            <span class="badge ${z.active ? 'badge-confirmada' : 'badge-expirada'}">
              ${z.active ? 'Activo' : 'Inactivo'}
            </span>
          </td>
          <td>
            <div class="actions-group">
              <button type="button" class="btn btn-secondary btn-sm" data-edit-zone="${z.id}">Editar</button>
              <button type="button" class="btn ${z.active ? 'btn-warning' : 'btn-emerald'} btn-sm" data-toggle-zone="${z.id}" data-next-active="${!z.active}">
                ${z.active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </td>
        `;
        els.zonesTbody.appendChild(tr);
      });
    } catch {
      els.zonesTbody.innerHTML =
        '<tr><td colspan="6" class="empty-cell">Error al cargar los simuladores.</td></tr>';
    }
  }

  function startEditZone(zoneId) {
    const z = zonesCache.find((item) => item.id === zoneId);
    if (!z) return;
    els.editZoneId.value = String(z.id);
    els.zoneName.value = z.nombre;
    els.zoneDesc.value = z.descripcion || '';
    els.zoneCap.value = String(z.capacidad);
    els.zoneFormTitle.textContent = `Editando Simulador #${z.id}`;
    els.zoneSaveBtn.textContent = 'Actualizar Simulador';
    els.zoneCancelEditBtn.classList.remove('is-hidden');
    els.zoneName.focus();
  }

  function resetZoneForm() {
    els.editZoneId.value = '';
    els.zoneForm.reset();
    els.zoneCap.value = '4';
    els.zoneFormTitle.textContent = 'Nuevo Simulador / Zona';
    els.zoneSaveBtn.textContent = 'Guardar Simulador';
    els.zoneCancelEditBtn.classList.add('is-hidden');
  }

  els.zoneCancelEditBtn.addEventListener('click', resetZoneForm);

  els.zoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = els.editZoneId.value;
    const nombre = els.zoneName.value.trim();
    const descripcion = els.zoneDesc.value.trim();
    const capacidad = parseInt(els.zoneCap.value, 10);

    if (!nombre) {
      showToast('El nombre del simulador es obligatorio.', 'error');
      return;
    }
    if (!Number.isInteger(capacidad) || capacidad <= 0) {
      showToast('La capacidad debe ser un entero positivo.', 'error');
      return;
    }

    const url = editId ? `/api/admin/zones/${editId}` : '/api/admin/zones';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({ nombre, descripcion, capacidad }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'No se pudo guardar el simulador.', 'error');
        return;
      }
      showToast(editId ? 'Simulador actualizado correctamente.' : 'Simulador creado correctamente.');
      resetZoneForm();
      await Promise.all([loadZones(), loadSummary()]);
    } catch {
      showToast('Error de red al guardar el simulador.', 'error');
    }
  });

  els.zonesTbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-zone]');
    if (editBtn) {
      startEditZone(parseInt(editBtn.dataset.editZone, 10));
      return;
    }

    const toggleBtn = e.target.closest('[data-toggle-zone]');
    if (toggleBtn) {
      const zoneId = parseInt(toggleBtn.dataset.toggleZone, 10);
      const nextActive = toggleBtn.dataset.nextActive === 'true';
      try {
        const res = await fetch(`/api/admin/zones/${zoneId}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ active: nextActive }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error || 'No se pudo cambiar el estado.', 'error');
          return;
        }
        showToast(`Simulador #${zoneId} ${nextActive ? 'activado' : 'desactivado'}.`);
        await Promise.all([loadZones(), loadSummary()]);
      } catch {
        showToast('Error de red al actualizar el simulador.', 'error');
      }
    }
  });

  async function loadReservations() {
    const params = new URLSearchParams();
    if (els.filterDate.value) params.set('date', els.filterDate.value);
    if (els.filterZone.value) params.set('zoneId', els.filterZone.value);
    if (els.filterStatus.value) params.set('estado', els.filterStatus.value);

    try {
      const res = await fetch(`/api/admin/reservations?${params.toString()}`);
      if (res.status === 401) return showLoginView('Tu sesión expiró. Ingresá nuevamente.');
      const data = await res.json();
      if (!res.ok) {
        els.reservationsTbody.innerHTML = `<tr><td colspan="7" class="empty-cell">${escapeHtml(
          data.error || 'Error al cargar reservas.'
        )}</td></tr>`;
        return;
      }

      reservationsCache = data.reservations || [];
      renderReservationsTable();
    } catch {
      els.reservationsTbody.innerHTML =
        '<tr><td colspan="7" class="empty-cell">Error de red al consultar reservas.</td></tr>';
    }
  }

  function renderReservationsTable() {
    const term = els.filterSearch.value.trim().toLowerCase();
    const list = term
      ? reservationsCache.filter((r) => {
          const code = `vs-${String(r.id).padStart(4, '0')}`;
          const hay = `${r.id} ${code} ${r.zona_nombre || ''} ${r.notas || ''} ${r.estado}`.toLowerCase();
          return hay.includes(term);
        })
      : reservationsCache;

    if (list.length === 0) {
      els.reservationsTbody.innerHTML =
        '<tr><td colspan="7" class="empty-cell">No se encontraron reservas con los filtros aplicados.</td></tr>';
      return;
    }

    els.reservationsTbody.innerHTML = '';
    list.forEach((r) => {
      const tr = document.createElement('tr');
      const code = `VS-${String(r.id).padStart(4, '0')}`;
      let actionsHtml = '<span class="text-muted">Sin acciones</span>';

      if (r.estado === 'pendiente') {
        actionsHtml = `
          <div class="actions-group">
            <button type="button" class="btn btn-emerald btn-sm" data-res-action="confirm" data-res-id="${r.id}">Confirmar</button>
            <button type="button" class="btn btn-secondary btn-sm" data-res-action="reschedule" data-res-id="${r.id}">Reprogramar</button>
            <button type="button" class="btn btn-danger btn-sm" data-res-action="reject" data-res-id="${r.id}">Rechazar</button>
          </div>
        `;
      } else if (r.estado === 'confirmada') {
        actionsHtml = `
          <div class="actions-group">
            <button type="button" class="btn btn-secondary btn-sm" data-res-action="reschedule" data-res-id="${r.id}">Reprogramar</button>
            <button type="button" class="btn btn-danger btn-sm" data-res-action="cancel" data-res-id="${r.id}">Cancelar</button>
          </div>
        `;
      }

      tr.innerHTML = `
        <td class="mono"><strong>${escapeHtml(code)}</strong></td>
        <td>${escapeHtml(r.zona_nombre || `Simulador #${r.zona_id}`)}</td>
        <td class="mono">${escapeHtml(formatDateTime(r.inicio))}</td>
        <td class="mono">${escapeHtml(formatDateTime(r.fin))}</td>
        <td><span class="badge badge-${escapeHtml(r.estado)}">${escapeHtml(r.estado)}</span></td>
        <td class="notes-cell">${escapeHtml(r.notas || 'Sin notas')}</td>
        <td>${actionsHtml}</td>
      `;
      els.reservationsTbody.appendChild(tr);
    });
  }

  async function executeReservationAction(id, action) {
    let url = `/api/reservations/${id}`;
    let method = 'DELETE';
    if (action === 'confirm') {
      url = `/api/reservations/${id}/confirm`;
      method = 'PUT';
    } else if (action === 'reject') {
      url = `/api/reservations/${id}/reject`;
      method = 'PUT';
    }

    try {
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'No se pudo completar la operación.', 'error');
      } else {
        showToast(`${data.message || 'Operación exitosa'} (VS-${String(id).padStart(4, '0')}).`);
      }
      await Promise.all([loadReservations(), loadSummary()]);
    } catch {
      showToast('Error de red al ejecutar la acción.', 'error');
    }
  }

  els.reservationsTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-res-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.resId, 10);
    const action = btn.dataset.resAction;
    const code = `VS-${String(id).padStart(4, '0')}`;

    if (action === 'confirm') {
      executeReservationAction(id, 'confirm');
    } else if (action === 'reschedule') {
      openRescheduleModal(id);
    } else if (action === 'reject') {
      openConfirmModal(
        `Rechazar solicitud ${code}`,
        'Esta solicitud pasará a estado rechazada y el horario quedará libre inmediatamente. ¿Deseás continuar?',
        () => executeReservationAction(id, 'reject')
      );
    } else if (action === 'cancel') {
      openConfirmModal(
        `Cancelar reserva ${code}`,
        'Se cancelará la reserva confirmada y el horario volverá a quedar disponible para otros pilotos. ¿Confirmás la cancelación?',
        () => executeReservationAction(id, 'cancel')
      );
    }
  });

  els.applyFiltersBtn.addEventListener('click', loadReservations);
  els.filterSearch.addEventListener('input', renderReservationsTable);
  els.clearFiltersBtn.addEventListener('click', () => {
    els.filterDate.value = '';
    els.filterZone.value = '';
    els.filterStatus.value = '';
    els.filterSearch.value = '';
    loadReservations();
  });
  els.refreshAllBtn.addEventListener('click', () => {
    refreshAll();
    showToast('Datos actualizados.');
  });

  // Inicializar fecha por defecto del formulario manual y de la agenda visual (hoy)
  const todayObj = new Date();
  const todayYmd = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
  if (els.manualDate) els.manualDate.value = todayYmd;
  if (els.timelineDate) els.timelineDate.value = todayYmd;

  // Toggle de bloqueo por mantenimiento
  els.manualMaintCheck.addEventListener('change', () => {
    const isMaint = els.manualMaintCheck.checked;
    if (isMaint) {
      els.manualStatus.value = 'confirmada';
      els.manualName.value = '[MANTENIMIENTO]';
      els.manualPlayers.value = '1';
      els.manualResSubmitBtn.textContent = 'Bloquear por Mantenimiento';
    } else {
      if (els.manualName.value === '[MANTENIMIENTO]') els.manualName.value = '';
      els.manualResSubmitBtn.textContent = 'Crear Turno';
    }
  });

  // Agenda Visual (Timeline)
  async function loadTimeline() {
    const dateVal = els.timelineDate?.value || todayYmd;
    if (!zonesCache.length) {
      els.timelineContainer.innerHTML = '<div class="empty-cell">Creá al menos un simulador para ver la agenda visual.</div>';
      return;
    }

    try {
      const res = await fetch(`/api/admin/reservations?date=${encodeURIComponent(dateVal)}`);
      if (!res.ok) return;
      const data = await res.json();
      const dayRes = (data.reservations || []).filter((r) => ['pendiente', 'confirmada'].includes(r.estado));

      const [year, month, day] = dateVal.split('-').map(Number);
      const dow = new Date(year, month - 1, day).getDay();
      const sched = settingsCache?.schedule?.[dow] || { open: true, start: 10, end: 23 };
      const startH = sched.start ?? 10;
      const endH = sched.end ?? 23;

      let html = '<table class="timeline-table"><thead><tr><th>Simulador</th>';
      for (let h = startH; h < endH; h++) {
        html += `<th class="mono">${String(h).padStart(2, '0')}:00</th>`;
      }
      html += '</tr></thead><tbody>';

      zonesCache.forEach((z) => {
        html += `<tr><td>${escapeHtml(z.nombre)}${z.active ? '' : ' (Inactivo)'}</td>`;
        for (let h = startH; h < endH; h++) {
          const slotStart = new Date(year, month - 1, day, h, 0, 0).getTime();
          const slotEnd = new Date(year, month - 1, day, h + 1, 0, 0).getTime();
          const match = dayRes.find((r) => {
            if (r.zona_id !== z.id) return false;
            const rs = new Date(r.inicio).getTime();
            const re = new Date(r.fin).getTime();
            return slotStart < re && slotEnd > rs;
          });

          if (!match) {
            html += `<td class="tl-cell-free" data-tl-zone="${z.id}" data-tl-hour="${String(h).padStart(2, '0')}:00" title="Clic para crear turno">Libre</td>`;
          } else {
            const isMaint = String(match.notas || '').includes('[MANTENIMIENTO]');
            const cls = isMaint
              ? 'tl-cell-maint'
              : match.estado === 'confirmada'
                ? 'tl-cell-confirmed'
                : 'tl-cell-pending';
            const lbl = isMaint ? 'MANT' : `VS-${String(match.id).padStart(4, '0')}`;
            html += `<td class="${cls}" title="${escapeHtml(match.notas || '')}">${lbl}</td>`;
          }
        }
        html += '</tr>';
      });

      html += '</tbody></table>';
      els.timelineContainer.innerHTML = html;
    } catch {
      els.timelineContainer.innerHTML = '<div class="empty-cell">Error al cargar la agenda visual.</div>';
    }
  }

  els.timelineContainer.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-tl-zone]');
    if (!cell) return;
    els.manualZone.value = cell.dataset.tlZone;
    els.manualDate.value = els.timelineDate.value || todayYmd;
    els.manualStartTime.value = cell.dataset.tlHour;
    els.manualName.focus();
    showToast(`Horario ${cell.dataset.tlHour} precargado en el formulario.`);
  });

  els.timelineDate.addEventListener('change', loadTimeline);
  els.timelineRefreshBtn.addEventListener('click', loadTimeline);

  // Modal de Reprogramación
  function openRescheduleModal(reservationId) {
    const r = reservationsCache.find((item) => item.id === reservationId);
    if (!r) return;
    els.reschedId.value = String(r.id);
    els.reschedZone.innerHTML = '';
    zonesCache.forEach((z) => {
      const opt = document.createElement('option');
      opt.value = String(z.id);
      opt.textContent = `${z.nombre} (#${z.id})`;
      els.reschedZone.appendChild(opt);
    });
    els.reschedZone.value = String(r.zona_id);

    const startDt = new Date(r.inicio);
    const endDt = new Date(r.fin);
    const durMin = Math.round((endDt.getTime() - startDt.getTime()) / 60000);
    els.reschedDate.value = `${startDt.getFullYear()}-${String(startDt.getMonth() + 1).padStart(2, '0')}-${String(startDt.getDate()).padStart(2, '0')}`;
    els.reschedTime.value = `${String(startDt.getHours()).padStart(2, '0')}:${String(startDt.getMinutes()).padStart(2, '0')}`;
    els.reschedDuration.value = String([60, 120, 180, 240].includes(durMin) ? durMin : 60);
    els.rescheduleModal.classList.remove('is-hidden');
  }

  els.reschedCancelBtn.addEventListener('click', () => {
    els.rescheduleModal.classList.add('is-hidden');
  });

  els.rescheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = parseInt(els.reschedId.value, 10);
    const zoneId = parseInt(els.reschedZone.value, 10);
    const dateVal = els.reschedDate.value;
    const timeVal = els.reschedTime.value;
    const durMin = parseInt(els.reschedDuration.value, 10) || 60;

    if (!dateVal || !timeVal) return showToast('Indicá la nueva fecha y hora.', 'error');

    const [y, m, d] = dateVal.split('-').map(Number);
    const [hh, mm] = timeVal.split(':').map(Number);
    const startDt = new Date(y, m - 1, d, hh, mm, 0);
    const endDt = new Date(startDt.getTime() + durMin * 60000);

    els.reschedSaveBtn.disabled = true;
    try {
      const res = await fetch(`/api/admin/reservations/${id}/reschedule`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          zoneId,
          start: startDt.toISOString(),
          end: endDt.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'No se pudo reprogramar el turno.', 'error');
        return;
      }
      els.rescheduleModal.classList.add('is-hidden');
      showToast(`Turno VS-${String(id).padStart(4, '0')} reprogramado.`);
      await Promise.all([loadReservations(), loadTimeline()]);
    } catch {
      showToast('Error de red al reprogramar.', 'error');
    } finally {
      els.reschedSaveBtn.disabled = false;
    }
  });

  // Configuración de Negocio (Precios, Descuentos, Buffer y Horarios)
  async function loadSettings() {
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) return;
      const data = await res.json();
      const s = data.settings;
      if (!s) return;
      settingsCache = s;

      els.setBasePrice.value = String(s.basePricePerHour ?? 15000);
      els.setExtraPlayer.value = String(s.extraPlayerPricePerHour ?? 4000);
      els.setGroupThreshold.value = String(s.groupDiscountThreshold ?? 3);
      els.setGroupDiscount.value = String(s.groupDiscountPercent ?? 15);
      els.setMultiHourDiscount.value = String(s.multiHourDiscountPercent ?? 10);
      els.setBuffer.value = String(s.resetBufferMinutes ?? 0);

      els.scheduleGrid.innerHTML = '';
      for (let d = 0; d <= 6; d++) {
        const dayCfg = s.schedule?.[d] || { open: true, start: 10, end: 23 };
        const card = document.createElement('div');
        card.className = 'schedule-day-card';
        card.innerHTML = `
          <label class="schedule-day-top">
            <span>${DAY_LABELS[d]}</span>
            <input type="checkbox" data-sched-open="${d}" ${dayCfg.open ? 'checked' : ''} />
          </label>
          <div class="schedule-hours">
            <input type="number" min="0" max="23" data-sched-start="${d}" value="${dayCfg.start}" aria-label="Apertura ${DAY_LABELS[d]}" />
            <input type="number" min="1" max="24" data-sched-end="${d}" value="${dayCfg.end}" aria-label="Cierre ${DAY_LABELS[d]}" />
          </div>
        `;
        els.scheduleGrid.appendChild(card);
      }
    } catch {
      // Silencioso
    }
  }

  els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const schedule = {};
    for (let d = 0; d <= 6; d++) {
      const openEl = els.scheduleGrid.querySelector(`[data-sched-open="${d}"]`);
      const startEl = els.scheduleGrid.querySelector(`[data-sched-start="${d}"]`);
      const endEl = els.scheduleGrid.querySelector(`[data-sched-end="${d}"]`);
      schedule[d] = {
        open: Boolean(openEl?.checked),
        start: parseInt(startEl?.value, 10) || 10,
        end: parseInt(endEl?.value, 10) || 23,
      };
    }

    els.saveSettingsBtn.disabled = true;
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          basePricePerHour: Number(els.setBasePrice.value) || 0,
          extraPlayerPricePerHour: Number(els.setExtraPlayer.value) || 0,
          groupDiscountThreshold: parseInt(els.setGroupThreshold.value, 10) || 3,
          groupDiscountPercent: Number(els.setGroupDiscount.value) || 0,
          multiHourDiscountPercent: Number(els.setMultiHourDiscount.value) || 0,
          resetBufferMinutes: parseInt(els.setBuffer.value, 10) || 0,
          schedule,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'No se pudo guardar la configuración.', 'error');
        return;
      }
      settingsCache = data.settings;
      showToast('Configuración de precios y horarios guardada.');
      await loadTimeline();
    } catch {
      showToast('Error de red al guardar la configuración.', 'error');
    } finally {
      els.saveSettingsBtn.disabled = false;
    }
  });

  // Envío de turno manual desde administración
  els.manualResForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const zoneId = parseInt(els.manualZone.value, 10);
    const dateVal = els.manualDate.value;
    const timeVal = els.manualStartTime.value;
    const durationMin = parseInt(els.manualDuration.value, 10) || 60;
    const estado = els.manualStatus.value;
    const nombre = els.manualName.value.trim();
    const contacto = els.manualContact.value.trim();
    const jugadores = parseInt(els.manualPlayers.value, 10) || 1;
    const notas = els.manualNotes.value.trim();

    if (!zoneId) return showToast('Seleccioná un simulador.', 'error');
    if (!dateVal || !timeVal) return showToast('Indicá fecha y hora de inicio.', 'error');
    if (!nombre) return showToast('Ingresá el nombre del piloto.', 'error');

    const [year, month, day] = dateVal.split('-').map(Number);
    const [hour, minute] = timeVal.split(':').map(Number);
    const startDate = new Date(year, month - 1, day, hour, minute, 0);
    const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

    els.manualResSubmitBtn.disabled = true;
    els.manualResSubmitBtn.textContent = 'Creando...';

    try {
      const res = await fetch('/api/admin/reservations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          zoneId,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          estado,
          nombre,
          contacto,
          jugadores,
          notas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'No se pudo crear el turno.', 'error');
        return;
      }

      const code = `VS-${String(data.reservation?.id || '').padStart(4, '0')}`;
      showToast(`Turno ${code} creado correctamente (${estado}).`);
      els.manualName.value = '';
      els.manualContact.value = '';
      els.manualNotes.value = '';
      els.manualPlayers.value = '1';
      els.manualMaintCheck.checked = false;
      els.manualResSubmitBtn.textContent = 'Crear Turno';
      await Promise.all([loadReservations(), loadSummary(), loadTimeline()]);
    } catch {
      showToast('Error de red al crear el turno manual.', 'error');
    } finally {
      els.manualResSubmitBtn.disabled = false;
      els.manualResSubmitBtn.textContent = 'Crear Turno';
    }
  });

  // Iniciar verificación de sesión
  checkSession();
})();
