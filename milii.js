// ============================================================================
// CONFIGURACIÓN DE SUPABASE (Proyecto 06 - Préstamos de Herramientas)
// Colegio Nacional E.M.D. Asunción Escalada
// ============================================================================
const SUPABASE_URL = 'https://ekgwlcopjscwuzlwsywv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Fq5OHITtfQApgRn5mPaefw_t_cJ455u';

// Interceptor para compatibilidad con las nuevas claves Publishable de Supabase (sb_publishable_*)
// Por defecto, supabase-js envía "Authorization: Bearer <clave>". Como las nuevas claves
// publishable no son JWTs, el gateway Kong de Supabase rechaza la petición con error 401 Unauthorized.
// Este wrapper retira el header Authorization cuando no es un JWT (no empieza con "Bearer eyJ"),
// permitiendo que Supabase valide la petición correctamente a través del header "apikey".
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    },
    global: {
        fetch: (url, options = {}) => {
            const headers = new Headers(options.headers || {});
            
            // Asegurar que el header apikey esté siempre presente
            if (!headers.has('apikey')) {
                headers.set('apikey', SUPABASE_ANON_KEY);
            }
            
            // Si Authorization contiene una clave que no es un JWT de usuario (eyJ...), la removemos
            // para evitar que el validador JWT de Kong rechace la solicitud con 401 (Unauthorized)
            const authHeader = headers.get('Authorization') || headers.get('authorization');
            if (authHeader && !authHeader.startsWith('Bearer eyJ')) {
                headers.delete('Authorization');
                headers.delete('authorization');
            }
            
            return fetch(url, { ...options, headers });
        }
    }
});

// Estado global en memoria
let state = {
    rol: 'ADMIN',
    herramientas: [],
    usuarios: [],
    prestamos: [],
    paginaActual: 1,
    itemsPorPagina: 6
};

// ============================================================================
// INICIALIZACIÓN Y EVENTOS
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    configurarFechaVencimientoPorDefecto();
    registrarEventos();
    await cargarTodo();
});

function configurarFechaVencimientoPorDefecto() {
    const inputVenc = document.getElementById('prestamoVencimiento');
    if (!inputVenc) return;
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);
    manana.setMinutes(manana.getMinutes() - manana.getTimezoneOffset());
    inputVenc.value = manana.toISOString().slice(0, 16);
}

