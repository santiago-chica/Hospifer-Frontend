<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  apiRequest,
  apiDownload,
  type AdminUserRecord,
  type AppointmentRecord,
  type CatalogRecord,
  type ConsultationRecord,
  type CurrentUser,
  type DashboardSummary,
  type InvoiceRecord,
  type MedicationRecord,
  type PermissionRecord,
  type Professional,
  type RoleRecord,
  type SpecialtyRecord,
  type WorkspaceView,
  type Patient,
} from '../api'

type OperationsView = Exclude<WorkspaceView, 'patients' | 'profile'>
type PermissionChoice = 'inherit' | 'allow' | 'deny'

const props = defineProps<{ view: OperationsView; user: CurrentUser }>()
const emit = defineEmits<{ error: [message: string]; success: [message: string] }>()

const professionals = ref<Professional[]>([])
const specialties = ref<SpecialtyRecord[]>([])
const appointments = ref<AppointmentRecord[]>([])
const consultations = ref<ConsultationRecord[]>([])
const catalog = ref<CatalogRecord[]>([])
const medications = ref<MedicationRecord[]>([])
const invoices = ref<InvoiceRecord[]>([])
const patients = ref<Patient[]>([])
const users = ref<AdminUserRecord[]>([])
const roles = ref<RoleRecord[]>([])
const permissions = ref<PermissionRecord[]>([])
const auditRows = ref<Array<Record<string, unknown>>>([])
const dashboardStats = ref<DashboardSummary>({
  patients_active: null,
  appointments_today: null,
  appointments_pending: null,
  consultations_recent: null,
  invoices_recent: null,
})
const loading = ref(false)
const busy = ref(false)
const showForm = ref(false)
const showRoleForm = ref(false)
const showMedicationForm = ref(false)

const professionalDraft = ref({ first_names: '', last_names: '', document_type: '', document_number: '', profession: '', registration_number: '', specialty_ids: [] as number[] })
const appointmentDraft = ref({ patient_id: 0, professional_id: 0, start_at: '', end_at: '', reason: '' })
const consultationDraft = ref({ appointment_id: 0, diagnosis: '', reason: '', treatment: '', medication_id: 0, dose: '', frequency: '', duration: '', route: 'Oral' })
const vitalsDraft = ref({ weight: '', height: '', temperature: '', heart_rate: '', respiratory_rate: '', oxygen_saturation: '', blood_pressure_systolic: '', blood_pressure_diastolic: '' })
const catalogDraft = ref({ item_type: 'SERVICE', name: '', description: '', unit_price: 0 })
const medicationDraft = ref({ name: '', active_ingredient: '', presentation: '', description: '' })
const invoiceDraft = ref({ patient_id: 0, tax: 0, discount: 0 })
const invoiceLines = ref([{ catalog_item_id: 0, quantity: 1 }])
const userDraft = ref({ first_names: '', last_names: '', username: '', password: '', role_ids: [] as number[] })
const roleDraft = ref({ name: '', description: '' })
const specialtyDraft = ref({ name: '' })
const selectedRoleId = ref(0)
const rolePermissionCodes = ref<string[]>([])
const selectedUserId = ref(0)
const selectedUserRoleIds = ref<number[]>([])
const overrideChoices = ref<Record<string, PermissionChoice>>({})

const can = (permission: string) => props.user.permissions.includes(permission)
const title = computed(() => ({
  dashboard: 'Dashboard',
  professionals: 'Profesionales',
  appointments: 'Citas',
  consultations: 'Consultas médicas',
  catalog: 'Productos y servicios',
  billing: 'Facturación',
  security: 'Seguridad',
  audit: 'Auditoría',
}[props.view]))
const activeProfessionals = computed(() => professionals.value.filter((item) => item.active))
const confirmedAppointments = computed(() => appointments.value.filter((item) => item.status === 'CONFIRMED'))
const selectedRole = computed(() => roles.value.find((role) => role.id === selectedRoleId.value))
const selectedUser = computed(() => users.value.find((item) => item.id === selectedUserId.value))

function personName(person: Patient['person']) {
  return `${person.first_names} ${person.last_names}`
}

