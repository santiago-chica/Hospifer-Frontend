<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  apiRequest,
  apiDownload,
  ApiError,
  hasAccessToken,
  setAccessToken,
  type CurrentUser,
  type AppointmentRecord,
  type ConsultationRecord,
  type InvoiceRecord,
  type MedicalBackground,
  type Patient,
  type PatientContact,
  type WorkspaceView,
} from './api'
import OperationsWorkspace from './components/OperationsWorkspace.vue'

type PatientDraft = {
  first_names: string
  last_names: string
  document_type: string
  document_number: string
  birth_date: string
  phone: string
  email: string
  address: string
  city: string
}

const emptyPatient = (): PatientDraft => ({
  first_names: '',
  last_names: '',
  document_type: '',
  document_number: '',
  birth_date: '',
  phone: '',
  email: '',
  address: '',
  city: '',
})

const user = ref<CurrentUser | null>(null)
const patients = ref<Patient[]>([])
const selectedPatient = ref<Patient | null>(null)
const contact = ref<PatientContact | null>(null)
const backgrounds = ref<MedicalBackground[]>([])
const patientAppointments = ref<AppointmentRecord[]>([])
const patientConsultations = ref<ConsultationRecord[]>([])
const patientInvoices = ref<InvoiceRecord[]>([])
const patientDetailTab = ref<'overview' | 'appointments' | 'consultations' | 'billing'>('overview')
const view = ref<WorkspaceView>('patients')
const activeFilter = ref<'all' | 'active' | 'inactive'>('active')
const search = ref('')
const showPatientForm = ref(false)
const editingPatient = ref(false)
const showBackgroundForm = ref(false)
const draft = ref<PatientDraft>(emptyPatient())
const backgroundDraft = ref({ category: 'ALERGIA', description: '', occurred_on: '', observations: '' })
const loginForm = ref({ username: '', password: '' })
const passwordForm = ref({ current_password: '', new_password: '' })
const profileDraft = ref({ first_names: '', last_names: '', phone: '', email: '', profile_photo: '' })
const busy = ref(false)
const loadingPatients = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

const can = (permission: string) => user.value?.permissions.includes(permission) ?? false
const navItems = computed(() => [
  { key: 'dashboard' as const, label: 'Dashboard', permission: 'profile.read', glyph: '▤' },
  { key: 'patients' as const, label: 'Pacientes', permission: 'patients.read', glyph: '▦' },
  { key: 'professionals' as const, label: 'Profesionales', permission: 'professionals.read', glyph: '◉' },
  { key: 'appointments' as const, label: 'Citas', permission: 'appointments.read', glyph: '▣' },
  { key: 'consultations' as const, label: 'Consultas', permission: 'medical_consultations.read', glyph: '≡' },
  { key: 'billing' as const, label: 'Facturación', permission: 'billing.read', glyph: '$' },
  { key: 'catalog' as const, label: 'Productos y servicios', permission: 'products.read', glyph: '◇' },
  { key: 'security' as const, label: 'Seguridad', permission: 'users.read', glyph: '⌑' },
  { key: 'audit' as const, label: 'Auditoría', permission: 'audit.read', glyph: '≋' },
  { key: 'profile' as const, label: 'Mi perfil', permission: 'profile.read', glyph: '●' },
].filter((item) => can(item.permission) || (item.key === 'security' && (can('roles.read') || can('permissions.read')))))
const viewTitle = computed(() => navItems.value.find((item) => item.key === view.value)?.label.toUpperCase() ?? 'HOSPIFER')
const activeCount = computed(() => patients.value.filter((patient) => patient.active).length)
const displayName = computed(() => {
  if (!user.value) return ''
  return `${user.value.person.first_names} ${user.value.person.last_names}`.trim()
})

function clearMessages() {
  errorMessage.value = ''
  successMessage.value = ''
}

function reportError(error: unknown) {
  errorMessage.value = error instanceof Error ? error.message : 'No se pudo completar la operación.'
  if (error instanceof ApiError && error.status === 401) user.value = null
}

async function loadPatients() {
  if (!can('patients.read')) return
  loadingPatients.value = true
  const params = new URLSearchParams()
  if (search.value.trim()) params.set('search', search.value.trim())
  if (activeFilter.value !== 'all') params.set('active', String(activeFilter.value === 'active'))
  try {
    patients.value = await apiRequest<Patient[]>(`/patients/?${params.toString()}`)
  } catch (error) {
    reportError(error)
  } finally {
    loadingPatients.value = false
  }
}

async function loadProfile() {
  user.value = await apiRequest<CurrentUser>('/auth/me')
  profileDraft.value = {
    first_names: user.value.person.first_names,
    last_names: user.value.person.last_names,
    phone: user.value.person.phone ?? '',
    email: user.value.person.email ?? '',
    profile_photo: user.value.profile_photo ?? '',
  }
  if (user.value.must_change_password) view.value = 'profile'
  else if (!navItems.value.some((item) => item.key === view.value)) view.value = navItems.value[0]?.key ?? 'profile'
}

function openView(nextView: WorkspaceView) {
  view.value = nextView
  selectedPatient.value = null
  clearMessages()
  if (nextView === 'patients') void loadPatients()
}

async function saveProfile() {
  clearMessages()
  busy.value = true
  try {
    user.value = await apiRequest<CurrentUser>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({
        ...profileDraft.value,
        phone: profileDraft.value.phone || null,
        email: profileDraft.value.email || null,
        profile_photo: profileDraft.value.profile_photo || null,
      }),
    })
    successMessage.value = 'Perfil actualizado.'
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

