-- Migration 049: Drop legacy profiles.role TEXT column
--
-- The `role` TEXT column on `profiles` was the original single-tenant
-- role field (admin/user) from the earliest schema. It was superseded
-- by `account_role` (account_role_enum) in migration 017, which moved
-- roles into the account scope. The old column has been unused since
-- then — no code reads or writes it.
--
-- Safe to run: the column is not referenced by any application code,
-- RLS policies, or SECURITY DEFINER functions.

ALTER TABLE profiles DROP COLUMN IF EXISTS role;