async function load() {
  loading.value = true
  try {
    if (props.view === 'dashboard') {
      dashboardStats.value = await apiRequest<DashboardSummary>('/dashboard/summary')
    } else if (props.view === 'professionals') {
      [professionals.value, specialties.value] = await Promise.all([
        apiRequest<Professional[]>('/professionals/?active=true'),
        apiRequest<SpecialtyRecord[]>('/professionals/specialties'),
      ])
    } else if (props.view === 'appointments') {
      appointments.value = await apiRequest<AppointmentRecord[]>('/appointments/')
      if (can('patients.read')) patients.value = await apiRequest<Patient[]>('/patients/?active=true')
      if (can('professionals.read')) professionals.value = await apiRequest<Professional[]>('/professionals/?active=true')
    } else if (props.view === 'consultations') {
      consultations.value = await apiRequest<ConsultationRecord[]>('/consultations/')
      appointments.value = await apiRequest<AppointmentRecord[]>('/appointments/')
      if (can('products.read')) medications.value = await apiRequest<MedicationRecord[]>('/medications/')
    } else if (props.view === 'catalog') {
      [catalog.value, medications.value] = await Promise.all([
        apiRequest<CatalogRecord[]>('/catalog/'),
        apiRequest<MedicationRecord[]>('/medications/'),
      ])
    } else if (props.view === 'billing') {
      invoices.value = await apiRequest<InvoiceRecord[]>('/invoices/')
      if (can('patients.read')) patients.value = await apiRequest<Patient[]>('/patients/?active=true')
      if (can('products.read')) catalog.value = await apiRequest<CatalogRecord[]>('/catalog/')
    } else if (props.view === 'security') {
      const requests: Promise<void>[] = []
      if (can('users.read')) requests.push(apiRequest<AdminUserRecord[]>('/security/users').then((data) => { users.value = data }))
      if (can('roles.read')) requests.push(apiRequest<RoleRecord[]>('/security/roles').then((data) => { roles.value = data }))
      if (can('permissions.read')) requests.push(apiRequest<PermissionRecord[]>('/security/permissions').then((data) => { permissions.value = data }))
      await Promise.all(requests)
      if (!selectedRoleId.value && roles.value.length) selectedRoleId.value = roles.value[0]?.id ?? 0
      if (!selectedUserId.value && users.value.length) selectedUserId.value = users.value[0]?.id ?? 0
      const user = users.value.find((item) => item.id === selectedUserId.value)
      selectedUserRoleIds.value = roles.value.filter((role) => user?.roles.includes(role.name)).map((role) => role.id)
      if (selectedUserId.value) await loadOverrides(selectedUserId.value)
    } else if (props.view === 'audit') {
      auditRows.value = await apiRequest<Array<Record<string, unknown>>>('/audit/?limit=100')
    }
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudieron cargar los datos.')
  } finally {
    loading.value = false
  }
}

function resetDraft() {
  professionalDraft.value = { first_names: '', last_names: '', document_type: '', document_number: '', profession: '', registration_number: '', specialty_ids: [] }
  appointmentDraft.value = { patient_id: 0, professional_id: 0, start_at: '', end_at: '', reason: '' }
  consultationDraft.value = { appointment_id: 0, diagnosis: '', reason: '', treatment: '', medication_id: 0, dose: '', frequency: '', duration: '', route: 'Oral' }
  vitalsDraft.value = { weight: '', height: '', temperature: '', heart_rate: '', respiratory_rate: '', oxygen_saturation: '', blood_pressure_systolic: '', blood_pressure_diastolic: '' }
  catalogDraft.value = { item_type: 'SERVICE', name: '', description: '', unit_price: 0 }
  invoiceDraft.value = { patient_id: 0, tax: 0, discount: 0 }
  invoiceLines.value = [{ catalog_item_id: 0, quantity: 1 }]
  userDraft.value = { first_names: '', last_names: '', username: '', password: '', role_ids: [] }
  roleDraft.value = { name: '', description: '' }
  specialtyDraft.value = { name: '' }
  medicationDraft.value = { name: '', active_ingredient: '', presentation: '', description: '' }
}

async function createRecord() {
  busy.value = true
  try {
    if (props.view === 'professionals') {
      await apiRequest('/professionals/', { method: 'POST', body: JSON.stringify({
        person: {
          first_names: professionalDraft.value.first_names,
          last_names: professionalDraft.value.last_names,
          document_type: professionalDraft.value.document_type || null,
          document_number: professionalDraft.value.document_number || null,
        },
        profession: professionalDraft.value.profession,
        registration_number: professionalDraft.value.registration_number || null,
        specialty_ids: professionalDraft.value.specialty_ids,
      }) })
    } else if (props.view === 'appointments') {
      await apiRequest('/appointments/', { method: 'POST', body: JSON.stringify({
        ...appointmentDraft.value,
        start_at: new Date(appointmentDraft.value.start_at).toISOString(),
        end_at: new Date(appointmentDraft.value.end_at).toISOString(),
        reason: appointmentDraft.value.reason || null,
      }) })
    } else if (props.view === 'consultations') {
      const appointment = appointments.value.find((item) => item.id === consultationDraft.value.appointment_id)
      if (!appointment) throw new Error('Selecciona una cita confirmada.')
      const medication = consultationDraft.value.medication_id ? [{
        medication_id: consultationDraft.value.medication_id,
        dose: consultationDraft.value.dose,
        frequency: consultationDraft.value.frequency,
        duration: consultationDraft.value.duration,
        route: consultationDraft.value.route,
      }] : []
      await apiRequest('/consultations/', { method: 'POST', body: JSON.stringify({
        appointment_id: appointment.id,
        professional_id: appointment.professional_id,
        reason: consultationDraft.value.reason || null,
        diagnosis: consultationDraft.value.diagnosis || null,
        treatment: consultationDraft.value.treatment || null,
        weight: vitalsDraft.value.weight || null,
        height: vitalsDraft.value.height || null,
        temperature: vitalsDraft.value.temperature || null,
        heart_rate: vitalsDraft.value.heart_rate || null,
        respiratory_rate: vitalsDraft.value.respiratory_rate || null,
        oxygen_saturation: vitalsDraft.value.oxygen_saturation || null,
        blood_pressure_systolic: vitalsDraft.value.blood_pressure_systolic || null,
        blood_pressure_diastolic: vitalsDraft.value.blood_pressure_diastolic || null,
        medications: medication,
      }) })
    } else if (props.view === 'catalog') {
      await apiRequest('/catalog/', { method: 'POST', body: JSON.stringify({
        ...catalogDraft.value,
        unit_price: Number(catalogDraft.value.unit_price),
        description: catalogDraft.value.description || null,
      }) })
    } else if (props.view === 'billing') {
      await apiRequest('/invoices/', { method: 'POST', body: JSON.stringify({
        patient_id: Number(invoiceDraft.value.patient_id),
        tax: Number(invoiceDraft.value.tax),
        discount: Number(invoiceDraft.value.discount),
        items: invoiceLines.value.map((line) => ({ catalog_item_id: Number(line.catalog_item_id), quantity: Number(line.quantity) })),
      }) })
    } else if (props.view === 'security' && showRoleForm.value) {
      await apiRequest('/security/roles', { method: 'POST', body: JSON.stringify({
        ...roleDraft.value,
        permission_codes: [],
      }) })
      showRoleForm.value = false
    } else if (props.view === 'security') {
      await apiRequest('/security/users', { method: 'POST', body: JSON.stringify({
        person: { first_names: userDraft.value.first_names, last_names: userDraft.value.last_names },
        username: userDraft.value.username,
        password: userDraft.value.password,
        role_ids: userDraft.value.role_ids,
      }) })
    }
    showForm.value = false
    resetDraft()
    emit('success', 'Registro guardado.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo guardar el registro.')
  } finally {
    busy.value = false
  }
}

