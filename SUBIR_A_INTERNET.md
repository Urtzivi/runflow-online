# Cómo subir RunFlow Online Pilot 1.1 a Internet

Esta aplicación **no es una web estática**. No basta con copiar `index.html` a un alojamiento. Debe desplegarse como un servicio Node.js con variables privadas.

La ruta recomendada para el piloto es:

1. Supabase para usuarios y base de datos.
2. GitHub para guardar el código.
3. Render para ejecutar el servidor con HTTPS.

---

## 1. Crear el proyecto de Supabase

1. Crea un proyecto nuevo en Supabase.
2. Abre **SQL Editor**.
3. Copia todo el contenido de:

```text
supabase/migrations/001_runflow_pilot.sql
```

4. Ejecuta el SQL una sola vez.
5. En **Project Settings > API**, guarda de forma privada:
   - Project URL.
   - Anon / publishable key.
   - Service role key.

La `service role key` es secreta. No debe pegarse en GitHub, en la APK ni en el navegador.

---

## 2. Subir el código a un repositorio privado de GitHub

1. Crea un repositorio privado, por ejemplo `runflow-online-pilot`.
2. Sube el contenido de esta carpeta, no el ZIP cerrado.
3. Comprueba que `.env` no está incluido.
4. El archivo `render.yaml` debe quedar en la raíz del repositorio.

---

## 3. Crear el servicio en Render

1. En Render elige **New > Blueprint**.
2. Conecta el repositorio de GitHub.
3. Render leerá `render.yaml`.
4. Completa las variables que aparecen como pendientes:

| Variable | Valor |
|---|---|
| `APP_BASE_URL` | La URL pública de Render, por ejemplo `https://runflow-online-pilot.onrender.com` |
| `SUPABASE_URL` | Project URL de Supabase |
| `SUPABASE_ANON_KEY` | Anon / publishable key de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase |
| `OPENAI_API_KEY` | Opcional al principio; necesario para el análisis con IA |
| `OPENAI_MODEL` | `gpt-5.6-terra` |

`APP_ENCRYPTION_KEY` se genera automáticamente desde el Blueprint y debe conservarse. Si se cambia en el futuro, las claves de Intervals que ya estuvieran cifradas dejarían de poder leerse.

5. Inicia el despliegue.
6. Cuando termine, abre:

```text
https://TU-SERVICIO.onrender.com/health
```

Debe mostrar `ok: true`.

---

## 4. Configurar las URL de autenticación en Supabase

En Supabase abre **Authentication > URL Configuration**.

Configura:

```text
Site URL:
https://TU-SERVICIO.onrender.com
```

Añade como Redirect URL:

```text
https://TU-SERVICIO.onrender.com/activate
```

Sin esta configuración, el enlace de invitación puede no regresar correctamente a RunFlow.

---

## 5. Crear Urtzi y los perfiles iniciales

En tu ordenador:

1. Copia `.env.example` como `.env`.
2. Completa al menos:

```text
APP_BASE_URL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_ENCRYPTION_KEY
```

Para este paso, `APP_ENCRYPTION_KEY` puede ser cualquier secreto largo de al menos 24 caracteres. Usa el mismo valor configurado en Render.

3. Comprueba la conexión:

```bash
npm run verify:online
```

4. Ejecuta:

```bash
npm run bootstrap
```

El script hará lo siguiente:

- enviará una invitación a `urtzi@suibroker.es`;
- asignará a Urtzi los roles de coach y deportista;
- creará el perfil deportivo de Urtzi;
- creará la ficha de Ibon Larrinaga sin acceso a la app;
- relacionará ambos perfiles con Urtzi como coach.

El script es idempotente: se puede repetir si una ejecución se interrumpe.

---

## 6. Activar el acceso de Urtzi

1. Abre el correo de invitación de Supabase.
2. Pulsa el enlace.
3. RunFlow abrirá `/activate`.
4. Crea una contraseña de al menos ocho caracteres.
5. Entra en:

```text
https://TU-SERVICIO.onrender.com/login
```

La web está reservada al coach.

---

## 7. Conectar Intervals y OpenAI

Desde la web del coach:

- Selecciona Urtzi.
- Abre **Conexiones**.
- Introduce la API key personal de Intervals.

La clave se envía al servidor, se cifra y no vuelve a mostrarse.

La clave de OpenAI se configura como variable privada `OPENAI_API_KEY` en Render. No se introduce desde el navegador. El modelo se define con `OPENAI_MODEL`.

Después de conectar Intervals, las pestañas **Actividades** y **Recuperación** permiten sincronizar y guardar los datos del deportista. En **Actividades**, el análisis se ejecuta bajo demanda para controlar el coste.

---

## 8. Activar a Ibon más adelante

Ibon ya aparecerá como perfil gestionable aunque todavía no tenga cuenta de Intervals ni acceso a la app.

Cuando quieras activar su acceso:

1. Selecciona Ibon en la web del coach.
2. Abre **Conexiones > Acceso a la app**.
3. Envía la invitación.
4. Ibon crea su contraseña desde el enlace recibido.

La futura APK iniciará sesión con su correo y consultará esta misma API online.

---

## 9. Actualizaciones posteriores

Cuando modifiques el código y lo subas al repositorio, Render puede desplegar automáticamente la nueva versión.

No cambies estas variables salvo que sea imprescindible:

- `APP_ENCRYPTION_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY`.

Antes de una actualización importante, conviene exportar una copia de la base de datos desde Supabase.
