-- Auditoría genérica: cada INSERT/UPDATE/DELETE de una tabla de negocio queda en audit_log
-- con el usuario de la transacción (set_config('app.user_id', ...) en withUser()).
CREATE OR REPLACE FUNCTION audit_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := COALESCE(to_jsonb(OLD)->>'id', '');
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_id, 'D', to_jsonb(OLD), NULL, v_user);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' THEN
      RETURN NEW; -- sin cambios reales
    END IF;
    v_id := COALESCE(to_jsonb(NEW)->>'id', '');
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_id, 'U', to_jsonb(OLD), to_jsonb(NEW), v_user);
    RETURN NEW;
  ELSE
    v_id := COALESCE(to_jsonb(NEW)->>'id', '');
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_id, 'I', NULL, to_jsonb(NEW), v_user);
    RETURN NEW;
  END IF;
END;
$$;

-- Engancha el trigger en todas las tablas del esquema public salvo las técnicas. Idempotente:
-- se ejecuta al final de cada migración para cubrir tablas nuevas.
CREATE OR REPLACE FUNCTION audit_enable_all() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('audit_log', 'sessions', '__drizzle_migrations')
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_log_change()',
      r.tablename);
  END LOOP;
END;
$$;

SELECT audit_enable_all();

-- El historial no se edita ni se borra.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es de solo lectura';
END;
$$;
CREATE OR REPLACE TRIGGER audit_log_immutable_trg BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
