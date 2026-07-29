-- My Clients (sales rep CRM): rep-owned client list + notes.
-- Independent of SoftPro sync; contact_id is a read-only display link.
-- APPLY MANUALLY TO PROD BEFORE DEPLOYING THE CODE THAT USES IT.

CREATE TABLE IF NOT EXISTS crm_clients (
  id serial PRIMARY KEY,
  owner_profile_id varchar(64) NOT NULL REFERENCES profiles(id),
  name varchar(200) NOT NULL,
  company varchar(200),
  email varchar(200),
  phone varchar(50),
  contact_id integer REFERENCES contacts(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_clients_owner_idx ON crm_clients (owner_profile_id);
CREATE INDEX IF NOT EXISTS crm_clients_owner_email_idx ON crm_clients (owner_profile_id, email);
CREATE INDEX IF NOT EXISTS crm_clients_contact_idx ON crm_clients (contact_id);

CREATE TABLE IF NOT EXISTS crm_client_notes (
  id serial PRIMARY KEY,
  client_id integer NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  author_profile_id varchar(64) NOT NULL REFERENCES profiles(id),
  body text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_client_notes_client_idx ON crm_client_notes (client_id);