async function selectPatient(patient: Patient) {
  clearMessages()
  selectedPatient.value = patient
  contact.value = null
  backgrounds.value = []
  patientAppointments.value = []
  patientConsultations.value = []
  patientInvoices.value = []
  patientDetailTab.value = 'overview'
  const requests: Promise<unknown>[] = [
    apiRequest<Patient>(`/patients/${patient.id}`).then((detail) => (selectedPatient.value = detail)),
  ]
  if (can('patients.contact.read')) {
    requests.push(apiRequest<PatientContact>(`/patients/${patient.id}/contact`).then((value) => (contact.value = value)))
  }
  if (can('patients.medical_history.read')) {
    requests.push(
      apiRequest<MedicalBackground[]>(`/patients/${patient.id}/backgrounds`).then(
        (value) => (backgrounds.value = value),
      ),
    )
  }
  if (can('appointments.read')) {
    requests.push(
      apiRequest<AppointmentRecord[]>('/appointments/').then(
        (value) => (patientAppointments.value = value.filter((item) => item.patient_id === patient.id)),
      ),
    )
  }
  if (can('medical_consultations.read')) {
    requests.push(
      apiRequest<ConsultationRecord[]>(`/consultations/?patient_id=${patient.id}`).then(
        (value) => (patientConsultations.value = value),
      ),
    )
  }
  if (can('billing.read')) {
    requests.push(
      apiRequest<InvoiceRecord[]>(`/invoices/?patient_id=${patient.id}`).then(
        (value) => (patientInvoices.value = value),
      ),
    )
  }
  try {
    await Promise.all(requests)
  } catch (error) {
    reportError(error)
  }
}

async function downloadPatientHistory() {
  if (!selectedPatient.value) return
  try {
    await apiDownload(`/patients/${selectedPatient.value.id}/history.pdf`, `historia-clinica-${selectedPatient.value.id}.pdf`)
  } catch (error) {
    reportError(error)
  }
}

function startCreatePatient() {
  clearMessages()
  editingPatient.value = false
  draft.value = emptyPatient()
  showPatientForm.value = true
}

function startEditPatient() {
  if (!selectedPatient.value) return
  const patient = selectedPatient.value
  draft.value = {
    ...emptyPatient(),
    ...patient.person,
    ...contact.value,
    document_type: patient.person.document_type ?? '',
    document_number: patient.person.document_number ?? '',
    birth_date: patient.person.birth_date ?? '',
    phone: contact.value?.phone ?? '',
    email: contact.value?.email ?? '',
    address: contact.value?.address ?? '',
    city: contact.value?.city ?? '',
  }
  editingPatient.value = true
  showPatientForm.value = true
}

