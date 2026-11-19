// ============================================================================
// CONFIGURACIÓN DE SUPABASE (Reemplazar con tus credenciales del proyecto)
// ============================================================================
const SUPABASE_URL = 'https://ekgwlcopjscwuzlwsywv.supabase.co';
const SUPABASE_ANON_KEY = "sb_publishable_Fq5OHITtfQApgRn5mPaefw_t_cJ455u"
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);
    manana.setMinutes(manana.getMinutes() - manana.getTimezoneOffset());
    document.getElementById('prestamoVencimiento').value = manana.toISOString().slice(0, 16);
}

function mostrarFeedback(mensaje, tipo = 'neutral') {
    const banner = document.getElementById('feedbackBanner');
    banner.className = `feedback-box ${tipo}`;
    banner.innerHTML = `<strong>[${new Date().toLocaleTimeString()}]</strong> ${mensaje}`;
}

function registrarEventos() {
    // Selector de Rol (Administrador vs Usuario de Consulta)
    document.getElementById('selectRol').addEventListener('change', (e) => {
        state.rol = e.target.value;
        const badge = document.getElementById('rolBadge');
        if (state.rol === 'CONSULTA') {
            document.body.classList.add('role-consulta');
            badge.textContent = 'SOLO CONSULTA';
            badge.className = 'role-badge consulta';
            mostrarFeedback('Modo Usuario de Consulta activado: Operaciones de escritura bloqueadas; solo visualización autorizada.', 'neutral');
        } else {
            document.body.classList.remove('role-consulta');
            badge.textContent = 'ADMIN';
            badge.className = 'role-badge admin';
            mostrarFeedback('Modo Administrador activado: Operaciones de alta, baja, modificación, préstamo y devolución habilitadas.', 'success');
        }
    });

    // Navegación por pestañas
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Formularios principales
    document.getElementById('formPrestamo').addEventListener('submit', handleRegistrarPrestamo);
    document.getElementById('formDevolucion').addEventListener('submit', handleConfirmarDevolucion);
    document.getElementById('btnCerrarModal').addEventListener('click', () => {
        document.getElementById('modalDevolucion').classList.add('hidden');
    });

    document.getElementById('formHerramienta').addEventListener('submit', handleGuardarHerramienta);
    document.getElementById('btnCancelarHerr').addEventListener('click', limpiarFormHerramienta);

    document.getElementById('formUsuario').addEventListener('submit', handleGuardarUsuario);
    document.getElementById('btnCancelarUsu').addEventListener('click', limpiarFormUsuario);

    // Filtros combinados, orden y paginación
    ['filtroTexto', 'filtroHerramienta', 'filtroUsuario', 'filtroEstado', 'filtroAtraso', 'filtroDesde', 'filtroHasta', 'ordenPrestamos']
        .forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                state.paginaActual = 1;
                renderPrestamos();
            });
        });

    document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
        document.getElementById('filtroTexto').value = '';
        document.getElementById('filtroHerramienta').value = '';
        document.getElementById('filtroUsuario').value = '';
        document.getElementById('filtroEstado').value = '';
        document.getElementById('filtroAtraso').value = '';
        document.getElementById('filtroDesde').value = '';
        document.getElementById('filtroHasta').value = '';
        document.getElementById('ordenPrestamos').value = 'salida_desc';
        state.paginaActual = 1;
        renderPrestamos();
        mostrarFeedback('Filtros limpios: mostrando todo el historial.', 'neutral');
    });

    document.getElementById('btnPrevPage').addEventListener('click', () => {
        if (state.paginaActual > 1) {
            state.paginaActual--;
            renderPrestamos();
        }
    });

    document.getElementById('btnNextPage').addEventListener('click', () => {
        state.paginaActual++;
        renderPrestamos();
    });

    // Simulador de concurrencia
    document.getElementById('btnSimularConcurrencia').addEventListener('click', ejecutarPruebaConcurrencia);
}