function mostrarFeedback(mensaje, tipo = 'neutral') {
    const banner = document.getElementById('feedbackBanner');
    if (!banner) return;
    banner.className = `feedback-box ${tipo}`;
    banner.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong> ${mensaje}`;
}

function registrarEventos() {
    // Selector de Rol (Administrador vs Usuario de Consulta)
    const selectRol = document.getElementById('selectRol');
    if (selectRol) {
        selectRol.addEventListener('change', (e) => {
            state.rol = e.target.value;
            const badge = document.getElementById('rolBadge');
            if (state.rol === 'CONSULTA') {
                document.body.classList.add('role-consulta');
                if (badge) {
                    badge.textContent = 'SOLO CONSULTA';
                    badge.className = 'role-badge consulta';
                }
                mostrarFeedback('Modo Usuario de Consulta activado: Operaciones de escritura bloqueadas; solo visualización autorizada.', 'neutral');
            } else {
                document.body.classList.remove('role-consulta');
                if (badge) {
                    badge.textContent = 'ADMIN';
                    badge.className = 'role-badge admin';
                }
                mostrarFeedback('Modo Administrador activado: Operaciones de alta, baja, modificación, préstamo y devolución habilitadas.', 'success');
            }
        });
    }

    // Navegación por pestañas
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.classList.add('active');
        });
    });

    // Formularios principales
    const formPrestamo = document.getElementById('formPrestamo');
    if (formPrestamo) formPrestamo.addEventListener('submit', handleRegistrarPrestamo);

    const formDevolucion = document.getElementById('formDevolucion');
    if (formDevolucion) formDevolucion.addEventListener('submit', handleConfirmarDevolucion);

    const btnCerrarModal = document.getElementById('btnCerrarModal');
    if (btnCerrarModal) {
        btnCerrarModal.addEventListener('click', () => {
            document.getElementById('modalDevolucion')?.classList.add('hidden');
        });
    }

    const formHerramienta = document.getElementById('formHerramienta');
    if (formHerramienta) formHerramienta.addEventListener('submit', handleGuardarHerramienta);

    const btnCancelarHerr = document.getElementById('btnCancelarHerr');
    if (btnCancelarHerr) btnCancelarHerr.addEventListener('click', limpiarFormHerramienta);

    const formUsuario = document.getElementById('formUsuario');
    if (formUsuario) formUsuario.addEventListener('submit', handleGuardarUsuario);

    const btnCancelarUsu = document.getElementById('btnCancelarUsu');
    if (btnCancelarUsu) btnCancelarUsu.addEventListener('click', limpiarFormUsuario);

    // Filtros combinados, orden y paginación
    ['filtroTexto', 'filtroHerramienta', 'filtroUsuario', 'filtroEstado', 'filtroAtraso', 'filtroDesde', 'filtroHasta', 'ordenPrestamos']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    state.paginaActual = 1;
                    renderPrestamos();
                });
            }
        });

    const btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');
    if (btnLimpiarFiltros) {
        btnLimpiarFiltros.addEventListener('click', () => {
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            setVal('filtroTexto', '');
            setVal('filtroHerramienta', '');
            setVal('filtroUsuario', '');
            setVal('filtroEstado', '');
            setVal('filtroAtraso', '');
            setVal('filtroDesde', '');
            setVal('filtroHasta', '');
            setVal('ordenPrestamos', 'salida_desc');
            state.paginaActual = 1;
            renderPrestamos();
            mostrarFeedback('Filtros limpios: mostrando todo el historial.', 'neutral');
        });
    }

    const btnPrevPage = document.getElementById('btnPrevPage');
    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', () => {
            if (state.paginaActual > 1) {
                state.paginaActual--;
                renderPrestamos();
            }
        });
    }

    const btnNextPage = document.getElementById('btnNextPage');
    if (btnNextPage) {
        btnNextPage.addEventListener('click', () => {
            state.paginaActual++;
            renderPrestamos();
        });
    }

    // Simulador de concurrencia
    const btnSimular = document.getElementById('btnSimularConcurrencia');
    if (btnSimular) btnSimular.addEventListener('click', ejecutarPruebaConcurrencia);
}

// ============================================================================
// CARGA DE DATOS DESDE SUPABASE
// ============================================================================
async function cargarTodo() {
    try {
        const [resHerr, resUsu, resPres] = await Promise.all([
            db.from('herramientas').select('*').order('codigo', { ascending: true }),
            db.from('usuarios').select('*').order('nombre', { ascending: true }),
            db.from('prestamos').select(`
                *,
                herramientas (id, codigo, descripcion, estado),
                usuarios (id, documento, nombre)
            `).order('fecha_salida', { ascending: false })
        ]);

        if (resHerr.error || resUsu.error || resPres.error) {
            console.error('Error detallado de Supabase:', {
                herramientas: resHerr.error,
                usuarios: resUsu.error,
                prestamos: resPres.error
            });
            const primerError = resHerr.error || resUsu.error || resPres.error;
            
            if (primerError.code === '42P01' || primerError.message?.includes('does not exist')) {
                mostrarFeedback('Aviso: Las tablas no existen en Supabase. Debe ejecutar el script SQL "mila.sql" en el SQL Editor del panel de Supabase.', 'error');
            } else if (primerError.code === 'PGRST301' || primerError.message?.includes('JWT') || primerError.status === 401) {
                mostrarFeedback('Error 401 (No autorizado): Verifique la clave Publishable o Anon Key en Supabase.', 'error');
            } else {
                mostrarFeedback(`Error de conexión con Supabase: ${primerError.message || primerError.details || 'Error desconocido'}`, 'error');
            }
            return;
        }

        state.herramientas = resHerr.data || [];
        state.usuarios = resUsu.data || [];
        state.prestamos = resPres.data || [];

        actualizarKPIs();
        poblarSelectores();
        renderHerramientas();
        renderUsuarios();
        renderPrestamos();
        mostrarFeedback('Datos cargados y sincronizados correctamente con Supabase.', 'success');
    } catch (err) {
        console.error('Excepción al conectar con Supabase:', err);
        mostrarFeedback(`Error inesperado de red al contactar Supabase: ${err.message}`, 'error');
    }
}

function actualizarKPIs() {
    const libres = state.herramientas.filter(h => h.activo && h.estado === 'LIBRE').length;
    const reparacion = state.herramientas.filter(h => h.activo && h.estado === 'EN_REPARACION').length;
    const ahora = new Date();
    const vencidos = state.prestamos.filter(p => p.estado_prestamo === 'ACTIVO' && new Date(p.fecha_vencimiento) < ahora).length;
    const danados = state.prestamos.filter(p => p.estado_prestamo === 'DEVUELTO_DANADO').length;

    const elLibres = document.getElementById('kpiLibres');
    const elVencidos = document.getElementById('kpiVencidos');
    const elDanados = document.getElementById('kpiDanados');
    const elReparacion = document.getElementById('kpiReparacion');

    if (elLibres) elLibres.textContent = libres;
    if (elVencidos) elVencidos.textContent = vencidos;
    if (elDanados) elDanados.textContent = danados;
    if (elReparacion) elReparacion.textContent = reparacion;
}

function poblarSelectores() {
    const selPresHerr = document.getElementById('prestamoHerramienta');
    const selFilHerr = document.getElementById('filtroHerramienta');
    const selTestHerr = document.getElementById('testHerramienta');

    if (selPresHerr) selPresHerr.innerHTML = '<option value="">-- Seleccione herramienta --</option>';
    if (selFilHerr) selFilHerr.innerHTML = '<option value="">Todas las herramientas</option>';
    if (selTestHerr) selTestHerr.innerHTML = '';

    let hayLibres = false;
    state.herramientas.filter(h => h.activo).forEach(h => {
        const label = `${h.codigo} - ${h.descripcion} [${h.estado}]`;
        if (selPresHerr) selPresHerr.innerHTML += `<option value="${h.id}">${label}</option>`;
        if (selFilHerr) selFilHerr.innerHTML += `<option value="${h.id}">${h.codigo} - ${h.descripcion}</option>`;
        if (h.estado === 'LIBRE') {
            hayLibres = true;
            if (selTestHerr) selTestHerr.innerHTML += `<option value="${h.id}">${label}</option>`;
        }
    });

    if (selTestHerr && !hayLibres) {
        selTestHerr.innerHTML = '<option value="">(No hay herramientas LIBRES disponibles)</option>';
    }

    const selPresUsu = document.getElementById('prestamoUsuario');
    const selFilUsu = document.getElementById('filtroUsuario');
    if (selPresUsu) selPresUsu.innerHTML = '<option value="">-- Seleccione usuario --</option>';
    if (selFilUsu) selFilUsu.innerHTML = '<option value="">Todos los usuarios</option>';

    state.usuarios.filter(u => u.activo).forEach(u => {
        const label = `${u.documento} - ${u.nombre}`;
        if (selPresUsu) selPresUsu.innerHTML += `<option value="${u.id}">${label}</option>`;
        if (selFilUsu) selFilUsu.innerHTML += `<option value="${u.id}">${label}</option>`;
    });
}

// ============================================================================
// OPERACIONES DE PRÉSTAMO Y DEVOLUCIÓN (USANDO RPC TRANSACCIONAL)
// ============================================================================
async function handleRegistrarPrestamo(e) {
    e.preventDefault();
    if (state.rol !== 'ADMIN') {
        mostrarFeedback('Operación rechazada: Modo Consulta activo.', 'error');
        return;
    }

    const herramientaId = document.getElementById('prestamoHerramienta')?.value;
    const usuarioId = document.getElementById('prestamoUsuario')?.value;
    const inputVenc = document.getElementById('prestamoVencimiento')?.value;
    const obs = document.getElementById('prestamoObs')?.value.trim();

    if (!herramientaId || !usuarioId || !inputVenc) {
        mostrarFeedback('RECHAZADO: Debe completar los campos obligatorios.', 'error');
        return;
    }

    const vencimiento = new Date(inputVenc).toISOString();

    const { data, error } = await db.rpc('registrar_prestamo_seguro', {
        p_herramienta_id: herramientaId,
        p_usuario_id: usuarioId,
        p_fecha_vencimiento: vencimiento,
        p_observacion: obs || null
    });

    if (error) {
        mostrarFeedback(`Error técnico al procesar préstamo: ${error.message}`, 'error');
        return;
    }

    if (data && data.ok) {
        mostrarFeedback(data.mensaje, 'success');
        const obsEl = document.getElementById('prestamoObs');
        if (obsEl) obsEl.value = '';
        await cargarTodo();
    } else {
        mostrarFeedback(data ? data.mensaje : 'Operación rechazada.', 'error');
    }
}

window.abrirModalDevolucion = function(prestamoId) {
    if (state.rol !== 'ADMIN') return;
    const p = state.prestamos.find(item => item.id === prestamoId);
    if (!p) return;

    const devId = document.getElementById('devPrestamoId');
    const devCond = document.getElementById('devCondicion');
    const devObs = document.getElementById('devObservacion');
    const devDet = document.getElementById('modalDevDetalle');
    const modal = document.getElementById('modalDevolucion');

    if (devId) devId.value = p.id;
    if (devCond) devCond.value = 'OK';
    if (devObs) devObs.value = '';
    if (devDet) {
        devDet.textContent = `Herramienta: ${p.herramientas?.codigo || ''} - ${p.herramientas?.descripcion || ''} | Retirada por: ${p.usuarios?.nombre || ''}`;
    }
    if (modal) modal.classList.remove('hidden');
};

async function handleConfirmarDevolucion(e) {
    e.preventDefault();
    if (state.rol !== 'ADMIN') return;

    const prestamoId = document.getElementById('devPrestamoId')?.value;
    const danada = document.getElementById('devCondicion')?.value === 'DANADA';
    const observacion = document.getElementById('devObservacion')?.value.trim();

    const { data, error } = await db.rpc('registrar_devolucion_segura', {
        p_prestamo_id: prestamoId,
        p_danada: danada,
        p_observacion: observacion || null
    });

    if (error) {
        mostrarFeedback(`Error técnico en devolución: ${error.message}`, 'error');
        return;
    }

    if (data && data.ok) {
        document.getElementById('modalDevolucion')?.classList.add('hidden');
        mostrarFeedback(data.mensaje, danada ? 'error' : 'success');
        await cargarTodo();
    } else {
        mostrarFeedback(data ? data.mensaje : 'Devolución rechazada.', 'error');
    }
}

// ============================================================================
// RENDERIZADO DE PRÉSTAMOS CON BÚSQUEDA + FILTROS COMBINADOS + PAGINACIÓN
// ============================================================================
function renderPrestamos() {
    const texto = (document.getElementById('filtroTexto')?.value || '').toLowerCase().trim();
    const fHerr = document.getElementById('filtroHerramienta')?.value || '';
    const fUsu = document.getElementById('filtroUsuario')?.value || '';
    const fEstado = document.getElementById('filtroEstado')?.value || '';
    const fAtraso = document.getElementById('filtroAtraso')?.value || '';
    const fDesde = document.getElementById('filtroDesde')?.value || '';
    const fHasta = document.getElementById('filtroHasta')?.value || '';
    const orden = document.getElementById('ordenPrestamos')?.value || 'salida_desc';
    const ahora = new Date();

    let filtrados = state.prestamos.filter(p => {
        const esVencido = p.estado_prestamo === 'ACTIVO' && new Date(p.fecha_vencimiento) < ahora;
        const devueltoTarde = p.fecha_devolucion && new Date(p.fecha_devolucion) > new Date(p.fecha_vencimiento);
        const tieneAtraso = esVencido || devueltoTarde;

        if (fHerr && p.herramienta_id !== fHerr) return false;
        if (fUsu && p.usuario_id !== fUsu) return false;
        if (fEstado && p.estado_prestamo !== fEstado) return false;
        if (fAtraso === 'VENCIDO' && !tieneAtraso) return false;
        if (fAtraso === 'EN_TIEMPO' && tieneAtraso) return false;

        if (fDesde && new Date(p.fecha_salida) < new Date(fDesde + 'T00:00:00')) return false;
        if (fHasta && new Date(p.fecha_salida) > new Date(fHasta + 'T23:59:59')) return false;

        if (texto) {
            const blob = `${p.herramientas?.codigo || ''} ${p.herramientas?.descripcion || ''} ${p.usuarios?.documento || ''} ${p.usuarios?.nombre || ''} ${p.observacion || ''}`.toLowerCase();
            if (!blob.includes(texto)) return false;
        }
        return true;
    });

    // Ordenamiento
    filtrados.sort((a, b) => {
        if (orden === 'salida_desc') return new Date(b.fecha_salida) - new Date(a.fecha_salida);
        if (orden === 'salida_asc') return new Date(a.fecha_salida) - new Date(b.fecha_salida);
        if (orden === 'vencimiento_asc') return new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento);
        if (orden === 'herramienta_asc') return (a.herramientas?.codigo || '').localeCompare(b.herramientas?.codigo || '');
        return 0;
    });

    // Paginación
    const total = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(total / state.itemsPorPagina));
    if (state.paginaActual > totalPaginas) state.paginaActual = totalPaginas;

    const inicio = (state.paginaActual - 1) * state.itemsPorPagina;
    const paginados = filtrados.slice(inicio, inicio + state.itemsPorPagina);

    const elTotal = document.getElementById('totalResultados');
    const elPageInfo = document.getElementById('pageInfo');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');

    if (elTotal) elTotal.textContent = `${total} registros encontrados`;
    if (elPageInfo) elPageInfo.textContent = `Página ${state.paginaActual} de ${totalPaginas}`;
    if (btnPrev) btnPrev.disabled = state.paginaActual <= 1;
    if (btnNext) btnNext.disabled = state.paginaActual >= totalPaginas;

    const tbody = document.getElementById('tbodyPrestamos');
    if (!tbody) return;

    if (paginados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--muted); padding: 1.5rem;">No se encontraron registros que coincidan con los filtros.</td></tr>';
        return;
    }

    tbody.innerHTML = paginados.map(p => {
        const vencido = p.estado_prestamo === 'ACTIVO' && new Date(p.fecha_vencimiento) < ahora;
        const badgeClass = vencido ? 'st-vencido' : `st-${p.estado_prestamo.toLowerCase()}`;
        const badgeText = vencido ? 'ACTIVO (VENCIDO)' : p.estado_prestamo;

        const accionHtml = p.estado_prestamo === 'ACTIVO'
            ? `<button class="btn btn-primary btn-sm" onclick="abrirModalDevolucion('${p.id}')">Devolver</button>`
            : `<span class="hint">Cerrado</span>`;

        return `
            <tr>
                <td><strong>${p.herramientas?.codigo || '-'}</strong><br><small>${p.herramientas?.descripcion || ''}</small></td>
                <td>${p.usuarios?.nombre || '-'}<br><small>CI: ${p.usuarios?.documento || ''}</small></td>
                <td>${formatearFecha(p.fecha_salida)}</td>
                <td>${formatearFecha(p.fecha_vencimiento)}</td>
                <td>${p.fecha_devolucion ? formatearFecha(p.fecha_devolucion) : '-'}</td>
                <td><span class="status-pill ${badgeClass}">${badgeText}</span></td>
                <td>${p.observacion || '-'}</td>
                <td class="admin-only">${accionHtml}</td>
            </tr>
        `;
    }).join('');
}

// ============================================================================
// ABM DE HERRAMIENTAS (ALTA, MODIFICACIÓN, HABILITACIÓN POST-REPARACIÓN Y BAJA)
// ============================================================================
function renderHerramientas() {
    const tbody = document.getElementById('tbodyHerramientas');
    if (!tbody) return;

    const activas = state.herramientas.filter(h => h.activo);
    if (activas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted); padding: 1.5rem;">No hay herramientas registradas.</td></tr>';
        return;
    }

    tbody.innerHTML = activas.map(h => {
        const btnHabilitar = h.estado === 'EN_REPARACION'
            ? `<button class="btn btn-success btn-sm" onclick="habilitarHerramienta('${h.id}')">Habilitar (Libre)</button>`
            : '';

        return `
            <tr>
                <td><strong>${h.codigo}</strong></td>
                <td>${h.descripcion}</td>
                <td>${h.categoria || '-'}</td>
                <td><span class="status-pill st-${h.estado.toLowerCase()}">${h.estado}</span></td>
                <td><small>Creado: ${formatearFecha(h.created_at)}<br>Act: ${formatearFecha(h.updated_at)}</small></td>
                <td class="admin-only">
                    ${btnHabilitar}
                    <button class="btn btn-secondary btn-sm" onclick="editarHerramienta('${h.id}')">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="bajaHerramienta('${h.id}')">Baja</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function handleGuardarHerramienta(e) {
    e.preventDefault();
    if (state.rol !== 'ADMIN') return;

    const id = document.getElementById('herramientaId')?.value;
    const payload = {
        codigo: document.getElementById('herrCodigo')?.value.trim().toUpperCase(),
        descripcion: document.getElementById('herrDescripcion')?.value.trim(),
        categoria: document.getElementById('herrCategoria')?.value.trim() || 'General',
        estado: document.getElementById('herrEstado')?.value || 'LIBRE'
    };

    const res = id
        ? await db.from('herramientas').update(payload).eq('id', id)
        : await db.from('herramientas').insert([payload]);

    if (res.error) {
        mostrarFeedback(`RECHAZADO al guardar herramienta: ${res.error.message}`, 'error');
    } else {
        mostrarFeedback(`ACEPTADO: Herramienta [${payload.codigo}] guardada correctamente.`, 'success');
        limpiarFormHerramienta();
        await cargarTodo();
    }
}

window.editarHerramienta = function(id) {
    if (state.rol !== 'ADMIN') return;
    const h = state.herramientas.find(item => item.id === id);
    if (!h) return;

    const setVal = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
    setVal('herramientaId', h.id);
    setVal('herrCodigo', h.codigo);
    setVal('herrDescripcion', h.descripcion);
    setVal('herrCategoria', h.categoria || '');
    setVal('herrEstado', h.estado);

    const titulo = document.getElementById('tituloFormHerramienta');
    if (titulo) titulo.textContent = `Editando Herramienta: ${h.codigo}`;

    document.getElementById('formHerramienta')?.scrollIntoView({ behavior: 'smooth' });
};

window.habilitarHerramienta = async function(id) {
    if (state.rol !== 'ADMIN') return;
    const { error } = await db.from('herramientas').update({ estado: 'LIBRE' }).eq('id', id);
    if (error) {
        mostrarFeedback(`RECHAZADO: ${error.message}`, 'error');
    } else {
        mostrarFeedback('ACEPTADO: Herramienta reparada y habilitada nuevamente en estado LIBRE.', 'success');
        await cargarTodo();
    }
};

window.bajaHerramienta = async function(id) {
    if (state.rol !== 'ADMIN') return;
    const h = state.herramientas.find(item => item.id === id);
    if (!h) return;

    if (h.estado === 'PRESTADA') {
        mostrarFeedback('RECHAZADO: No se puede dar de baja una herramienta que actualmente está PRESTADA.', 'error');
        return;
    }
    const { error } = await db.from('herramientas').update({ activo: false, estado: 'BAJA' }).eq('id', id);
    if (error) {
        mostrarFeedback(`RECHAZADO al dar de baja herramienta: ${error.message}`, 'error');
    } else {
        mostrarFeedback(`ACEPTADO: Herramienta [${h.codigo}] dada de baja conservando historial.`, 'success');
        await cargarTodo();
    }
};

function limpiarFormHerramienta() {
    document.getElementById('formHerramienta')?.reset();
    const idEl = document.getElementById('herramientaId');
    if (idEl) idEl.value = '';
    const titEl = document.getElementById('tituloFormHerramienta');
    if (titEl) titEl.textContent = 'Alta / Edición de Herramienta';
}

// ============================================================================
// ABM DE USUARIOS
// ============================================================================
function renderUsuarios() {
    const tbody = document.getElementById('tbodyUsuarios');
    if (!tbody) return;

    const activos = state.usuarios.filter(u => u.activo);
    if (activos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted); padding: 1.5rem;">No hay usuarios registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = activos.map(u => `
        <tr>
            <td><strong>${u.documento}</strong></td>
            <td>${u.nombre}</td>
            <td>${u.sector_curso || '-'}</td>
            <td><span class="status-pill st-libre">ACTIVO</span></td>
            <td><small>${formatearFecha(u.updated_at)}</small></td>
            <td class="admin-only">
                <button class="btn btn-secondary btn-sm" onclick="editarUsuario('${u.id}')">Editar</button>
                <button class="btn btn-danger btn-sm" onclick="bajaUsuario('${u.id}')">Baja</button>
            </td>
        </tr>
    `).join('');
}

async function handleGuardarUsuario(e) {
    e.preventDefault();
    if (state.rol !== 'ADMIN') return;

    const id = document.getElementById('usuarioId')?.value;
    const payload = {
        documento: document.getElementById('usuDocumento')?.value.trim(),
        nombre: document.getElementById('usuNombre')?.value.trim(),
        sector_curso: document.getElementById('usuSector')?.value.trim() || 'Taller'
    };

    const res = id
        ? await db.from('usuarios').update(payload).eq('id', id)
        : await db.from('usuarios').insert([payload]);

    if (res.error) {
        mostrarFeedback(`RECHAZADO al guardar usuario: ${res.error.message}`, 'error');
    } else {
        mostrarFeedback(`ACEPTADO: Usuario ${payload.nombre} (CI: ${payload.documento}) guardado.`, 'success');
        limpiarFormUsuario();
        await cargarTodo();
    }
}

window.editarUsuario = function(id) {
    if (state.rol !== 'ADMIN') return;
    const u = state.usuarios.find(item => item.id === id);
    if (!u) return;

    const setVal = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
    setVal('usuarioId', u.id);
    setVal('usuDocumento', u.documento);
    setVal('usuNombre', u.nombre);
    setVal('usuSector', u.sector_curso || '');

    const titEl = document.getElementById('tituloFormUsuario');
    if (titEl) titEl.textContent = `Editando Usuario: ${u.nombre}`;

    document.getElementById('formUsuario')?.scrollIntoView({ behavior: 'smooth' });
};

window.bajaUsuario = async function(id) {
    if (state.rol !== 'ADMIN') return;
    const u = state.usuarios.find(item => item.id === id);
    if (!u) return;

    const tieneActivos = state.prestamos.some(p => p.usuario_id === id && p.estado_prestamo === 'ACTIVO');
    if (tieneActivos) {
        mostrarFeedback('RECHAZADO: El usuario tiene herramientas pendientes de devolución.', 'error');
        return;
    }
    const { error } = await db.from('usuarios').update({ activo: false }).eq('id', id);
    if (error) {
        mostrarFeedback(`RECHAZADO al dar de baja usuario: ${error.message}`, 'error');
    } else {
        mostrarFeedback(`ACEPTADO: Usuario ${u.nombre} dado de baja lógicamente (historial conservado).`, 'success');
        await cargarTodo();
    }
};

function limpiarFormUsuario() {
    document.getElementById('formUsuario')?.reset();
    const idEl = document.getElementById('usuarioId');
    if (idEl) idEl.value = '';
    const titEl = document.getElementById('tituloFormUsuario');
    if (titEl) titEl.textContent = 'Alta / Edición de Usuario';
}

// ============================================================================
// PRUEBA DE CONCURRENCIA (2 SOLICITUDES SIMULTÁNEAS SOBRE LA MISMA UNIDAD)
// ============================================================================
async function ejecutarPruebaConcurrencia() {
    if (state.rol !== 'ADMIN') {
        mostrarFeedback('Operación bloqueada: Solo el Administrador puede ejecutar la prueba de concurrencia.', 'error');
        return;
    }

    const herramientaId = document.getElementById('testHerramienta')?.value;
    const activos = state.usuarios.filter(u => u.activo);
    const log = document.getElementById('logConcurrencia');
    if (!log) return;

    if (!herramientaId || activos.length < 2) {
        log.textContent = 'ERROR: Se requiere al menos 1 herramienta LIBRE seleccionada y 2 usuarios activos para ejecutar la prueba.';
        mostrarFeedback('Prueba cancelada: Verifique que exista una herramienta libre y al menos 2 usuarios activos.', 'error');
        return;
    }

    const hObj = state.herramientas.find(h => h.id === herramientaId);
    const venc = new Date(Date.now() + 86400000).toISOString();
    log.textContent = `Disparando 2 peticiones concurrentes en t = ${new Date().toISOString()}...\n` +
        `Herramienta objetivo: [${hObj ? hObj.codigo + ' - ' + hObj.descripcion : herramientaId}]\n` +
        `Solicitud A -> Usuario: ${activos[0].nombre} (CI: ${activos[0].documento})\n` +
        `Solicitud B -> Usuario: ${activos[1].nombre} (CI: ${activos[1].documento})\n\nProcesando con FOR UPDATE en PostgreSQL...`;

    const [resA, resB] = await Promise.all([
        db.rpc('registrar_prestamo_seguro', {
            p_herramienta_id: herramientaId,
            p_usuario_id: activos[0].id,
            p_fecha_vencimiento: venc,
            p_observacion: 'Prueba concurrencia Solicitud A'
        }),
        db.rpc('registrar_prestamo_seguro', {
            p_herramienta_id: herramientaId,
            p_usuario_id: activos[1].id,
            p_fecha_vencimiento: venc,
            p_observacion: 'Prueba concurrencia Solicitud B'
        })
    ]);

    const resAData = resA.error ? { error: resA.error.message } : resA.data;
    const resBData = resB.error ? { error: resB.error.message } : resB.data;

    log.textContent += `\n\nRESULTADO SOLICITUD A (${activos[0].nombre}):\n${JSON.stringify(resAData, null, 2)}` +
        `\n\nRESULTADO SOLICITUD B (${activos[1].nombre}):\n${JSON.stringify(resBData, null, 2)}`;

    mostrarFeedback('Prueba de concurrencia finalizada. Revise el resultado en la consola de pruebas.', 'success');
    await cargarTodo();
}

function formatearFecha(isoStr) {
    if (!isoStr) return '-';
    return new Date(isoStr).toLocaleString('es-PY', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}
