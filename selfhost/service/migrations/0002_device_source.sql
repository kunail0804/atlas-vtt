-- Who asked for a login, as a hash of their address: the service caps pending logins per address and
-- in all, so no flood of login requests can spend the database's daily writes.
ALTER TABLE device_logins ADD COLUMN source TEXT;
CREATE INDEX device_logins_by_source ON device_logins (source);
