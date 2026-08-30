# Sistema de Gestión Clínica — Frontend

Aplicación frontend del **Sistema Integral de Gestión de una Clínica de Salud**, desarrollada para centralizar y facilitar la gestión de pacientes, citas médicas, historias clínicas, facturación, usuarios y reportes.

El frontend proporciona las interfaces mediante las cuales los diferentes actores del sistema interactúan con las funcionalidades ofrecidas por el backend.

## ✨ Características

El frontend contempla las siguientes funcionalidades:

* 👤 Gestión de pacientes.
* 🩺 Gestión de profesionales de la salud.
* 📅 Gestión y programación de citas médicas.
* 🏥 Registro y consulta de atenciones médicas.
* 📋 Consulta de historias clínicas.
* 💊 Gestión de medicamentos y prescripciones.
* 🔬 Gestión de procedimientos clínicos.
* 💰 Gestión de servicios y facturación.
* 🔐 Autenticación y control de acceso basado en roles (RBAC).
* 📊 Visualización de reportes y estadísticas.
* 📝 Consulta de información de auditoría según los permisos del usuario.

## 👥 Roles del sistema

La interfaz adapta las funcionalidades disponibles dependiendo del rol autenticado:

| Rol           | Funcionalidades principales                                          |
| ------------- | -------------------------------------------------------------------- |
| Administrador | Usuarios, roles, permisos, catálogos y auditoría                     |
| Médico        | Agenda, consultas, historias clínicas, diagnósticos y prescripciones |
| Recepcionista | Pacientes y gestión de citas                                         |
| Facturador    | Facturación, pagos y reportes financieros                            |
| Paciente      | Citas, historial de atenciones, prescripciones y facturas            |

## 🛠️ Tecnologías

El proyecto utiliza tecnologías web modernas para la construcción de la interfaz:

* **Vue** — Biblioteca para construcción de interfaces.
* **TypeScript** — Tipado estático.
* **Vite** — Herramienta de desarrollo y construcción.
* **Tailwind CSS** — Estilos y diseño de la interfaz.
* **Axios / Fetch** — Comunicación con la API REST.