async function createSpecialty() {
  try {
    await apiRequest('/professionals/specialties', {
      method: 'POST',
      body: JSON.stringify(specialtyDraft.value),
    })
    specialtyDraft.value.name = ''
    emit('success', 'Especialidad registrada.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo guardar la especialidad.')
  }
}

async function transitionAppointment(appointment: AppointmentRecord, action: 'confirm' | 'cancel' | 'complete') {
  try {
    await apiRequest(`/appointments/${appointment.id}/${action}`, { method: 'POST' })
    emit('success', `Cita ${action === 'confirm' ? 'confirmada' : action === 'cancel' ? 'cancelada' : 'completada'}.`)
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo actualizar la cita.')
  }
}

async function editAppointment(appointment: AppointmentRecord) {
  const startInput = window.prompt('Nuevo inicio (fecha y hora local):', new Date(appointment.start_at).toISOString().slice(0, 16))
  if (!startInput) return
  const endInput = window.prompt('Nuevo fin (fecha y hora local):', new Date(appointment.end_at).toISOString().slice(0, 16))
  if (!endInput) return
  try {
    await apiRequest(`/appointments/${appointment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ start_at: new Date(startInput).toISOString(), end_at: new Date(endInput).toISOString() }),
    })
    emit('success', 'Cita actualizada.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo actualizar la cita.')
  }
}

async function voidConsultation(consultation: ConsultationRecord) {
  const reason = window.prompt('Motivo de anulación:')
  if (!reason) return
  try {
    await apiRequest(`/consultations/${consultation.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) })
    emit('success', 'Consulta anulada; permanece en la historia clínica.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo anular la consulta.')
  }
}

async function voidInvoice(invoice: InvoiceRecord) {
  const reason = window.prompt('Motivo de anulación de factura:')
  if (!reason) return
  try {
    await apiRequest(`/invoices/${invoice.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) })
    emit('success', 'Factura anulada; el historial quedó conservado.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo anular la factura.')
  }
}

async function deactivateCatalogItem(item: CatalogRecord) {
  if (!window.confirm(`¿Desactivar ${item.name}?`)) return
  try {
    await apiRequest(`/catalog/${item.id}/deactivate`, { method: 'POST' })
    emit('success', 'Elemento desactivado.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo desactivar el elemento.')
  }
}

async function createMedication() {
  busy.value = true
  try {
    await apiRequest('/medications/', { method: 'POST', body: JSON.stringify({
      ...medicationDraft.value,
      active_ingredient: medicationDraft.value.active_ingredient || null,
      presentation: medicationDraft.value.presentation || null,
      description: medicationDraft.value.description || null,
    }) })
    showMedicationForm.value = false
    resetDraft()
    emit('success', 'Medicamento registrado.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo guardar el medicamento.')
  } finally {
    busy.value = false
  }
}

async function downloadConsultation(consultation: ConsultationRecord) {
  try {
    await apiDownload(`/consultations/${consultation.id}/pdf`, `consulta-${consultation.id}.pdf`)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo descargar el PDF.')
  }
}

async function setInvoicePaid(invoice: InvoiceRecord) {
  const payment_method = window.prompt('Método de pago (efectivo, tarjeta, transferencia):')
  if (!payment_method) return
  try {
    await apiRequest(`/invoices/${invoice.id}/paid`, { method: 'POST', body: JSON.stringify({ payment_method }) })
    emit('success', 'Pago registrado.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo registrar el pago.')
  }
}

async function saveUserRoles() {
  if (!selectedUserId.value) return
  try {
    await apiRequest(`/security/users/${selectedUserId.value}`, { method: 'PATCH', body: JSON.stringify({ role_ids: selectedUserRoleIds.value }) })
    emit('success', 'Roles actualizados.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudieron guardar los roles.')
  }
}

async function toggleUser(user: AdminUserRecord) {
  try {
    await apiRequest(`/security/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) })
    emit('success', user.active ? 'Usuario desactivado.' : 'Usuario activado.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudo cambiar el estado.')
  }
}

