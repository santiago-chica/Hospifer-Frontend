const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

let accessToken: string | null = localStorage.getItem('hospifer.accessToken')

export type Person = {
  first_names: string
  last_names: string
  document_type: string | null
  document_number: string | null
  birth_date: string | null
}

export type Patient = {
  id: number
  active: boolean
  created_at: string
  updated_at: string
  person: Person
}

export type PatientContact = {
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
}

export type MedicalBackground = {
  id: number
  category: string
  description: string
  occurred_on: string | null
  observations: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type CurrentUser = {
  id: number
  username: string
  active: boolean
  must_change_password: boolean
  is_primary_admin: boolean
  profile_photo: string | null
  roles: string[]
  permissions: string[]
  person: {
    first_names: string
    last_names: string
    document_type: string | null
    document_number: string | null
    birth_date: string | null
    phone: string | null
    email: string | null
  }
}

export type WorkspaceView =
  | 'dashboard'
  | 'patients'
  | 'professionals'
  | 'appointments'
  | 'consultations'
  | 'catalog'
  | 'billing'
  | 'security'
  | 'audit'
  | 'profile'

export type Professional = {
  id: number
  profession: string
  registration_number: string | null
  active: boolean
  person: Person
  specialties: string[]
}

export type AppointmentRecord = {
  id: number
  patient_id: number
  professional_id: number
  start_at: string
  end_at: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  reason: string | null
  patient_name: string
  professional_name: string
}

export type ConsultationRecord = {
  id: number
  appointment_id: number
  professional_id: number
  reason: string | null
  diagnosis: string | null
  treatment: string | null
  created_at: string
  voided_at: string | null
  medications: Array<{ medication_id: number; name: string; dose: string; frequency: string; duration: string; route: string }>
}

export type CatalogRecord = {
  id: number
  item_type: 'PRODUCT' | 'SERVICE'
  name: string
  description: string | null
  unit_price: string
  active: boolean
}

export type MedicationRecord = {
  id: number
  name: string
  active_ingredient: string | null
  presentation: string | null
  description: string | null
  active: boolean
}

export type InvoiceRecord = {
  id: number
  patient_id: number
  status: string
  subtotal: string
  tax: string
  discount: string
  total: string
  payment_status: string
  created_at: string
  items: Array<{ id: number; description: string; quantity: string; unit_price: string; subtotal: string }>
}

export type SpecialtyRecord = { id: number; name: string; active: boolean }
export type RoleRecord = { id: number; name: string; description: string | null; active: boolean; permission_codes: string[] }
export type PermissionRecord = { id: number; code: string; description: string | null }
export type AdminUserRecord = {
  id: number
  username: string
  active: boolean
  must_change_password: boolean
  is_primary_admin: boolean
  roles: string[]
  permissions: string[]
  first_names: string
  last_names: string
}

export type DashboardSummary = {
  patients_active: number | null
  appointments_today: number | null
  appointments_pending: number | null
  consultations_recent: number | null
  invoices_recent: number | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token
  if (token) localStorage.setItem('hospifer.accessToken', token)
  else localStorage.removeItem('hospifer.accessToken')
}

export function hasAccessToken() {
  return accessToken !== null
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (response.status === 401) setAccessToken(null)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new ApiError(body?.detail ?? `Error ${response.status}`, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function apiDownload(path: string, filename: string) {
  const headers = new Headers()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  const response = await fetch(`${API_BASE_URL}${path}`, { headers })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new ApiError(body?.detail ?? `Error ${response.status}`, response.status)
  }
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.click()
  URL.revokeObjectURL(objectUrl)
}
