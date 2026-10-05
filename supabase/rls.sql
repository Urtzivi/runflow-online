-- RunFlow · Row Level Security
--
-- El servidor accede a Supabase con la clave service_role, que ignora RLS.
-- Por eso ninguna tabla necesita políticas para anon/authenticated: con RLS
-- activado y sin políticas, la API pública de Supabase no puede leer ni
-- escribir nada, y RunFlow sigue funcionando igual.
--
-- Uso: Supabase → SQL Editor. Ejecuta primero el PASO 1 y revisa el resultado.

-- PASO 1 · Diagnóstico (solo lectura) -------------------------------------

-- Tablas del esquema public y si tienen RLS activado.
select c.relname as tabla, c.relrowsecurity as rls_activado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relrowsecurity, c.relname;

-- Políticas existentes. Cualquier política para anon/authenticated/public
-- vuelve a abrir la tabla aunque RLS esté activado: revísalas.
select tablename as tabla, policyname as politica, roles, cmd as operacion, qual as condicion
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- PASO 2 · Activar RLS en todas las tablas de public ---------------------

do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS activado en %', t.relname;
  end loop;
end $$;

-- PASO 3 · Comprobación ---------------------------------------------------
-- Vuelve a ejecutar la primera consulta del PASO 1: todas deben salir con
-- rls_activado = true.