async function saveRolePermissions() {
  if (!selectedRole.value) return
  try {
    await apiRequest(`/security/roles/${selectedRole.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ permission_codes: rolePermissionCodes.value }),
    })
    emit('success', 'Permisos del rol actualizados.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudieron guardar los permisos.')
  }
}

async function loadOverrides(userId: number) {
  try {
    const overrides = await apiRequest<Array<{ code: string; granted: boolean }>>(`/security/users/${userId}/permissions`)
    const saved = Object.fromEntries(overrides.map((item) => [item.code, item.granted ? 'allow' : 'deny']))
    const choices: Record<string, PermissionChoice> = {}
    for (const permission of permissions.value) {
      choices[permission.code] = (saved[permission.code] as PermissionChoice | undefined) ?? 'inherit'
    }
    overrideChoices.value = choices
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudieron cargar los permisos del usuario.')
  }
}

async function saveOverrides() {
  if (!selectedUserId.value) return
  try {
    const overrides = Object.entries(overrideChoices.value)
      .filter(([, choice]) => choice !== 'inherit')
      .map(([code, choice]) => ({ code, granted: choice === 'allow' }))
    await apiRequest(`/security/users/${selectedUserId.value}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ overrides }),
    })
    emit('success', 'Permisos individuales actualizados.')
    await load()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'No se pudieron guardar los permisos.')
  }
}

watch(selectedRoleId, (id) => {
  rolePermissionCodes.value = roles.value.find((role) => role.id === id)?.permission_codes ?? []
})
watch(selectedUserId, (id) => {
  const user = users.value.find((item) => item.id === id)
  selectedUserRoleIds.value = roles.value.filter((role) => user?.roles.includes(role.name)).map((role) => role.id)
  if (id) void loadOverrides(id)
})
watch(() => props.view, () => { showForm.value = false; showRoleForm.value = false; showMedicationForm.value = false; void load() })
onMounted(load)
</script>