async function savePatient() {
  clearMessages()
  busy.value = true
  const person = {
    ...draft.value,
    birth_date: draft.value.birth_date || null,
    document_type: draft.value.document_type || null,
    document_number: draft.value.document_number || null,
    phone: draft.value.phone || null,
    email: draft.value.email || null,
    address: draft.value.address || null,
    city: draft.value.city || null,
  }
  try {
    const saved = editingPatient.value && selectedPatient.value
      ? await apiRequest<Patient>(`/patients/${selectedPatient.value.id}`, {
          method: 'PATCH',
          body: JSON.stringify(person),
        })
      : await apiRequest<Patient>('/patients/', {
          method: 'POST',
          body: JSON.stringify({ person }),
        })
    showPatientForm.value = false
    successMessage.value = editingPatient.value ? 'Paciente actualizado.' : 'Paciente registrado.'
    await loadPatients()
    await selectPatient(saved)
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

async function deactivateSelectedPatient() {
  if (!selectedPatient.value || !window.confirm('¿Desactivar este paciente? Su historia permanecerá disponible.')) return
  clearMessages()
  try {
    await apiRequest<void>(`/patients/${selectedPatient.value.id}/deactivate`, { method: 'POST' })
    successMessage.value = 'Paciente desactivado. La información histórica se conservó.'
    selectedPatient.value.active = false
    await loadPatients()
  } catch (error) {
    reportError(error)
  }
}

async function saveBackground() {
  if (!selectedPatient.value) return
  clearMessages()
  busy.value = true
  try {
    await apiRequest<MedicalBackground>(`/patients/${selectedPatient.value.id}/backgrounds`, {
      method: 'POST',
      body: JSON.stringify({
        ...backgroundDraft.value,
        occurred_on: backgroundDraft.value.occurred_on || null,
        observations: backgroundDraft.value.observations || null,
      }),
    })
    backgrounds.value = await apiRequest<MedicalBackground[]>(`/patients/${selectedPatient.value.id}/backgrounds`)
    showBackgroundForm.value = false
    backgroundDraft.value = { category: 'ALERGIA', description: '', occurred_on: '', observations: '' }
    successMessage.value = 'Antecedente registrado.'
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

async function signIn() {
  clearMessages()
  busy.value = true
  try {
    const response = await apiRequest<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm.value),
    })
    setAccessToken(response.access_token)
    await loadProfile()
    if (!user.value?.must_change_password) await loadPatients()
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

async function changePassword() {
  clearMessages()
  busy.value = true
  try {
    user.value = await apiRequest<CurrentUser>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(passwordForm.value),
    })
    passwordForm.value = { current_password: '', new_password: '' }
    successMessage.value = 'Contraseña actualizada.'
    if (can('patients.read')) await loadPatients()
    else if (navItems.value.length) view.value = navItems.value[0]?.key ?? 'profile'
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

async function signOut() {
  setAccessToken(null)
  user.value = null
  patients.value = []
  selectedPatient.value = null
  view.value = 'patients'
}

watch([search, activeFilter], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadPatients(), 250)
})

onMounted(async () => {
  if (!hasAccessToken()) return
  try {
    await loadProfile()
    if (!user.value?.must_change_password) await loadPatients()
  } catch {
    setAccessToken(null)
    user.value = null
  }
})
</script>

<template>
  <main v-if="!user" class="login-screen">
    <section class="login-aside">
      <div class="brand-mark"><span>H</span><div>HOSPIFER<small>GESTIÓN CLÍNICA</small></div></div>
      <div class="login-message">
        <p class="eyebrow">CENTRO DE OPERACIONES</p>
        <h1>Una atención<br />que empieza<br /><em>por escuchar.</em></h1>
        <p>Información clínica organizada para acompañar cada etapa del cuidado.</p>
      </div>
      <div class="aside-foot"><span>01</span><span>GESTIÓN · CUIDADO · CONTINUIDAD</span></div>
    </section>
    <section class="login-panel">
      <div class="mobile-brand brand-mark"><span>H</span><div>HOSPIFER<small>GESTIÓN CLÍNICA</small></div></div>
      <form class="login-form" @submit.prevent="signIn">
        <p class="eyebrow">ACCESO SEGURO</p>
        <h2>Bienvenido de nuevo</h2>
        <p class="muted">Ingresa tus credenciales para continuar.</p>
        <label>Usuario<input v-model="loginForm.username" autocomplete="username" required /></label>
        <label>Contraseña<input v-model="loginForm.password" type="password" autocomplete="current-password" required /></label>
        <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
        <button class="button primary full" :disabled="busy">{{ busy ? 'Ingresando…' : 'Iniciar sesión' }} <span>→</span></button>
        <p class="login-foot">Acceso exclusivo para personal autorizado.</p>
      </form>
    </section>
  </main>

  <main v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand-mark"><span>H</span><div>HOSPIFER<small>GESTIÓN CLÍNICA</small></div></div>
      <div class="side-label">ESPACIO DE TRABAJO</div>
      <nav class="side-nav">
        <button v-for="item in navItems" :key="item.key" :class="{ selected: view === item.key }" @click="openView(item.key)">
          <span class="nav-glyph">{{ item.glyph }}</span> {{ item.label }} <span v-if="item.key === 'patients'" class="nav-count">{{ patients.length }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="secure-note"><span class="status-dot"></span><div>Sesión protegida<small>{{ user.roles.join(' · ') }}</small></div></div>
        <button class="signout" @click="signOut"><span>↪</span> Cerrar sesión</button>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div class="breadcrumb">HOSPIFER <span>/</span> {{ viewTitle }}</div>
        <div class="top-user"><span class="avatar">{{ displayName.slice(0, 1).toUpperCase() || 'U' }}</span><span>{{ displayName }}</span></div>
      </header>

      <div v-if="errorMessage" class="notice error global-notice"><span>!</span>{{ errorMessage }}<button @click="errorMessage = ''">×</button></div>
      <div v-if="successMessage" class="notice success global-notice"><span>✓</span>{{ successMessage }}<button @click="successMessage = ''">×</button></div>

      <section v-if="user.must_change_password" class="profile-page password-required">
        <p class="eyebrow">CONFIGURACIÓN DE CUENTA</p>
        <h1>Actualiza tu contraseña</h1>
        <p class="muted">Por seguridad, debes cambiar la contraseña inicial antes de acceder a los datos clínicos.</p>
        <form class="form-grid password-form" @submit.prevent="changePassword">
          <label class="span-2">Contraseña actual<input v-model="passwordForm.current_password" type="password" autocomplete="current-password" required /></label>
          <label class="span-2">Nueva contraseña<input v-model="passwordForm.new_password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required /><small>Usa al menos 12 caracteres.</small></label>
          <div class="form-actions span-2"><button class="button primary" :disabled="busy">{{ busy ? 'Guardando…' : 'Cambiar contraseña' }}</button></div>
        </form>
      </section>

      <section v-else-if="view === 'patients'" class="patients-page">
        <div class="page-heading">
          <div><p class="eyebrow">DIRECTORIO CLÍNICO <span class="heading-rule"></span> {{ activeCount }} ACTIVOS</p><h1>Pacientes</h1><p class="muted">Consulta y administra los registros de atención.</p></div>
          <button v-if="can('patients.create')" class="button primary" @click="startCreatePatient"><span class="button-plus">+</span> Registrar paciente</button>
        </div>

        <div class="table-tools">
          <label class="search-box"><span>⌕</span><input v-model="search" placeholder="Buscar nombre o documento" aria-label="Buscar pacientes" /><kbd>⌘ K</kbd></label>
          <div class="filter-tabs" role="group" aria-label="Filtrar por estado">
            <button v-for="filter in [{ key: 'active', label: 'Activos' }, { key: 'inactive', label: 'Inactivos' }, { key: 'all', label: 'Todos' }]" :key="filter.key" :class="{ current: activeFilter === filter.key }" @click="activeFilter = filter.key as 'active' | 'inactive' | 'all'">{{ filter.label }}</button>
          </div>
        </div>

        <div class="content-grid" :class="{ 'with-detail': selectedPatient }">
          <section class="table-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>Documento</th><th>Fecha de nacimiento</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                <tr v-for="patient in patients" :key="patient.id" :class="{ active: selectedPatient?.id === patient.id }" @click="selectPatient(patient)">
                  <td><div class="patient-name"><span class="patient-avatar">{{ patient.person.first_names.slice(0, 1) }}{{ patient.person.last_names.slice(0, 1) }}</span><span>{{ patient.person.first_names }} {{ patient.person.last_names }}</span></div></td>
                  <td class="document">{{ patient.person.document_type || '—' }} {{ patient.person.document_number || 'Sin documento' }}</td>
                  <td class="date-cell">{{ patient.person.birth_date || '—' }}</td>
                  <td><span class="state" :class="patient.active ? 'state-active' : 'state-inactive'">{{ patient.active ? 'Activo' : 'Inactivo' }}</span></td>
                  <td class="row-arrow">→</td>
                </tr>
                <tr v-if="!patients.length && !loadingPatients"><td colspan="5" class="empty-state"><span>⌕</span><strong>No hay pacientes para mostrar</strong><small>Prueba otra búsqueda o registra un nuevo paciente.</small></td></tr>
                <tr v-if="loadingPatients"><td colspan="5" class="loading-state">Actualizando directorio…</td></tr>
              </tbody>
            </table>
            <footer class="table-footer"><span>{{ patients.length }} registros en esta vista</span><span>Datos clínicos protegidos</span></footer>
          </section>

          <aside v-if="selectedPatient" class="detail-panel">
            <div class="detail-head"><div><p class="eyebrow">FICHA DE PACIENTE</p><span class="state" :class="selectedPatient.active ? 'state-active' : 'state-inactive'">{{ selectedPatient.active ? 'Activo' : 'Inactivo' }}</span></div><button class="icon-button" aria-label="Cerrar ficha" @click="selectedPatient = null">×</button></div>
            <div class="patient-identity"><span class="detail-avatar">{{ selectedPatient.person.first_names.slice(0, 1) }}{{ selectedPatient.person.last_names.slice(0, 1) }}</span><h2>{{ selectedPatient.person.first_names }} {{ selectedPatient.person.last_names }}</h2><p>{{ selectedPatient.person.document_type || 'Documento' }} {{ selectedPatient.person.document_number || 'no registrado' }}</p></div>
            <div class="detail-actions"><button v-if="can('patients.update') && selectedPatient.active" class="button secondary" @click="startEditPatient">Editar datos</button><button v-if="can('patients.deactivate') && selectedPatient.active" class="button quiet-danger" @click="deactivateSelectedPatient">Desactivar</button><button v-if="can('medical_history.export')" class="text-action" @click="downloadPatientHistory">Historia PDF</button></div>
            <nav class="detail-tabs" aria-label="Secciones del paciente"><button :class="{ current: patientDetailTab === 'overview' }" @click="patientDetailTab = 'overview'">Resumen</button><button v-if="can('appointments.read')" :class="{ current: patientDetailTab === 'appointments' }" @click="patientDetailTab = 'appointments'">Citas {{ patientAppointments.length }}</button><button v-if="can('medical_consultations.read')" :class="{ current: patientDetailTab === 'consultations' }" @click="patientDetailTab = 'consultations'">Consultas {{ patientConsultations.length }}</button><button v-if="can('billing.read')" :class="{ current: patientDetailTab === 'billing' }" @click="patientDetailTab = 'billing'">Facturas {{ patientInvoices.length }}</button></nav>
            <div v-if="patientDetailTab === 'overview'"><section class="detail-section"><h3>INFORMACIÓN PERSONAL</h3><dl><div><dt>Fecha de nacimiento</dt><dd>{{ selectedPatient.person.birth_date || 'No registrada' }}</dd></div><div><dt>Fecha de registro</dt><dd>{{ new Date(selectedPatient.created_at).toLocaleDateString() }}</dd></div></dl></section><section v-if="contact && can('patients.contact.read')" class="detail-section"><h3>CONTACTO</h3><dl><div><dt>Teléfono</dt><dd>{{ contact.phone || 'No registrado' }}</dd></div><div><dt>Correo</dt><dd>{{ contact.email || 'No registrado' }}</dd></div><div><dt>Dirección</dt><dd>{{ contact.address || 'No registrada' }}</dd></div><div><dt>Ciudad</dt><dd>{{ contact.city || 'No registrada' }}</dd></div></dl></section><section v-if="can('patients.medical_history.read')" class="detail-section history-section"><div class="section-title"><h3>ANTECEDENTES</h3><button v-if="can('patients.background.create') && selectedPatient.active" class="text-action" @click="showBackgroundForm = true">+ Agregar</button></div><div v-if="backgrounds.length" class="history-list"><article v-for="item in backgrounds" :key="item.id"><span>{{ item.category.replaceAll('_', ' ') }}</span><p>{{ item.description }}</p><small>{{ item.occurred_on || 'Fecha no indicada' }}</small></article></div><p v-else class="detail-empty">Sin antecedentes registrados.</p></section></div>
            <section v-else-if="patientDetailTab === 'appointments'" class="detail-section"><h3>CITAS</h3><article v-for="appointment in patientAppointments" :key="appointment.id" class="compact-record"><strong>{{ new Date(appointment.start_at).toLocaleString() }}</strong><span>{{ appointment.professional_name }}</span><small>{{ appointment.status }} · {{ appointment.reason || 'Sin motivo indicado' }}</small></article><p v-if="!patientAppointments.length" class="detail-empty">Sin citas registradas.</p></section>
            <section v-else-if="patientDetailTab === 'consultations'" class="detail-section"><h3>CONSULTAS MÉDICAS</h3><article v-for="consultation in patientConsultations" :key="consultation.id" class="compact-record"><strong>{{ new Date(consultation.created_at).toLocaleString() }}</strong><span>{{ consultation.diagnosis || 'Sin diagnóstico' }}</span><small>{{ consultation.voided_at ? 'ANULADA' : 'VIGENTE' }} · {{ consultation.treatment || 'Sin tratamiento' }}</small></article><p v-if="!patientConsultations.length" class="detail-empty">Sin consultas registradas.</p></section>
            <section v-else class="detail-section"><h3>FACTURACIÓN</h3><article v-for="invoice in patientInvoices" :key="invoice.id" class="compact-record"><strong>Factura #{{ invoice.id }} · {{ Number(invoice.total).toLocaleString(undefined, { style: 'currency', currency: 'USD' }) }}</strong><span>{{ new Date(invoice.created_at).toLocaleDateString() }}</span><small>{{ invoice.status }} · {{ invoice.items.map((item) => item.description).join(', ') }}</small></article><p v-if="!patientInvoices.length" class="detail-empty">Sin facturas registradas.</p></section>
          </aside>
        </div>
      </section>

      <section v-else-if="view === 'profile'" class="profile-page">
        <p class="eyebrow">CUENTA PERSONAL</p><h1>Mi perfil</h1><p class="muted">Datos de la cuenta con la que accediste.</p>
        <div class="profile-summary"><span class="profile-avatar">{{ displayName.slice(0, 1).toUpperCase() }}</span><div><h2>{{ displayName }}</h2><p>@{{ user.username }} · {{ user.roles.join(', ') }}</p></div></div>
        <section class="profile-section"><div><h2>Información personal</h2><p class="muted">Estos cambios solo afectan tu propia cuenta.</p></div><form class="form-grid" @submit.prevent="saveProfile"><label>Nombres<input v-model="profileDraft.first_names" required maxlength="120" /></label><label>Apellidos<input v-model="profileDraft.last_names" required maxlength="120" /></label><label>Teléfono<input v-model="profileDraft.phone" maxlength="40" /></label><label>Correo electrónico<input v-model="profileDraft.email" type="email" maxlength="254" /></label><label class="span-2">Foto de perfil (URL)<input v-model="profileDraft.profile_photo" maxlength="500" /></label><div class="form-actions span-2"><button class="button primary" :disabled="busy">Guardar perfil</button></div></form></section>
        <section class="profile-section"><div><h2>Seguridad de la cuenta</h2><p class="muted">Actualiza tu contraseña de acceso.</p></div><form class="form-grid" @submit.prevent="changePassword"><label>Contraseña actual<input v-model="passwordForm.current_password" type="password" autocomplete="current-password" required /></label><label>Nueva contraseña<input v-model="passwordForm.new_password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required /><small>Al menos 12 caracteres.</small></label><div class="form-actions span-2"><button class="button primary" :disabled="busy">{{ busy ? 'Guardando…' : 'Actualizar contraseña' }}</button></div></form></section>
      </section>
      <OperationsWorkspace v-else :view="view" :user="user" @error="errorMessage = $event" @success="successMessage = $event" />
    </section>

    <div v-if="showPatientForm" class="modal-backdrop" @click.self="showPatientForm = false">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="patient-form-title">
        <header class="modal-head"><div><p class="eyebrow">{{ editingPatient ? 'ACTUALIZAR REGISTRO' : 'NUEVO REGISTRO' }}</p><h2 id="patient-form-title">{{ editingPatient ? 'Editar paciente' : 'Registrar paciente' }}</h2></div><button class="icon-button" aria-label="Cerrar" @click="showPatientForm = false">×</button></header>
        <form class="form-grid" @submit.prevent="savePatient">
          <label>Nombres<input v-model="draft.first_names" required maxlength="120" /></label><label>Apellidos<input v-model="draft.last_names" required maxlength="120" /></label>
          <label>Tipo de documento<select v-model="draft.document_type"><option value="">Seleccionar</option><option>CC</option><option>CE</option><option>TI</option><option>PA</option><option>OTRO</option></select></label><label>Número de documento<input v-model="draft.document_number" maxlength="60" /></label>
          <label>Fecha de nacimiento<input v-model="draft.birth_date" type="date" /></label><label>Teléfono<input v-model="draft.phone" type="tel" maxlength="40" /></label>
          <label>Correo electrónico<input v-model="draft.email" type="email" maxlength="254" /></label><label>Ciudad<input v-model="draft.city" maxlength="120" /></label>
          <label class="span-2">Dirección<input v-model="draft.address" maxlength="300" /></label>
          <div class="form-actions span-2"><button type="button" class="button secondary" @click="showPatientForm = false">Cancelar</button><button class="button primary" :disabled="busy">{{ busy ? 'Guardando…' : 'Guardar paciente' }}</button></div>
        </form>
      </section>
    </div>

    <div v-if="showBackgroundForm" class="modal-backdrop" @click.self="showBackgroundForm = false">
      <section class="modal-panel compact-modal" role="dialog" aria-modal="true" aria-labelledby="background-form-title">
        <header class="modal-head"><div><p class="eyebrow">HISTORIA CLÍNICA</p><h2 id="background-form-title">Nuevo antecedente</h2></div><button class="icon-button" aria-label="Cerrar" @click="showBackgroundForm = false">×</button></header>
        <form class="form-grid" @submit.prevent="saveBackground">
          <label class="span-2">Tipo<select v-model="backgroundDraft.category"><option>ALERGIA</option><option>ENFERMEDAD</option><option>CIRUGIA</option><option>ANTECEDENTE_FAMILIAR</option><option>MEDICAMENTO</option><option>OTRO</option></select></label>
          <label class="span-2">Descripción<textarea v-model="backgroundDraft.description" required maxlength="4000" rows="3"></textarea></label>
          <label class="span-2">Fecha<input v-model="backgroundDraft.occurred_on" type="date" /></label>
          <label class="span-2">Observaciones<textarea v-model="backgroundDraft.observations" maxlength="4000" rows="3"></textarea></label>
          <div class="form-actions span-2"><button type="button" class="button secondary" @click="showBackgroundForm = false">Cancelar</button><button class="button primary" :disabled="busy">Guardar antecedente</button></div>
        </form>
      </section>
    </div>
  </main>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap');

:root{font-family:'DM Sans',sans-serif;color:#1f2f2a;background:#f4f5f0;font-synthesis:none;text-rendering:optimizeLegibility;font-weight:400;--ink:#1f2f2a;--muted:#7b8580;--line:#e1e6df;--paper:#fff;--canvas:#f4f5f0;--forest:#17463b;--forest-dark:#10392f;--sage:#e5eee8;--rust:#c86c4e;--rust-pale:#f9ece6;--gold:#d7b763}
*{box-sizing:border-box}body{margin:0;min-width:360px;min-height:100vh}button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.65}input,select,textarea{width:100%;border:1px solid #d9dfd8;background:#fff;border-radius:4px;padding:11px 12px;color:var(--ink);outline:none;transition:border-color .15s,box-shadow .15s}input:focus,select:focus,textarea:focus{border-color:#5c8e78;box-shadow:0 0 0 3px #e5eee8}label{display:grid;gap:7px;font-size:12px;font-weight:600;color:#52625a}label small{font-size:11px;font-weight:400;color:var(--muted)}
.login-screen{min-height:100vh;display:grid;grid-template-columns:minmax(420px,1.05fr) 1fr;background:var(--paper);animation:appear .45s ease-out}.login-aside{background:var(--forest-dark);color:#fff;padding:34px 7vw 28px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.login-aside:after{content:'';position:absolute;inset:52% -20% -34% 25%;border:1px solid #ffffff20;border-radius:50%;transform:rotate(-19deg);pointer-events:none}.brand-mark{display:flex;align-items:center;gap:11px;font-weight:700;letter-spacing:0;color:#f8fbf8;font-size:13px}.brand-mark>span{width:38px;aspect-ratio:1;border:1px solid #ffffff70;display:grid;place-items:center;font-family:'Newsreader',serif;font-size:24px;font-weight:500;color:var(--gold)}.brand-mark small{display:block;font-size:8px;letter-spacing:0;color:#9fb7aa;margin-top:4px}.login-message{max-width:440px;position:relative;z-index:1}.eyebrow{font-size:10px;font-weight:700;letter-spacing:0;color:#74867d;margin:0 0 12px}.login-message .eyebrow{color:#b4c9bb}.login-message h1,.login-form h2,.page-heading h1,.profile-page h1{font-family:'Newsreader',serif;font-weight:500;letter-spacing:0}.login-message h1{font-size:clamp(48px,5vw,72px);line-height:.98;margin:0 0 22px}.login-message h1 em{font-weight:500;color:#dfc47a}.login-message>p:last-child{font-size:14px;line-height:1.8;color:#d1ded5;max-width:340px}.aside-foot{display:flex;gap:14px;align-items:center;color:#a5bbb0;font-size:9px;letter-spacing:0;position:relative;z-index:1}.aside-foot span:first-child{color:var(--gold);font-size:12px}.login-panel{display:grid;place-items:center;padding:52px}.login-form{width:min(100%,380px)}.login-form .eyebrow{color:#799185}.login-form h2{font-size:36px;margin:0 0 7px}.muted{color:var(--muted);font-size:13px;line-height:1.65}.login-form>.muted{margin:0 0 34px}.login-form label{margin:17px 0}.login-form input{height:46px}.button{border:1px solid transparent;border-radius:4px;padding:10px 15px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:11px;min-height:40px;transition:background .15s,border-color .15s,color .15s}.button.primary{background:var(--forest);color:#fff}.button.primary:hover{background:var(--forest-dark)}.button.primary span:last-child{font-size:17px;font-weight:400}.button.secondary{background:#fff;border-color:#d8e0d8;color:#40554a}.button.secondary:hover{background:#f4f7f3}.button.full{width:100%;margin-top:7px;height:46px}.login-foot{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);font-size:11px;color:#8b948f}.mobile-brand{display:none}
.app-shell{min-height:100vh;display:grid;grid-template-columns:238px minmax(0,1fr);animation:appear .35s ease-out}.sidebar{background:var(--forest-dark);color:#fff;min-height:100vh;padding:25px 16px 18px;display:flex;flex-direction:column}.sidebar .brand-mark{padding:0 8px 28px;border-bottom:1px solid #ffffff1b}.side-label{font-size:9px;font-weight:700;color:#87a397;margin:24px 9px 11px}.side-nav{display:grid;gap:5px}.side-nav button,.signout{width:100%;display:flex;align-items:center;gap:11px;text-align:left;border:0;background:transparent;color:#c6d4cc;padding:11px 10px;border-radius:4px;font-size:12px}.side-nav button:hover,.signout:hover{background:#ffffff0b;color:#fff}.side-nav button.selected{background:#ffffff16;color:#fff}.nav-glyph{width:17px;color:#c4d8c9;font-size:16px;text-align:center}.nav-count{margin-left:auto;color:#b9c8bf;font-size:10px}.sidebar-bottom{margin-top:auto}.secure-note{border-top:1px solid #ffffff1b;padding:17px 7px;display:flex;gap:9px;align-items:flex-start;color:#dce7e0;font-size:11px}.status-dot{display:block;width:7px;height:7px;border-radius:50%;background:#82bc91;margin-top:4px;box-shadow:0 0 0 3px #82bc9122}.secure-note small{display:block;color:#91a99b;font-size:9px;margin-top:5px}.signout{border-top:1px solid #ffffff1b;border-radius:0;color:#b9c8bf;padding:15px 8px 4px}.signout span{font-size:17px}.workspace{min-width:0}.topbar{height:62px;background:#fff;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;padding:0 36px}.breadcrumb{font-size:9px;font-weight:700;letter-spacing:0;color:#6e7c74}.breadcrumb span{color:#b9c2bb;margin:0 8px}.top-user{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:600;color:#526158}.avatar{width:29px;height:29px;border-radius:50%;background:#e8eee7;color:var(--forest);display:grid;place-items:center;font-size:11px}.patients-page,.profile-page{padding:34px 36px 42px;max-width:1520px;margin:0 auto}.page-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:27px}.page-heading .eyebrow{color:#79877f}.heading-rule{display:inline-block;width:27px;height:1px;background:var(--gold);vertical-align:middle;margin:0 7px 3px}.page-heading h1,.profile-page h1{font-size:43px;margin:0;line-height:1.1}.page-heading .muted,.profile-page>.muted{margin:8px 0 0}.button-plus{font-size:19px;font-weight:400;line-height:12px}.table-tools{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:13px 15px;background:#fff;border:1px solid var(--line);border-bottom:0;border-radius:4px 4px 0 0}.search-box{display:flex;align-items:center;gap:9px;width:min(390px,55%);position:relative}.search-box>span{font-size:21px;color:#7d8a81;line-height:1}.search-box input{border:0;padding:7px 0;box-shadow:none;font-size:12px}.search-box input:focus{box-shadow:none}.search-box kbd{font-size:9px;color:#8c9690;border:1px solid var(--line);padding:3px 5px;border-radius:3px;white-space:nowrap}.filter-tabs{display:flex;align-items:center;gap:4px}.filter-tabs button{border:0;background:transparent;color:#718078;padding:8px 10px;border-radius:3px;font-size:11px}.filter-tabs button.current{background:#e9f0e9;color:var(--forest);font-weight:700}.content-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:15px;align-items:start}.content-grid.with-detail{grid-template-columns:minmax(500px,1fr) 330px}.table-wrap{background:#fff;border:1px solid var(--line);border-radius:0 0 4px 4px;overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{background:#fafbf9;color:#839087;font-size:9px;font-weight:700;padding:12px 15px;border-bottom:1px solid var(--line)}td{font-size:11px;padding:12px 15px;border-bottom:1px solid #edf0eb;color:#536159}tbody tr:not(:has(.empty-state)):not(:has(.loading-state)){cursor:pointer}tbody tr:not(:has(.empty-state)):not(:has(.loading-state)):hover,tbody tr.active{background:#f5f8f4}.patient-name{display:flex;align-items:center;gap:9px;color:#263a30;font-weight:600}.patient-avatar{width:29px;height:29px;display:grid;place-items:center;border-radius:50%;background:#e8eee7;color:#416d56;font-size:9px;font-weight:700}.document{color:#69776e}.date-cell{color:#748077}.state{display:inline-flex;align-items:center;gap:6px;padding:4px 7px;border-radius:2px;font-size:9px;font-weight:600}.state:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.state-active{background:#eaf3eb;color:#4c8057}.state-inactive{background:#f2f2ef;color:#81877f}.row-arrow{font-size:15px;color:#99a49d}.table-footer{display:flex;justify-content:space-between;padding:12px 14px;color:#87918a;font-size:9px}.empty-state,.loading-state{text-align:center!important;padding:45px 12px!important;color:#7d8981}.empty-state span{display:block;font-size:22px;color:#9eaaa1;margin-bottom:10px}.empty-state strong,.empty-state small{display:block}.empty-state strong{font-size:12px;color:#506057}.empty-state small{font-size:10px;margin-top:5px}.detail-panel{background:#fff;border:1px solid var(--line);border-radius:4px;padding:18px 18px 20px;animation:slide-in .2s ease-out}.detail-head{display:flex;justify-content:space-between;align-items:flex-start}.detail-head .eyebrow{margin-bottom:8px}.icon-button{border:0;background:transparent;color:#78857d;font-size:22px;line-height:1;padding:1px 4px}.patient-identity{text-align:center;padding:12px 0 18px;border-bottom:1px solid var(--line)}.detail-avatar,.profile-avatar{margin:0 auto;width:56px;height:56px;border-radius:50%;background:#e9f0e9;color:#3c7557;display:grid;place-items:center;font-family:'Newsreader',serif;font-size:22px}.patient-identity h2{font-family:'Newsreader',serif;font-size:23px;font-weight:500;margin:10px 0 3px}.patient-identity p{font-size:10px;color:#7a877f;margin:0}.detail-actions{display:flex;gap:7px;padding:12px 0;border-bottom:1px solid var(--line)}.detail-actions .button{font-size:10px;padding:8px 10px;min-height:34px}.quiet-danger{background:var(--rust-pale);color:#a85237}.detail-section{padding:15px 0;border-bottom:1px solid var(--line)}.detail-section:last-child{border-bottom:0;padding-bottom:0}.detail-section h3{margin:0;color:#87938b;font-size:9px;letter-spacing:0;font-weight:700}.detail-section dl{display:grid;gap:12px;margin:12px 0 0}.detail-section dl div{display:flex;justify-content:space-between;gap:9px}.detail-section dt{font-size:10px;color:#828d85}.detail-section dd{margin:0;text-align:right;font-size:10px;color:#31453a;max-width:58%;overflow-wrap:anywhere}.section-title{display:flex;align-items:center;justify-content:space-between}.text-action{border:0;background:transparent;color:#3e7655;font-size:10px;font-weight:700;padding:2px}.history-list{display:grid;gap:8px;margin-top:12px}.history-list article{padding:10px;background:#f6f8f5;border-left:2px solid #86a88d}.history-list article span{font-size:8px;color:#61806a;font-weight:700}.history-list article p{font-size:10px;margin:5px 0;color:#394c41}.history-list article small{font-size:9px;color:#89948c}.detail-empty{font-size:10px;color:#89948c;margin:12px 0 0}.profile-page{max-width:900px}.profile-page>.eyebrow{margin-top:7px}.profile-page h1{margin-top:2px}.password-required{max-width:620px;margin:8vh auto}.password-form{margin-top:28px}.profile-summary{display:flex;align-items:center;gap:15px;background:#fff;border:1px solid var(--line);padding:20px;margin-top:26px;border-radius:4px}.profile-avatar{margin:0;width:48px;height:48px;font-size:20px}.profile-summary h2{font-family:'Newsreader',serif;font-size:21px;font-weight:500;margin:0 0 4px}.profile-summary p{font-size:10px;color:#7b8980;margin:0}.profile-section{display:grid;grid-template-columns:1fr 1.4fr;gap:35px;padding:25px 0;border-top:1px solid var(--line);margin-top:25px}.profile-section h2{font-size:14px;margin:0 0 5px}.profile-section .muted{margin:0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.span-2{grid-column:span 2}.form-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}.notice{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:3px;font-size:11px}.notice.error{background:#fff0eb;color:#a74d32}.notice.success{background:#edf5ed;color:#397148}.notice>span{font-weight:700}.notice button{margin-left:auto;background:transparent;border:0;color:inherit;font-size:16px}.global-notice{margin:12px 36px 0}.modal-backdrop{position:fixed;inset:0;background:#14251f82;display:grid;place-items:center;padding:20px;z-index:5;animation:appear .15s ease-out}.modal-panel{width:min(100%,680px);max-height:min(90vh,850px);overflow:auto;background:#fff;border-radius:5px;padding:24px;box-shadow:0 20px 60px #10231d40}.compact-modal{width:min(100%,500px)}.modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:21px}.modal-head h2{font-family:'Newsreader',serif;font-size:27px;font-weight:500;margin:0}.modal-head .eyebrow{margin-bottom:5px}.modal-panel textarea{resize:vertical}.modal-panel .form-grid{gap:14px}
@keyframes appear{from{opacity:0}to{opacity:1}}@keyframes slide-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:1100px){.app-shell{grid-template-columns:205px minmax(0,1fr)}.patients-page,.profile-page{padding:28px 24px}.topbar{padding:0 24px}.content-grid.with-detail{grid-template-columns:minmax(420px,1fr) 300px}.detail-panel{padding:15px}.table-tools{align-items:flex-start;flex-direction:column}.search-box{width:100%}.filter-tabs{align-self:flex-end}}
@media(max-width:760px){body{min-width:360px}.login-screen{grid-template-columns:1fr}.login-aside{display:none}.login-panel{padding:30px 24px;align-content:center}.mobile-brand{display:flex;margin-bottom:55px;color:var(--forest)}.mobile-brand small{color:#809188}.mobile-brand>span{border-color:#abc0b3}.login-form h2{font-size:32px}.app-shell{grid-template-columns:1fr;grid-template-rows:auto 1fr}.sidebar{min-height:auto;padding:12px 15px;display:grid;grid-template-columns:1fr auto;align-items:center}.sidebar .brand-mark{padding:0;border:0}.sidebar .brand-mark>span{width:32px;font-size:20px}.sidebar .brand-mark small{font-size:7px}.side-label,.sidebar-bottom{display:none}.side-nav{display:flex;justify-content:flex-end}.side-nav button{width:auto;padding:8px 10px;font-size:11px}.nav-count{display:none}.topbar{height:50px;padding:0 16px}.top-user>span:last-child{display:none}.patients-page,.profile-page{padding:25px 14px}.page-heading{align-items:flex-start;gap:15px;flex-direction:column;margin-bottom:20px}.page-heading h1,.profile-page h1{font-size:37px}.page-heading>.button{align-self:stretch}.table-tools{padding:10px}.filter-tabs{align-self:stretch;justify-content:space-between;width:100%}.filter-tabs button{flex:1}.content-grid.with-detail{grid-template-columns:minmax(0,1fr)}.table-wrap{overflow-x:auto}.detail-panel{grid-row:1}.global-notice{margin:10px 14px 0}.profile-section{grid-template-columns:1fr;gap:18px}.profile-section .form-grid{grid-template-columns:1fr}.profile-section .span-2{grid-column:auto}.modal-panel{padding:18px}.form-grid{gap:12px}.form-grid:not(.profile-section .form-grid){grid-template-columns:1fr 1fr}.login-foot{text-align:center}}
@media(max-width:500px){.form-grid{grid-template-columns:1fr!important}.form-grid .span-2{grid-column:auto}.modal-panel{padding:16px}.table-wrap th,.table-wrap td{padding-left:10px;padding-right:10px}.table-wrap th:nth-child(3),.table-wrap td:nth-child(3){display:none}.table-footer{font-size:8px}}
@media(max-width:760px){.sidebar{display:block;min-width:0}.side-nav{overflow-x:auto;justify-content:flex-start;padding-top:10px;scrollbar-width:thin}.side-nav button{flex:0 0 auto}.sidebar .brand-mark{display:flex}}
.detail-tabs{display:flex;gap:3px;overflow-x:auto;padding:10px 0;border-bottom:1px solid var(--line)}.detail-tabs button{flex:0 0 auto;border:0;background:transparent;color:#758279;padding:7px 8px;font-size:9px;border-radius:3px}.detail-tabs button.current{background:#eaf1e9;color:var(--forest);font-weight:700}.compact-record{display:grid;gap:5px;padding:11px 0;border-bottom:1px solid #edf0eb}.compact-record:last-of-type{border-bottom:0}.compact-record strong{font-size:10px;color:#34493d}.compact-record span,.compact-record small{font-size:9px;color:#718077}
</style>
