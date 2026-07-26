# Especificación de Producto (SPEC) - Captura Inteligente de Inventarios

## 1. Visión General
Solución de captura de inventario físico mediante voz o texto para reemplazar el conteo en papel en las bodegas (hoteles y parques) de Colsubsidio. La herramienta se construirá como una **Web con capacidades PWA (Progressive Web App)**, permitiendo a los empleados acceder desde cualquier navegador en los dispositivos móviles de la compañía y registrar los conteos de forma ágil e inclusiva. Validará en tiempo real contra el catálogo y el histórico del ERP para minimizar errores de transcripción, unidades y cantidades.

## 2. Roles y Autenticación
*   **Roles:** 
    *   **Operador:** Realiza el conteo inicial a ciegas.
    *   **Auditor:** Revisa las discrepancias (incluyendo productos fantasma) y realiza el reconteo físico solo de las discrepancias.
    *   **Administrador:** Gestiona las configuraciones del sistema (como porcentajes de mermas aceptadas).
*   **Inicio de Sesión:** El protocolo de seguridad exige que el usuario ingrese su **usuario y contraseña**. El sistema consultará la base de datos para identificar automáticamente el rol de la persona (Operador o Auditor) y luego le pedirá seleccionar la bodega a inventariar desde una lista desplegable.

## 3. Flujos de Captura

### 3.1 Flujo del Operador (Conteo Ciego)
*   **Interacción Principal:** Utiliza **voz o texto (digitación manual)** según la preferencia del usuario, garantizando inclusión. 
    *   *Nota sobre digitación:* Si el Operador elige digitar, el sistema requerirá una verificación explícita en pantalla antes de guardar para evitar errores de tipeo.
    *   **Confirmación de Registro:** Ya sea por voz o texto, el sistema debe confirmar al Operador cuando quedó registrada la información exitosamente.
*   **Restricción de Cantidades:** Ya sea por voz o texto, se deben ingresar números exactos (ej. "7.8"). No se permiten expresiones fraccionarias verbales ("medio", "un cuarto").
*   **Desconexiones (Wi-Fi Fallback):** Si el Wi-Fi falla momentáneamente, la PWA pedirá reintentar el registro una vez se restablezca la red, retomando exactamente desde el último ítem que quedó grabado exitosamente en el sistema (gestionado por caché del Service Worker).

### 3.2 Flujo del Auditor (Reconteo)
*   Al iniciar sesión y seleccionar la bodega, la aplicación web abrirá una vista exclusiva que solo muestra los **productos con diferencias auditables** (discrepancias confirmadas por el Operador o productos nuevos no registrados).
*   La vista mostrará: 
    1. La diferencia entre el conteo físico inicial y lo esperado por el sistema.
    2. El espacio para el "Reconteo del Auditor".
*   El Auditor deberá dirigirse físicamente al producto y registrar el reconteo utilizando la **misma metodología (voz o texto)**.

## 4. Validaciones Inteligentes y Alertas (Aplican para Voz y Texto)
Durante el conteo inicial (Operador), el sistema procesa el ingreso y cruza con la base de datos (`BODEGAS Y STOCK`):
1.  **Validación de Unidad de Medida:** Si la unidad ingresada no coincide, la Web PWA alerta al usuario y le indica cuál es la unidad correcta esperada según el diccionario.
2.  **Validación de Discrepancia de Cantidad:**
    *   Se compara la cantidad con el Saldo Disponible (`SD`) en *background*. El SD nunca se le muestra al Operador. Si se presenta una diferencia entre el conteo y el sistema, se lanza una alerta: *"Observo una discrepancia relevante en las cantidades, ¿estás seguro que contaste X?"*.
    *   **Merma Aceptada:** Para productos cuya unidad de medida es de "peso" como por ejemplo gramos, kilogramos, etc., se tolera una diferencia (ej. 0.2%). Si se supera esta diferencia ya sea a favor o en contra, se lanza la misma alerta de discrepancia.
    *   **Confirmación y Evidencia:** Si el usuario confirma, el sistema guarda el dato con una marca de advertencia/evidencia obligatoria que será revisada por el Auditor.
3.  **Configuración de Mermas:** Se gestionarán a través de un panel de administración exclusivo para el Administrador, permitiendo cambios puntuales y esporádicos.

## 5. Manejo de Casos Borde
*   **Ambigüedad en Voz o Texto Incompleto:** Si la IA duda sobre un producto dictado, o si el usuario digita un nombre incompleto/con errores, la pantalla del dispositivo mostrará las distintas posibilidades más probables para que el usuario escoja la correcta tocando la pantalla.
*   **Productos Fantasma (Nuevos):** Si encuentra un artículo físicamente que no está en el catálogo, el sistema permitirá registrarlo. Exigirá que el Operador ingrese una **descripción detallada** (no un nombre genérico) y la unidad de medida observada. Estos ítems se marcan como "producto no registrado" y pasarán a ser alertas obligatorias para revisión del Auditor.

## 6. Salida de Datos e Integración (Reportes y ERP)
*   El identificador único principal será el **Nombre del Artículo** (`Artículo`). Se incluirá el **Código del Producto** (`Nr.Artículo`) siempre que exista.
*   **Reportes Manuales:** El sistema permitirá a los usuarios autorizados descargar el reporte final consolidado, dando la opción de escoger el formato del archivo entre **CSV y Excel**.
*   **Integración Directa:** El sistema expondrá una **API directa** dedicada exclusivamente a conectarse e integrarse con **Oracle Fusion Cloud Inventory Management**, permitiendo el flujo de datos automatizado hacia el sistema central una vez finalizada la auditoría.

---

## 7. Supuestos por Validar (Actualizado)
*   **Resolución Final del Auditor:** Se asume que el reconteo realizado por el Auditor se tomará como el valor final e irrefutable que se enviará al ERP, sobreescribiendo el del Operador en caso de persistir la diferencia con el sistema.
*   **Visibilidad de Progreso Post-Desconexión:** Para apoyar el "Offline Fallback" (retomar en el último ítem grabado), se asume que la interfaz mostrará siempre un historial visible en pantalla de los últimos 3 a 5 productos registrados exitosamente.