<template>
  <section class="operations-page">
    <header class="operations-heading">
      <div><p class="eyebrow">HOSPIFER <span class="heading-rule"></span> OPERACIÓN CLÍNICA</p><h1>{{ title }}</h1><p class="muted">Registros del centro de atención.</p></div>
      <button v-if="['professionals', 'appointments', 'consultations', 'catalog', 'billing'].includes(view) && (view !== 'professionals' || can('professionals.create')) && (view !== 'appointments' || can('appointments.create')) && (view !== 'consultations' || can('medical_consultations.create')) && (view !== 'catalog' || can('products.create')) && (view !== 'billing' || can('billing.create'))" class="button primary" @click="showForm = !showForm">{{ showForm ? 'Cerrar formulario' : '+ Nuevo registro' }}</button>
      <button v-if="view === 'security' && can('users.create')" class="button primary" @click="showForm = !showForm">{{ showForm ? 'Cerrar formulario' : '+ Nuevo usuario' }}</button>
      <button v-if="view === 'security' && can('roles.create')" class="button secondary" @click="showRoleForm = !showRoleForm">{{ showRoleForm ? 'Cerrar rol' : '+ Nuevo rol' }}</button>
      <button v-if="view === 'catalog' && can('products.create')" class="button secondary" @click="showMedicationForm = !showMedicationForm">{{ showMedicationForm ? 'Cerrar medicamento' : '+ Medicamento' }}</button>
      <button v-if="view === 'professionals' && can('professionals.create')" class="button secondary" @click="showMedicationForm = !showMedicationForm">{{ showMedicationForm ? 'Cerrar especialidad' : '+ Especialidad' }}</button>
    </header>

    <form v-if="showForm && view === 'professionals'" class="operations-form" @submit.prevent="createRecord">
      <h2>Registrar profesional</h2><div class="form-grid"><label>Nombres<input v-model="professionalDraft.first_names" required /></label><label>Apellidos<input v-model="professionalDraft.last_names" required /></label><label>Documento<input v-model="professionalDraft.document_number" /></label><label>Tipo de documento<input v-model="professionalDraft.document_type" /></label><label>Profesión<input v-model="professionalDraft.profession" required /></label><label>Registro profesional<input v-model="professionalDraft.registration_number" /></label><label class="span-2">Especialidades<select v-model="professionalDraft.specialty_ids" multiple><option v-for="specialty in specialties" :key="specialty.id" :value="specialty.id">{{ specialty.name }}</option></select></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Guardar profesional</button></div>
    </form>
    <form v-if="showMedicationForm && view === 'professionals' && can('professionals.create')" class="operations-form" @submit.prevent="createSpecialty"><h2>Nueva especialidad</h2><div class="form-grid"><label>Nombre<input v-model="specialtyDraft.name" minlength="2" required /></label></div><div class="form-actions"><button class="button primary">Guardar especialidad</button></div></form>
    <form v-if="showForm && view === 'appointments'" class="operations-form" @submit.prevent="createRecord">
      <h2>Programar cita</h2><div class="form-grid"><label>Paciente<select v-model.number="appointmentDraft.patient_id" required><option :value="0" disabled>Seleccionar paciente</option><option v-for="patient in patients" :key="patient.id" :value="patient.id">{{ personName(patient.person) }}</option></select></label><label>Profesional<select v-model.number="appointmentDraft.professional_id" required><option :value="0" disabled>Seleccionar profesional</option><option v-for="professional in activeProfessionals" :key="professional.id" :value="professional.id">{{ personName(professional.person) }}</option></select></label><label>Inicio<input v-model="appointmentDraft.start_at" type="datetime-local" required /></label><label>Fin<input v-model="appointmentDraft.end_at" type="datetime-local" required /></label><label class="span-2">Motivo<input v-model="appointmentDraft.reason" maxlength="500" /></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Guardar cita</button></div>
    </form>
    <form v-if="showForm && view === 'consultations'" class="operations-form" @submit.prevent="createRecord">
      <h2>Registrar consulta médica</h2><div class="form-grid"><label class="span-2">Cita confirmada<select v-model.number="consultationDraft.appointment_id" required><option :value="0" disabled>Seleccionar cita</option><option v-for="appointment in confirmedAppointments" :key="appointment.id" :value="appointment.id">{{ new Date(appointment.start_at).toLocaleString() }} · {{ appointment.patient_name }} · {{ appointment.professional_name }}</option></select></label><label>Motivo<input v-model="consultationDraft.reason" /></label><label>Diagnóstico<input v-model="consultationDraft.diagnosis" /></label><label class="span-2">Tratamiento<textarea v-model="consultationDraft.treatment" rows="2"></textarea></label><label>Peso (kg)<input v-model="vitalsDraft.weight" type="number" min="0.01" step="0.01" /></label><label>Talla (cm)<input v-model="vitalsDraft.height" type="number" min="0.01" step="0.01" /></label><label>Temperatura (°C)<input v-model="vitalsDraft.temperature" type="number" min="25" max="45" step="0.1" /></label><label>Frecuencia cardiaca<input v-model="vitalsDraft.heart_rate" type="number" min="1" max="300" /></label><label>Frecuencia respiratoria<input v-model="vitalsDraft.respiratory_rate" type="number" min="1" max="100" /></label><label>Saturación O₂ (%)<input v-model="vitalsDraft.oxygen_saturation" type="number" min="0" max="100" step="0.01" /></label><label>Presión sistólica<input v-model="vitalsDraft.blood_pressure_systolic" type="number" min="1" max="350" /></label><label>Presión diastólica<input v-model="vitalsDraft.blood_pressure_diastolic" type="number" min="1" max="250" /></label><label>Medicamento<select v-model.number="consultationDraft.medication_id"><option :value="0">Sin prescripción</option><option v-for="medicine in medications" :key="medicine.id" :value="medicine.id">{{ medicine.name }} · {{ medicine.presentation || medicine.active_ingredient || '' }}</option></select></label><label>Dosis<input v-model="consultationDraft.dose" :required="consultationDraft.medication_id > 0" /></label><label>Frecuencia<input v-model="consultationDraft.frequency" :required="consultationDraft.medication_id > 0" /></label><label>Duración<input v-model="consultationDraft.duration" :required="consultationDraft.medication_id > 0" /></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Guardar consulta</button></div>
    </form>
    <form v-if="showForm && view === 'catalog'" class="operations-form" @submit.prevent="createRecord">
      <h2>Nuevo producto o servicio</h2><div class="form-grid"><label>Tipo<select v-model="catalogDraft.item_type"><option value="SERVICE">Servicio</option><option value="PRODUCT">Producto</option></select></label><label>Nombre<input v-model="catalogDraft.name" required /></label><label>Precio unitario<input v-model.number="catalogDraft.unit_price" type="number" min="0" step="0.01" required /></label><label class="span-2">Descripción<textarea v-model="catalogDraft.description" rows="2"></textarea></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Guardar en catálogo</button></div>
    </form>
    <form v-if="showForm && view === 'billing'" class="operations-form" @submit.prevent="createRecord">
      <h2>Emitir factura</h2><div class="form-grid"><label class="span-2">Paciente<select v-model.number="invoiceDraft.patient_id" required><option :value="0" disabled>Seleccionar paciente</option><option v-for="patient in patients" :key="patient.id" :value="patient.id">{{ personName(patient.person) }}</option></select></label><template v-for="(line, index) in invoiceLines" :key="index"><label>Producto o servicio<select v-model.number="line.catalog_item_id" required><option :value="0" disabled>Seleccionar concepto</option><option v-for="item in catalog" :key="item.id" :value="item.id">{{ item.name }} · {{ item.unit_price }}</option></select></label><label>Cantidad<input v-model.number="line.quantity" type="number" min="0.01" step="0.01" required /></label></template><button type="button" class="text-action span-2" @click="invoiceLines.push({ catalog_item_id: 0, quantity: 1 })">+ Agregar detalle</button><label>Impuesto<input v-model.number="invoiceDraft.tax" type="number" min="0" step="0.01" /></label><label>Descuento<input v-model.number="invoiceDraft.discount" type="number" min="0" step="0.01" /></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Emitir factura</button></div>
    </form>
    <form v-if="showForm && view === 'security' && can('users.create')" class="operations-form" @submit.prevent="createRecord">
      <h2>Crear usuario</h2><div class="form-grid"><label>Nombres<input v-model="userDraft.first_names" required /></label><label>Apellidos<input v-model="userDraft.last_names" required /></label><label>Usuario<input v-model="userDraft.username" minlength="3" required /></label><label>Contraseña temporal<input v-model="userDraft.password" type="password" minlength="12" maxlength="72" required /></label><label class="span-2">Roles<select v-model="userDraft.role_ids" multiple><option v-for="role in roles.filter((item) => item.active)" :key="role.id" :value="role.id">{{ role.name }}</option></select></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Crear usuario</button></div>
    </form>

    <section v-if="view === 'dashboard'" class="dashboard-grid"><article v-if="dashboardStats.patients_active !== null"><span>PACIENTES ACTIVOS</span><strong>{{ dashboardStats.patients_active }}</strong><small>Registros vigentes</small></article><article v-if="dashboardStats.appointments_today !== null"><span>CITAS DE HOY</span><strong>{{ dashboardStats.appointments_today }}</strong><small>En agenda</small></article><article v-if="dashboardStats.appointments_pending !== null"><span>CITAS PENDIENTES</span><strong>{{ dashboardStats.appointments_pending }}</strong><small>Requieren confirmación</small></article><article v-if="dashboardStats.consultations_recent !== null"><span>CONSULTAS RECIENTES</span><strong>{{ dashboardStats.consultations_recent }}</strong><small>Últimos siete días</small></article><article v-if="dashboardStats.invoices_recent !== null"><span>FACTURAS RECIENTES</span><strong>{{ dashboardStats.invoices_recent }}</strong><small>Últimos siete días</small></article><p v-if="Object.values(dashboardStats).every((value) => value === null)" class="empty-dashboard">No hay métricas disponibles para tus permisos.</p></section>
    <section v-else-if="view === 'professionals'" class="operations-table"><table><thead><tr><th>Profesional</th><th>Documento</th><th>Profesión</th><th>Especialidades</th><th>Registro</th></tr></thead><tbody><tr v-for="item in professionals" :key="item.id"><td>{{ personName(item.person) }}</td><td>{{ item.person.document_number || '—' }}</td><td>{{ item.profession }}</td><td>{{ item.specialties.join(', ') || '—' }}</td><td>{{ item.registration_number || '—' }}</td></tr><tr v-if="!professionals.length"><td colspan="5" class="empty-row">{{ loading ? 'Cargando…' : 'No hay profesionales registrados.' }}</td></tr></tbody></table></section>
    <section v-else-if="view === 'appointments'" class="operations-table"><table><thead><tr><th>Fecha y hora</th><th>Paciente</th><th>Profesional</th><th>Motivo</th><th>Estado</th><th></th></tr></thead><tbody><tr v-for="item in appointments" :key="item.id"><td>{{ new Date(item.start_at).toLocaleString() }} – {{ new Date(item.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</td><td>{{ item.patient_name }}</td><td>{{ item.professional_name }}</td><td>{{ item.reason || '—' }}</td><td><span class="state" :class="item.status === 'CANCELLED' ? 'state-inactive' : 'state-active'">{{ item.status }}</span></td><td class="row-actions"><button v-if="item.status === 'PENDING' && can('appointments.update')" @click="editAppointment(item)">Editar</button><button v-if="item.status === 'PENDING' && can('appointments.confirm')" @click="transitionAppointment(item, 'confirm')">Confirmar</button><button v-if="['PENDING', 'CONFIRMED'].includes(item.status) && can('appointments.cancel')" @click="transitionAppointment(item, 'cancel')">Cancelar</button><button v-if="item.status === 'CONFIRMED' && can('appointments.complete')" @click="transitionAppointment(item, 'complete')">Completar</button></td></tr><tr v-if="!appointments.length"><td colspan="6" class="empty-row">{{ loading ? 'Cargando…' : 'No hay citas registradas.' }}</td></tr></tbody></table></section>
    <section v-else-if="view === 'consultations'" class="operations-table"><table><thead><tr><th>Fecha</th><th>Paciente</th><th>Diagnóstico</th><th>Tratamiento</th><th>Estado</th><th>Acciones</th></tr></thead><tbody><tr v-for="item in consultations" :key="item.id"><td>{{ new Date(item.created_at).toLocaleString() }}</td><td>{{ appointments.find((appointment) => appointment.id === item.appointment_id)?.patient_name || `Cita ${item.appointment_id}` }}</td><td>{{ item.diagnosis || '—' }}</td><td>{{ item.treatment || '—' }}</td><td>{{ item.voided_at ? 'ANULADA' : 'VIGENTE' }}</td><td><button class="text-action" @click="downloadConsultation(item)">Descargar PDF</button><button v-if="!item.voided_at && can('medical_consultations.void')" class="text-action" @click="voidConsultation(item)">Anular</button></td></tr><tr v-if="!consultations.length"><td colspan="6" class="empty-row">{{ loading ? 'Cargando…' : 'No hay consultas registradas.' }}</td></tr></tbody></table></section>
    <section v-else-if="view === 'catalog'" class="catalog-stack"><div class="operations-table"><table><thead><tr><th>Concepto</th><th>Tipo</th><th>Descripción</th><th>Precio</th><th>Estado</th><th></th></tr></thead><tbody><tr v-for="item in catalog" :key="item.id"><td>{{ item.name }}</td><td>{{ item.item_type === 'SERVICE' ? 'Servicio' : 'Producto' }}</td><td>{{ item.description || '—' }}</td><td>{{ Number(item.unit_price).toLocaleString(undefined, { style: 'currency', currency: 'COP' }) }}</td><td>{{ item.active ? 'Activo' : 'Inactivo' }}</td><td><button v-if="item.active && can('products.deactivate')" class="text-action" @click="deactivateCatalogItem(item)">Desactivar</button></td></tr><tr v-if="!catalog.length"><td colspan="6" class="empty-row">{{ loading ? 'Cargando…' : 'Catálogo vacío.' }}</td></tr></tbody></table></div><form v-if="showMedicationForm && can('products.create')" class="operations-form" @submit.prevent="createMedication"><h2>Nuevo medicamento</h2><div class="form-grid"><label>Nombre<input v-model="medicationDraft.name" required /></label><label>Principio activo<input v-model="medicationDraft.active_ingredient" /></label><label>Presentación<input v-model="medicationDraft.presentation" /></label><label>Descripción<input v-model="medicationDraft.description" /></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Guardar medicamento</button></div></form><div class="operations-table"><table><thead><tr><th>Medicamento</th><th>Principio activo</th><th>Presentación</th><th>Estado</th></tr></thead><tbody><tr v-for="medicine in medications" :key="medicine.id"><td>{{ medicine.name }}</td><td>{{ medicine.active_ingredient || '—' }}</td><td>{{ medicine.presentation || '—' }}</td><td>{{ medicine.active ? 'Activo' : 'Inactivo' }}</td></tr><tr v-if="!medications.length"><td colspan="4" class="empty-row">No hay medicamentos registrados.</td></tr></tbody></table></div></section>
    <section v-else-if="view === 'billing'" class="operations-table"><table><thead><tr><th>Factura</th><th>Fecha</th><th>Paciente</th><th>Conceptos</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody><tr v-for="invoice in invoices" :key="invoice.id"><td>#{{ invoice.id }}</td><td>{{ new Date(invoice.created_at).toLocaleDateString() }}</td><td>{{ patients.find((patient) => patient.id === invoice.patient_id)?.person.first_names || `Paciente ${invoice.patient_id}` }}</td><td>{{ invoice.items.map((item) => item.description).join(', ') }}</td><td>{{ Number(invoice.total).toLocaleString(undefined, { style: 'currency', currency: 'COP' }) }}</td><td>{{ invoice.status }}</td><td><button v-if="invoice.status === 'ISSUED' && can('billing.update')" class="text-action" @click="setInvoicePaid(invoice)">Registrar pago</button><button v-if="invoice.status !== 'VOIDED' && can('billing.void')" class="text-action" @click="voidInvoice(invoice)">Anular</button></td></tr><tr v-if="!invoices.length"><td colspan="7" class="empty-row">{{ loading ? 'Cargando…' : 'No hay facturas.' }}</td></tr></tbody></table></section>

    <section v-else-if="view === 'security'" class="security-layout">
      <div v-if="can('users.read')" class="security-section"><header><div><h2>Usuarios</h2><p class="muted">Cuentas, estado y roles asignados.</p></div></header><div class="operations-table"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Roles</th><th>Estado</th><th></th></tr></thead><tbody><tr v-for="item in users" :key="item.id" :class="{ 'selected-row': selectedUserId === item.id }" @click="selectedUserId = item.id"><td>{{ item.first_names }} {{ item.last_names }}<small v-if="item.is_primary_admin" class="inline-tag">ADMIN PRINCIPAL</small></td><td>{{ item.username }}</td><td>{{ item.roles.join(', ') || 'Sin rol' }}</td><td>{{ item.active ? 'Activo' : 'Inactivo' }}</td><td><button v-if="!item.is_primary_admin && can('users.deactivate')" class="text-action" @click.stop="toggleUser(item)">{{ item.active ? 'Desactivar' : 'Activar' }}</button></td></tr></tbody></table></div><div v-if="selectedUser && !selectedUser.is_primary_admin && can('users.update')" class="assign-panel"><label>Roles de {{ selectedUser.username }}<select v-model="selectedUserRoleIds" multiple><option v-for="role in roles.filter((item) => item.active)" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><button class="button secondary" @click="saveUserRoles">Guardar roles</button></div></div>
      <div v-if="can('roles.read') && can('permissions.read')" class="security-section"><header><div><h2>Roles y permisos</h2><p class="muted">Ajusta el acceso asignado a cada rol.</p></div></header><label>Rol<select v-model.number="selectedRoleId"><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><div v-if="selectedRole" class="permission-list"><label v-for="permission in permissions" :key="permission.id" class="permission-row"><span><strong>{{ permission.code }}</strong><small>{{ permission.description }}</small></span><input v-model="rolePermissionCodes" type="checkbox" :value="permission.code" :disabled="selectedRole.name === 'ADMIN'" /></label></div><button v-if="can('roles.update')" class="button primary" :disabled="selectedRole?.name === 'ADMIN'" @click="saveRolePermissions">Guardar permisos del rol</button></div>
      <div v-if="can('permissions.update') && can('permissions.read') && selectedUser && !selectedUser.is_primary_admin" class="security-section"><header><div><h2>Permisos individuales</h2><p class="muted">Overrides para {{ selectedUser.username }}; “Heredar” conserva los roles.</p></div></header><div class="permission-list"><label v-for="permission in permissions" :key="permission.id" class="permission-row"><span><strong>{{ permission.code }}</strong><small>{{ permission.description }}</small></span><select v-model="overrideChoices[permission.code]"><option value="inherit">Heredar</option><option value="allow">Permitir</option><option value="deny">Denegar</option></select></label></div><button class="button primary" @click="saveOverrides">Guardar permisos individuales</button></div>
      <form v-if="showRoleForm && can('roles.create')" class="operations-form" @submit.prevent="createRecord"><h2>Crear rol</h2><div class="form-grid"><label>Nombre<input v-model="roleDraft.name" required /></label><label>Descripción<input v-model="roleDraft.description" /></label></div><div class="form-actions"><button class="button primary" :disabled="busy">Guardar rol</button></div></form>
    </section>

    <section v-else class="operations-table"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Id</th></tr></thead><tbody><tr v-for="entry in auditRows" :key="String(entry.id)"><td>{{ new Date(String(entry.timestamp)).toLocaleString() }}</td><td>{{ entry.user_id ?? 'Sistema' }}</td><td>{{ entry.action }}</td><td>{{ entry.entity_type }}</td><td>{{ entry.entity_id }}</td></tr><tr v-if="!auditRows.length"><td colspan="5" class="empty-row">{{ loading ? 'Cargando…' : 'Sin eventos de auditoría.' }}</td></tr></tbody></table></section>
  </section>
</template>

<style scoped>
.operations-page{padding:34px 36px 42px;max-width:1520px;margin:0 auto;min-width:0}.operations-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:25px}.operations-heading h1{font-family:'Newsreader',serif;font-size:42px;font-weight:500;line-height:1.1;margin:0}.operations-heading .muted{margin:8px 0 0}.operations-form,.security-section{background:#fff;border:1px solid var(--line);border-radius:4px;padding:18px;margin-bottom:17px;min-width:0}.operations-form h2,.security-section h2{font-family:'Newsreader',serif;font-size:23px;font-weight:500;margin:0 0 16px}.operations-form .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.operations-table{background:#fff;border:1px solid var(--line);border-radius:4px;overflow:auto;min-width:0;max-width:100%}.operations-table table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}.operations-table th{background:#fafbf9;color:#839087;font-size:9px;font-weight:700;padding:12px 14px;border-bottom:1px solid var(--line)}.operations-table td{font-size:11px;padding:12px 14px;border-bottom:1px solid #edf0eb;color:#536159;max-width:330px;overflow:hidden;text-overflow:ellipsis}.operations-table a,.row-actions button{color:#356a50}.row-actions{display:flex;gap:8px}.row-actions button,.text-action{border:0;background:transparent;font-size:10px;font-weight:700;padding:3px}.empty-row{text-align:center!important;padding:34px!important;color:#839087!important}.security-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:15px;min-width:0}.security-section>header{display:flex;justify-content:space-between;margin-bottom:14px}.security-section>header h2{margin:0}.security-section>header p{margin:5px 0 0}.security-section>label{max-width:360px;margin-bottom:14px}.selected-row{background:#f1f6f1}.inline-tag{display:inline-block;background:#e7efe7;color:#456f4b;padding:3px 5px;font-size:8px;margin-left:7px}.assign-panel{display:flex;gap:12px;align-items:flex-end;padding-top:13px}.assign-panel label{width:min(360px,100%)}.permission-list{max-height:360px;overflow:auto;border-top:1px solid var(--line);margin:13px 0}.permission-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:9px 5px;border-bottom:1px solid #edf0eb}.permission-row span{display:grid;gap:3px}.permission-row strong{font:600 10px 'DM Sans',sans-serif;color:#30463a}.permission-row small{font-size:9px;color:#849087}.permission-row input[type=checkbox]{width:17px;height:17px;accent-color:#17463b}.permission-row select{width:120px;padding:7px;font-size:10px}.security-section>.button{margin:0 0 3px}.form-actions{display:flex;justify-content:flex-end;padding-top:13px}.span-2{grid-column:span 2}
.dashboard-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:4px;overflow:hidden}.dashboard-grid article{display:grid;gap:10px;background:#fff;padding:20px}.dashboard-grid article span{font-size:9px;font-weight:700;color:#77867d}.dashboard-grid article strong{font:500 38px 'Newsreader',serif;color:#21493a}.dashboard-grid article small{font-size:10px;color:#89948d}.catalog-stack{display:grid;gap:16px}
@media(max-width:1100px){.operations-page{padding:28px 24px}}
@media(max-width:760px){.operations-page{padding:24px 14px}.operations-heading{align-items:flex-start;gap:15px;flex-direction:column}.operations-heading h1{font-size:37px}.operations-heading>.button{align-self:stretch}.operations-form,.security-section{padding:14px}.operations-form .form-grid{grid-template-columns:1fr}.operations-form .span-2{grid-column:auto}.assign-panel{align-items:stretch;flex-direction:column}.operations-table{overflow-x:auto}.operations-table td,.operations-table th{padding:10px}}
</style>