// ============================================================================
// CARGA DE DATOS DESDE SUPABASE
// ============================================================================
async function cargarTodo() {
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
        mostrarFeedback('Error de conexión con Supabase. Verifique URL y Anon Key.', 'error');
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
}

function actualizarKPIs() {
    const libres = state.herramientas.filter(h => h.activo && h.estado === 'LIBRE').length;
    const reparacion = state.herramientas.filter(h => h.activo && h.estado === 'EN_REPARACION').length;
    const ahora = new Date();
    const vencidos = state.prestamos.filter(p => p.estado_prestamo === 'ACTIVO' && new Date(p.fecha_vencimiento) < ahora).length;
    const danados = state.prestamos.filter(p => p.estado_prestamo === 'DEVUELTO_DANADO').length;

    document.getElementById('kpiLibres').textContent = libres;
    document.getElementById('kpiVencidos').textContent = vencidos;
    document.getElementById('kpiDanados').textContent = danados;
    document.getElementById('kpiReparacion').textContent = reparacion;
}

function poblarSelectores() {
    const selPresHerr = document.getElementById('prestamoHerramienta');
    const selFilHerr = document.getElementById('filtroHerramienta');
    const selTestHerr = document.getElementById('testHerramienta');

    selPresHerr.innerHTML = '<option value="">-- Seleccione herramienta --</option>';
    selFilHerr.innerHTML = '<option value="">Todas las herramientas</option>';
    selTestHerr.innerHTML = '';

    state.herramientas.filter(h => h.activo).forEach(h => {
        const label = `${h.codigo} - ${h.descripcion} [${h.estado}]`;
        selPresHerr.innerHTML += `<option value="${h.id}">${label}</option>`;
        selFilHerr.innerHTML += `<option value="${h.id}">${h.codigo} - ${h.descripcion}</option>`;
        if (h.estado === 'LIBRE') {
            selTestHerr.innerHTML += `<option value="${h.id}">${label}</option>`;
        }
    });

    const selPresUsu = document.getElementById('prestamoUsuario');
    const selFilUsu = document.getElementById('filtroUsuario');
    selPresUsu.innerHTML = '<option value="">-- Seleccione usuario --</option>';
    selFilUsu.innerHTML = '<option value="">Todos los usuarios</option>';

    state.usuarios.filter(u => u.activo).forEach(u => {
        const label = `${u.documento} - ${u.nombre}`;
        selPresUsu.innerHTML += `<option value="${u.id}">${label}</option>`;
        selFilUsu.innerHTML += `<option value="${u.id}">${label}</option>`;
    });
}

// ============================================================================
// OPERACIONES DE PRÉSTAMO Y DEVOLUCIÓN (USANDO RPC TRANSACCIONAL)
// ============================================================================
async function handleRegistrarPrestamo(e) {
    e.preventDefault();
    if (state.rol !== 'ADMIN') return;

    const herramientaId = document.getElementById('prestamoHerramienta').value;
    const usuarioId = document.getElementById('prestamoUsuario').value;
    const vencimiento = new Date(document.getElementById('prestamoVencimiento').value).toISOString();
    const obs = document.getElementById('prestamoObs').value.trim();

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

    if (data.ok) {
        mostrarFeedback(data.mensaje, 'success');
        document.getElementById('prestamoObs').value = '';
        await cargarTodo();
    } else {
        // Muestra explícitamente por qué se rechaza (ej: EN_REPARACION o PRESTADA)
        mostrarFeedback(data.mensaje, 'error');
    }
}

window.abrirModalDevolucion = function(prestamoId) {
    if (state.rol !== 'ADMIN') return;
    const p = state.prestamos.find(item => item.id === prestamoId);
    if (!p) return;

    document.getElementById('devPrestamoId').value = p.id;
    document.getElementById('devCondicion').value = 'OK';
    document.getElementById('devObservacion').value = '';
    document.getElementById('modalDevDetalle').textContent =
        `Herramienta: ${p.herramientas?.codigo} - ${p.herramientas?.descripcion} | Retirada por: ${p.usuarios?.nombre}`;
    document.getElementById('modalDevolucion').classList.remove('hidden');
};

