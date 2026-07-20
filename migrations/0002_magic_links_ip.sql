-- Adds the requester's IP to magic_links so the request-link endpoint can
-- rate-limit by IP as well as by email (CLAUDE.md §13).

ALTER TABLE magic_links ADD COLUMN ip TEXT;
CREATE INDEX idx_magic_links_ip ON magic_links (ip);
