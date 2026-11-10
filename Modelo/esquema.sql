-- Funciones auxiliares (SECURITY DEFINER para poder leer "usuarios" dentro de las políticas)
create or replace function public.mi_id_usuario()
returns integer language sql stable security definer set search_path = '' as $$
  select id_usuarios from public.usuarios where auth_user_id = (select auth.uid());
$$;

create or replace function public.soy_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select rol = 'admin' from public.usuarios where auth_user_id = (select auth.uid())),
    false);
$$;

create or replace function public.es_miembro(p_tablero integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios_tableros
    where id_tablero = p_tablero and id_usuario = public.mi_id_usuario());
$$;

revoke execute on function public.mi_id_usuario() from public, anon;
revoke execute on function public.soy_admin() from public, anon;
revoke execute on function public.es_miembro(integer) from public, anon;
grant execute on function public.mi_id_usuario() to authenticated;
grant execute on function public.soy_admin() to authenticated;
grant execute on function public.es_miembro(integer) to authenticated;

-- Tableros: activar RLS y permisos
alter table public.tableros enable row level security;
revoke all on public.tableros from anon;
revoke update on public.tableros from authenticated;
grant select, insert on public.tableros to authenticated;
grant update (nombre) on public.tableros to authenticated;   -- solo se puede renombrar
grant usage, select on sequence public.tableros_id_seq to authenticated;

-- Ver: los tuyos, los que te compartieron, y todos si eres admin
create policy tableros_select on public.tableros
  for select to authenticated
  using (
    propietario_id = public.mi_id_usuario()
    or public.soy_admin()
    or public.es_miembro(id)
  );

-- Crear: solo a tu nombre
create policy tableros_insert on public.tableros
  for insert to authenticated
  with check (propietario_id = public.mi_id_usuario());

-- Renombrar: solo el propietario (o admin)
create policy tableros_update on public.tableros
  for update to authenticated
  using (propietario_id = public.mi_id_usuario() or public.soy_admin())
  with check (propietario_id = public.mi_id_usuario() or public.soy_admin());

-- usuarios_tableros: cada quien ve sus propias filas
alter table public.usuarios_tableros enable row level security;
revoke all on public.usuarios_tableros from anon;
revoke insert, update, delete on public.usuarios_tableros from authenticated;
grant select on public.usuarios_tableros to authenticated;

create policy ut_select_propio on public.usuarios_tableros
  for select to authenticated
  using (id_usuario = public.mi_id_usuario());

  