async function handleConfirmarDevolucion(e) {
    e.preventDefault();
    const prestamoId = document.getElementById('devPrestamoId').value;
    const danada = document.getElementById('devCondicion').value === 'DANADA';
    const observacion = document.getElementById('devObservacion').value;

    const { data, error } = await db.rpc('registrar_devolucion_segura', {
        p_prestamo_id: prestamoId,
        p_danada: danada,
        p_observacion: observacion
    });

    if (error) {
        mostrarFeedback(`Error técnico en devolución: ${error.message}`, 'error');
        return;
    }

    if (data.ok) {
        document.getElementById('modalDevolucion').classList.add('hidden');
        mostrarFeedback(data.mensaje, danada ? 'error' : 'success');
        await cargarTodo();
    } else {
        // Rechazo si devuelve dañada sin observación
        mostrarFeedback(data.mensaje, 'error');
    }
}

// ============================================================================
// RENDERIZADO DE PRÉSTAMOS CON BÚSQUEDA + FILTROS COMBINADOS + PAGINACIÓN
// ============================================================================
function renderPrestamos() {
    const texto = document.getElementById('filtroTexto').value.toLowerCase().trim();
    const fHerr = document.getElementById('filtroHerramienta').value;
    const fUsu = document.getElementById('filtroUsuario').value;
    const fEstado = document.getElementById('filtroEstado').value;
    const fAtraso = document.getElementById('filtroAtraso').value;
    const fDesde = document.getElementById('filtroDesde').value;
    const fHasta = document.getElementById('filtroHasta').value;
    const orden = document.getElementById('ordenPrestamos').value;
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
            const blob = `${p.herramientas?.codigo} ${p.herramientas?.descripcion} ${p.usuarios?.documento} ${p.usuarios?.nombre} ${p.observacion || ''}`.toLowerCase();
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

    document.getElementById('totalResultados').textContent = `${total} registros encontrados`;
    document.getElementById('pageInfo').textContent = `Página ${state.paginaActual} de ${totalPaginas}`;
    document.getElementById('btnPrevPage').disabled = state.paginaActual <= 1;
    document.getElementById('btnNextPage').disabled = state.paginaActual >= totalPaginas;

    const tbody = document.getElementById('tbodyPrestamos');
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
    tbody.innerHTML = state.herramientas.filter(h => h.activo).map(h => {
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
    const id = document.getElementById('herramientaId').value;
    const payload = {
        codigo: document.getElementById('herrCodigo').value.trim().toUpperCase(),
        descripcion: document.getElementById('herrDescripcion').value.trim(),
        categoria: document.getElementById('herrCategoria').value.trim() || 'General',
        estado: document.getElementById('herrEstado').value
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
    const h = state.herramientas.find(item => item.id === id);
    if (!h) return;
    document.getElementById('herramientaId').value = h.id;
    document.getElementById('herrCodigo').value = h.codigo;
    document.getElementById('herrDescripcion').value = h.descripcion;
    document.getElementById('herrCategoria').value = h.categoria || '';
    document.getElementById('herrEstado').value = h.estado;
    document.getElementById('tituloFormHerramienta').textContent = `Editando Herramienta: ${h.codigo}`;
};

window.habilitarHerramienta = async function(id) {
    const { error } = await db.from('herramientas').update({ estado: 'LIBRE' }).eq('id', id);
    if (error) {
        mostrarFeedback(`RECHAZADO: ${error.message}`, 'error');
    } else {
        mostrarFeedback('ACEPTADO: Herramienta reparada y habilitada nuevamente en estado LIBRE.', 'success');
        await cargarTodo();
    }
};

window.bajaHerramienta = async function(id) {
    const h = state.herramientas.find(item => item.id === id);
    if (h && h.estado === 'PRESTADA') {
        mostrarFeedback('RECHAZADO: No se puede dar de baja una herramienta que actualmente está PRESTADA.', 'error');
        return;
    }
    const { error } = await db.from('herramientas').update({ activo: false, estado: 'BAJA' }).eq('id', id);
    if (!error) {
        mostrarFeedback(`ACEPTADO: Herramienta [${h.codigo}] dada de baja conservando historial.`, 'success');
        await cargarTodo();
    }
};

function limpiarFormHerramienta() {
    document.getElementById('formHerramienta').reset();
    document.getElementById('herramientaId').value = '';
    document.getElementById('tituloFormHerramienta').textContent = 'Alta / Edición de Herramienta';
}

// ============================================================================
// ABM DE USUARIOS
// ============================================================================
function renderUsuarios() {
    const tbody = document.getElementById('tbodyUsuarios');
    tbody.innerHTML = state.usuarios.filter(u => u.activo).map(u => `
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
    const id = document.getElementById('usuarioId').value;
    const payload = {
        documento: document.getElementById('usuDocumento').value.trim(),
        nombre: document.getElementById('usuNombre').value.trim(),
        sector_curso: document.getElementById('usuSector').value.trim() || 'Taller'
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
    const u = state.usuarios.find(item => item.id === id);
    if (!u) return;
    document.getElementById('usuarioId').value = u.id;
    document.getElementById('usuDocumento').value = u.documento;
    document.getElementById('usuNombre').value = u.nombre;
    document.getElementById('usuSector').value = u.sector_curso || '';
    document.getElementById('tituloFormUsuario').textContent = `Editando Usuario: ${u.nombre}`;
};

window.bajaUsuario = async function(id) {
    const tieneActivos = state.prestamos.some(p => p.usuario_id === id && p.estado_prestamo === 'ACTIVO');
    if (tieneActivos) {
        mostrarFeedback('RECHAZADO: El usuario tiene herramientas pendientes de devolución.', 'error');
        return;
    }
    const { error } = await db.from('usuarios').update({ activo: false }).eq('id', id);
    if (!error) {
        mostrarFeedback('ACEPTADO: Usuario dado de baja lógicamente (historial conservado).', 'success');
        await cargarTodo();
    }
};

function limpiarFormUsuario() {
    document.getElementById('formUsuario').reset();
    document.getElementById('usuarioId').value = '';
    document.getElementById('tituloFormUsuario').textContent = 'Alta / Edición de Usuario';
}

// ============================================================================
// PRUEBA DE CONCURRENCIA (2 SOLICITUDES SIMULTÁNEAS SOBRE LA MISMA UNIDAD)
// ============================================================================
async function ejecutarPruebaConcurrencia() {
    const herramientaId = document.getElementById('testHerramienta').value;
    const activos = state.usuarios.filter(u => u.activo);
    const log = document.getElementById('logConcurrencia');

    if (!herramientaId || activos.length < 2) {
        log.textContent = 'ERROR: Se requiere al menos 1 herramienta LIBRE y 2 usuarios activos para ejecutar la prueba.';
        return;
    }

    const venc = new Date(Date.now() + 86400000).toISOString();
    log.textContent = `Disparando 2 peticiones concurrentes en t = ${new Date().toISOString()}...\n` +
        `Solicitud A -> Usuario: ${activos[0].nombre}\n` +
        `Solicitud B -> Usuario: ${activos[1].nombre}\n\nProcesando en PostgreSQL...`;

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

    log.textContent += `\n\nRESULTADO SOLICITUD A (${activos[0].nombre}):\n${JSON.stringify(resA.data, null, 2)}` +
        `\n\nRESULTADO SOLICITUD B (${activos[1].nombre}):\n${JSON.stringify(resB.data, null, 2)}`;

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