# Inicio de sesión de Google Workspace para Firmas GLocation

## Alcance

- Solo cuentas de Google Workspace con dominio alojado `glocation.com.co`.
- Un empleado nuevo recibe `contracts_User` en el tenant GLocation, organización GLocation y equipo All Users. Una cuenta existente conserva su rol.
- El acceso por correo y contraseña y los flujos de firmantes externos siguen disponibles.

## Configuración

En Google Auth Platform del proyecto `firmas-glocation`, crear una aplicación de audiencia **Internal** y un cliente OAuth de tipo **Web application**. Registrar `https://firmas.glocation.co` como origen JavaScript autorizado. Este flujo usa el ID token de Google Identity Services y no necesita URI de redirección.

En el archivo de entorno que reciben los contenedores:

| Variable | Uso |
|---|---|
| `GOOGLE_CLIENT_ID` | ID del cliente web; el servidor verifica la audiencia del token. |
| `REACT_APP_GOOGLECLIENTID` | El mismo ID para mostrar el botón de Google en el cliente. |
| `WORKSPACE_TENANT_ID` | ID del tenant GLocation en la base de destino. |
| `WORKSPACE_ORGANIZATION_ID` | ID de la organización GLocation en la base de destino. |
| `WORKSPACE_TEAM_ID` | ID del equipo All Users de esa organización. |

El ID de cliente es público; nunca publicar el secreto del cliente ni el `MASTER_KEY`. El backend necesita su `MASTER_KEY` existente para emitir sesiones mediante `/loginAs`.

## Controles

El servidor comprueba la firma del ID token, audiencia, emisor, caducidad, correo verificado, `hd=glocation.com.co` y dominio del correo. Vincula la cuenta por el identificador estable `sub`; rechaza otro `sub` para un correo previamente vinculado y perfiles fuera de la organización configurada o deshabilitados. El campo `GoogleSubject` tiene índice único parcial.

La creación y modificación de perfiles pasa por `beforeSave`: el navegador no puede asignar roles, cambiar tenant, crear perfiles directamente ni modificar otro perfil. Solo los administradores autorizados pueden agregar usuarios; un administrador de organización no puede crear otro administrador de organización.

## Despliegue y prueba

1. Integrar el PR después de la revisión y construir imágenes de servidor y cliente desde el commit integrado. Registrar commit y etiquetas de imagen.
2. Respaldar la configuración y base de datos del destino. Configurar las cinco variables anteriores y desplegar primero servidor, después cliente.
3. Probar con cuenta Workspace existente: conserva rol, tenant y documentos. Probar con un empleado nuevo: obtiene `contracts_User` en All Users. Probar una cuenta Google ajena al dominio: acceso rechazado. Probar cuenta deshabilitada: acceso rechazado.
4. Confirmar correo/contraseña, firma externa, descarga, correo con PDF adjunto y cierre de sesión. Observar errores del servidor.

Para ocultar inmediatamente el botón de Google, retirar `REACT_APP_GOOGLECLIENTID` del entorno del cliente y reiniciar ese contenedor. Para revertir código, usar las imágenes anteriores y restaurar datos solo si se demuestra que la nueva versión alteró datos; las cuentas creadas con Google se deben revisar antes de cualquier restauración.
